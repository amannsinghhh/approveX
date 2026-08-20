/**
 * First-run wizard (Phase 7): from a fresh tenant to a WORKING approval API
 * in under two minutes. Pick a template, watch the system assemble itself
 * through the real APIs (each line lands with a stamp), then fire a live
 * evaluation and invite the people who will approve.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wordmark } from '../components/AppShell';
import { StampChip } from '../components/StampChip';
import { Button, Card, Input, Label } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import type { Template } from '../lib/templates';
import { TEMPLATES } from '../lib/templates';

type StepId = 'choose' | 'build' | 'test';

interface BuildLine {
  label: string;
  status: 'todo' | 'doing' | 'done';
}

interface DryRunResult {
  matched: boolean;
  matchedRuleName?: string | null;
  matchedRuleVersion?: number | null;
  wouldStartWorkflow?: { workflowId: string; workflowName: string } | null;
  evaluationTrace?: {
    nodes?: {
      field?: string;
      operator?: string;
      expected?: unknown;
      actual?: unknown;
      result?: boolean;
    }[];
  } | null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Create-or-reuse helpers so re-running the wizard never dead-ends on 409s. */
async function ensureRole(name: string, description: string): Promise<string> {
  try {
    const role = await api<{ id: string }>('/roles', {
      method: 'POST',
      body: { name, description, permissionKeys: ['request:approve'] },
    });
    return role.id;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const roles = await api<{ id: string; name: string }[]>('/roles');
      const existing = roles.find((role) => role.name === name);
      if (existing) return existing.id;
    }
    throw err;
  }
}

async function ensureField(field: Template['fields'][number]): Promise<void> {
  try {
    await api('/fields', { method: 'POST', body: field });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return; // already defined
    throw err;
  }
}

