import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AnalyticsModule } from './analytics/analytics.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { ApprovalTokensModule } from './approval-tokens/approval-tokens.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { PermissionsGuard } from './common/permissions.guard';
import { RateLimitGuard } from './common/rate-limit.guard';
import { DecisionTablesModule } from './decision-tables/decision-tables.module';
import { EvaluateModule } from './evaluate/evaluate.module';
import { FieldsModule } from './fields/fields.module';
import { HealthModule } from './health/health.module';
import { InvitationsModule } from './invitations/invitations.module';
import { ManagedListsModule } from './managed-lists/managed-lists.module';
import { PortalModule } from './portal/portal.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RequestsModule } from './requests/requests.module';
import { RolesModule } from './roles/roles.module';
import { RulesModule } from './rules/rules.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WorkflowsModule } from './workflows/workflows.module';

@Module({
  imports: [
    JwtModule.register({ global: true }),
    PrismaModule,
    RedisModule,
    AuditModule,
    HealthModule,
    AuthModule,
    InvitationsModule,
    UsersModule,
    RolesModule,
    RulesModule,
    FieldsModule,
    ManagedListsModule,
    DecisionTablesModule,
    WorkflowsModule,
    WebhooksModule,
    RequestsModule,
    EvaluateModule,
    ApiKeysModule,
    AnalyticsModule,
    PortalModule,
    ApprovalTokensModule,
  ],
  providers: [
    // Order matters: authentication, then permissions, then rate limiting
    // (which needs the authenticated tenant).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
