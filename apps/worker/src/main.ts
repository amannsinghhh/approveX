/**
 * ApproveX background worker: webhook outbox delivery, SLA escalation timers,
 * and email notifications.
 *
 * BullMQ repeatable jobs (locked stack) drive the ticks; the processors
 * themselves claim work from Postgres with FOR UPDATE SKIP LOCKED, so any
 * number of workers can run concurrently and each row is handled once.
 * If Redis is unreachable at boot the worker degrades to plain timers — the
 * outbox pattern keeps Postgres the source of truth either way.
 */
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createPrisma } from './db';
import { env } from './env';
import { createMailer } from './mailer';
import { deliverDueWebhooks } from './processors/deliver-webhooks';
import { escalateOverdueSteps } from './processors/escalate-steps';
import { sendPendingNotifications } from './processors/send-notifications';

const log = (message: string): void => {
  console.log(`[worker] ${new Date().toISOString()} ${message}`);
};

const JOBS = [
  { name: 'deliver-webhooks', everyMs: 10_000 },
  { name: 'escalate-steps', everyMs: 30_000 },
  { name: 'send-notifications', everyMs: 20_000 },
] as const;
type JobName = (typeof JOBS)[number]['name'];

async function bootstrap(): Promise<void> {
  const prisma = createPrisma();
  await prisma.$connect();
  const mailer = createMailer();

  const running = new Set<JobName>();
  const tick = async (name: JobName): Promise<void> => {
    if (running.has(name)) return; // a slow tick must not stack on itself
    running.add(name);
    try {
      switch (name) {
        case 'deliver-webhooks': {
          const stats = await deliverDueWebhooks(prisma);
          if (stats.claimed > 0) log(`webhooks: ${JSON.stringify(stats)}`);
          break;
        }
        case 'escalate-steps': {
          const stats = await escalateOverdueSteps(prisma);
          if (stats.escalated + stats.flagged > 0) log(`escalation: ${JSON.stringify(stats)}`);
          break;
        }
        case 'send-notifications': {
          const stats = await sendPendingNotifications(prisma, mailer);
          if (stats.stepNotices + stats.decisionNotices > 0) {
            log(`notifications: ${JSON.stringify(stats)}`);
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[worker] ${name} tick failed`, err);
    } finally {
      running.delete(name);
    }
  };

  const cleanups: (() => Promise<void>)[] = [async () => prisma.$disconnect()];

  // Probe Redis with a short-lived client; BullMQ gets plain connection
  // options and manages its own connections (also sidesteps the nominal type
  // clash between our ioredis and the one bullmq bundles).
  const probe = new Redis(env.redisUrl, { lazyConnect: true, enableOfflineQueue: false });
  probe.on('error', () => undefined);
  let redisUp: boolean;
  try {
    await probe.connect();
    await probe.ping();
    redisUp = true;
  } catch {
    redisUp = false;
  } finally {
    probe.disconnect();
  }

  if (redisUp) {
    const redisUrl = new URL(env.redisUrl);
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      ...(redisUrl.password ? { password: redisUrl.password } : {}),
      ...(redisUrl.username ? { username: redisUrl.username } : {}),
    };
    const queue = new Queue('approvex-jobs', { connection });
    for (const job of JOBS) {
      await queue.upsertJobScheduler(job.name, { every: job.everyMs }, { name: job.name });
    }
    const worker = new Worker<unknown, void, JobName>(
      'approvex-jobs',
      async (job) => tick(job.name),
      { connection, concurrency: JOBS.length },
    );
    worker.on('error', (err) => console.error('[worker] bullmq error', err));
    cleanups.unshift(
      async () => worker.close(),
      async () => queue.close(),
    );
    log(`started (bullmq): ${JOBS.map((job) => `${job.name}@${job.everyMs / 1000}s`).join(', ')}`);
  } else {
    log('Redis unreachable — degrading to in-process timers (delivery still exactly-once)');
    const timers = JOBS.map((job) => setInterval(() => void tick(job.name), job.everyMs));
    cleanups.unshift(() => {
      timers.forEach(clearInterval);
      return Promise.resolve();
    });
    log(`started (timers): ${JOBS.map((job) => `${job.name}@${job.everyMs / 1000}s`).join(', ')}`);
  }

  const shutdown = (signal: string): void => {
    log(`${signal} received, shutting down`);
    void Promise.allSettled(cleanups.map((cleanup) => cleanup())).then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void bootstrap().catch((err) => {
  console.error('[worker] failed to start', err);
  process.exit(1);
});