export function OnboardingPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { me } = useAuth();
  const [step, setStep] = useState<StepId>('choose');
  const [template, setTemplate] = useState<Template | null>(null);
  const [lines, setLines] = useState<BuildLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const running = useRef(false);

  const curl = template
    ? `curl -X POST ${window.location.origin}/api/v1/evaluate \\
  -H "Authorization: Bearer <your-api-key>" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-4711" \\
  -d '${JSON.stringify({ context: template.context, data: template.samplePayload, mode: 'execute' })}'`
    : '';

  const build = async (chosen: Template): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setTemplate(chosen);
    setStep('build');
    setError(null);

    const plan: BuildLine[] = [
      ...chosen.roles.map((role) => ({ label: `Role — ${role.name}`, status: 'todo' as const })),
      ...chosen.fields.map((field) => ({
        label: `Field — ${field.name}`,
        status: 'todo' as const,
      })),
      { label: `Rule — ${chosen.rule.name} (${chosen.rule.summary})`, status: 'todo' },
      { label: `Workflow — ${chosen.workflow.name}`, status: 'todo' },
      { label: 'Bind rule → workflow', status: 'todo' },
      { label: 'Publish (immutable v1)', status: 'todo' },
    ];
    setLines(plan);
    const mark = (index: number, status: BuildLine['status']): void =>
      setLines((prev) => prev.map((line, i) => (i === index ? { ...line, status } : line)));

    try {
      let lineIndex = 0;
      const ids: string[] = [];
      for (const role of chosen.roles) {
        mark(lineIndex, 'doing');
        ids.push(await ensureRole(role.name, role.description));
        await sleep(280);
        mark(lineIndex, 'done');
        lineIndex += 1;
      }
      setRoleIds(ids);

      for (const field of chosen.fields) {
        mark(lineIndex, 'doing');
        await ensureField(field);
        await sleep(220);
        mark(lineIndex, 'done');
        lineIndex += 1;
      }

      mark(lineIndex, 'doing');
      const rule = await api<{ id: string }>('/rules', {
        method: 'POST',
        body: {
          name: chosen.rule.name,
          context: chosen.context,
          conditionAst: chosen.rule.conditionAst,
          priority: chosen.rule.priority,
        },
      });
      await sleep(280);
      mark(lineIndex, 'done');
      lineIndex += 1;

      mark(lineIndex, 'doing');
      const workflow = await api<{ id: string }>('/workflows', {
        method: 'POST',
        body: {
          name: chosen.workflow.name,
          graph: chosen.workflow.graph(ids),
          rejectionPolicy: 'any_reject_kills',
        },
      });
      await api(`/workflows/${workflow.id}/publish`, { method: 'POST' });
      await sleep(280);
      mark(lineIndex, 'done');
      lineIndex += 1;

      mark(lineIndex, 'doing');
      await api(`/rules/${rule.id}/binding`, { method: 'PUT', body: { workflowId: workflow.id } });
      await sleep(220);
      mark(lineIndex, 'done');
      lineIndex += 1;

      mark(lineIndex, 'doing');
      await api(`/rules/${rule.id}/publish`, { method: 'POST' });
      await sleep(280);
      mark(lineIndex, 'done');

      // the payoff: a real evaluation against what was just built
      const dryRun = await api<DryRunResult>('/evaluate', {
        method: 'POST',
        body: { context: chosen.context, data: chosen.samplePayload, mode: 'dry_run' },
      });
      setResult(dryRun);
      await sleep(500);
      setStep('test');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something failed — retry the setup.');
    } finally {
      running.current = false;
    }
  };

  const invite = async (): Promise<void> => {
    if (!template || roleIds.length === 0) return;
    const res = await api<{ token: string }>('/invitations', {
      method: 'POST',
      body: { email: inviteEmail, roleIds },
    });
    setInviteLink(`${window.location.origin}/accept-invite?token=${res.token}`);
  };

  const copy = (key: string, value: string): void => {
    void navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  useEffect(() => {
    document.title = 'ApproveX — setup';
  }, []);

  return (
    <div className="min-h-screen bg-paper px-6 py-10">
      <div className="mx-auto max-w-[880px]">
        <div className="mb-8 flex items-center justify-between">
          <Wordmark />
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-soft">
            {step === 'choose'
              ? 'step 1 / 3 · choose'
              : step === 'build'
                ? 'step 2 / 3 · build'
                : 'step 3 / 3 · test'}
          </p>
        </div>

        {step === 'choose' && (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              What should need approval first{me ? `, ${me.name.split(' ')[0]}` : ''}?
            </h1>
            <p className="mt-1 text-base text-ink-soft">
              Pick one — ApproveX will assemble the roles, rule, and workflow for you, live. You can
              change every part of it afterwards.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TEMPLATES.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => void build(candidate)}
                  className="group rounded-[10px] border border-rule bg-surface p-4 text-left transition-colors duration-120 hover:border-brand"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-base font-semibold text-ink">{candidate.name}</p>
                    <StampChip
                      label={candidate.context}
                      tone="brand"
                      className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    />
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">{candidate.tagline}</p>
                  <p className="mt-2 font-mono text-xs text-ink-soft">
                    {candidate.rule.summary} → {candidate.workflow.name}
                  </p>
                </button>
              ))}
            </div>
            <p className="mt-6 text-sm text-ink-soft">
              Rather start from a blank slate?{' '}
              <Link to="/rules" className="text-brand hover:text-brand-ink">
                Skip setup
              </Link>
            </p>
          </>
        )}

        {step === 'build' && template && (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              Building “{template.name}”
            </h1>
            <p className="mt-1 text-base text-ink-soft">
              Every line below is a real API call — the same ones your systems will use.
            </p>
            <Card className="mt-6">
              {lines.map((line, index) => (
                <div
                  key={index}
                  className="flex h-11 items-center justify-between border-b border-rule px-4 last:border-b-0"
                >
                  <span
                    className={cn(
                      'text-base transition-colors duration-150',
                      line.status === 'todo' ? 'text-ink-soft/50' : 'text-ink',
                    )}
                  >
                    {line.label}
                  </span>
                  {line.status === 'done' && <StampChip label="DONE" tone="approve" thump />}
                  {line.status === 'doing' && (
                    <span className="font-mono text-xs text-ink-soft">…</span>
                  )}
                </div>
              ))}
            </Card>
            {error && (
              <div className="mt-4 flex items-center gap-3">
                <p className="text-sm text-reject">{error}</p>
                <Button onClick={() => void build(template)}>Retry</Button>
              </div>
            )}
          </>
        )}

        {step === 'test' && template && result && (
          <>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-ink">It works.</h1>
              <StampChip
                label={result.matched ? 'MATCHED' : 'NO MATCH'}
                tone={result.matched ? 'approve' : 'reject'}
                thump
                className="scale-110"
              />
            </div>
            <p className="mt-1 text-base text-ink-soft">
              We just evaluated a sample “{template.sampleTitle}” against your live rule:
            </p>

            <Card className="mt-4 p-4 font-mono text-sm">
              <p className="text-ink">{JSON.stringify(template.samplePayload)}</p>
              <div className="my-2 h-px bg-rule" />
              {(result.evaluationTrace?.nodes ?? [])
                .filter((entry) => entry.field)
                .map((entry, index) => (
                  <p key={index} className={entry.result ? 'text-approve' : 'text-ink-soft'}>
                    {entry.result ? '✓' : '✗'} {entry.field} {entry.operator}{' '}
                    {JSON.stringify(entry.expected)} (got {JSON.stringify(entry.actual)})
                  </p>
                ))}
              <div className="my-2 h-px bg-rule" />
              <p className="text-ink">
                → rule <span className="font-semibold">{result.matchedRuleName}</span> (v
                {result.matchedRuleVersion}){' '}
                {result.wouldStartWorkflow && (
                  <>
                    → workflow{' '}
                    <span className="font-semibold">{result.wouldStartWorkflow.workflowName}</span>
                  </>
                )}
              </p>
            </Card>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <p className="text-base font-medium text-ink">Call it from your system</p>
                <p className="mt-0.5 text-sm text-ink-soft">
                  One POST before the money moves. Mint a key under Admin → API keys.
                </p>
                <pre className="mt-2 overflow-x-auto rounded-[6px] border border-rule bg-paper p-3 font-mono text-xs text-ink">
                  {curl}
                </pre>
                <Button className="mt-2 h-8 text-sm" onClick={() => copy('curl', curl)}>
                  {copied === 'curl' ? 'Copied' : 'Copy curl'}
                </Button>
              </Card>

              <Card className="p-4">
                <p className="text-base font-medium text-ink">Invite your approvers</p>
                <p className="mt-0.5 text-sm text-ink-soft">
                  You can’t approve your own requests (maker-checker) — bring in the people who do.
                </p>
                <div className="mt-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <div className="flex gap-2">
                    <Input
                      id="invite-email"
                      type="email"
                      placeholder="finance.head@company.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                    <Button
                      variant="primary"
                      disabled={!inviteEmail.includes('@')}
                      onClick={() => void invite()}
                    >
                      Invite
                    </Button>
                  </div>
                </div>
                {inviteLink && (
                  <div className="mt-2">
                    <p className="break-all rounded-[6px] border border-rule bg-paper px-2 py-1.5 font-mono text-xs text-ink">
                      {inviteLink}
                    </p>
                    <Button
                      className="mt-1.5 h-8 text-sm"
                      onClick={() => copy('invite', inviteLink)}
                    >
                      {copied === 'invite' ? 'Copied' : 'Copy invite link'}
                    </Button>
                  </div>
                )}
              </Card>
            </div>

            <div className="mt-8 flex items-center gap-3">
              <Button variant="primary" onClick={() => navigate('/sandbox')}>
                Open the sandbox
              </Button>
              <Button onClick={() => navigate('/workflows')}>See the workflow on canvas</Button>
              <Button variant="ghost" onClick={() => navigate('/inbox')}>
                Go to my inbox
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
