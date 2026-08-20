import 'reflect-metadata';
import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

// Error monitoring (Phase 7 launch prep) — a no-op without SENTRY_DSN.
// init() hooks process-level handlers + http instrumentation; 5xx-producing
// exceptions are captured without extra Nest wiring.
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');

  const openApiConfig = new DocumentBuilder()
    .setTitle('ApproveX API')
    .setDescription('Business rules and approval workflows as an API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApiConfig));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
