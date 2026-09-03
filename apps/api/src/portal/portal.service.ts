import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FieldInputType, FieldType } from '../../../../shared/src/index';
import { EvaluateService } from '../evaluate/evaluate.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { MyRequestsQuery, SubmitRequestDto } from './portal.schemas';

/** A user-submittable field, projected into the shape the form renderer needs. */
export interface FormField {
  name: string;
  type: FieldType;
  label: string;
  helpText: string | null;
  inputType: FieldInputType;
  required: boolean;
  enumValues: string[];
  unit: string | null;
  precision: number | null;
}

/** A field definition, narrowed to the columns the portal reads. */
interface SubmittableField {
  name: string;
  type: FieldType;
  label: string | null;
  helpText: string | null;
  inputType: FieldInputType | null;
  nullable: boolean;
  enumValues: string[];
  unit: string | null;
  precision: number | null;
}

/**
 * How a field renders when the admin didn't pin an explicit inputType: enums
 * become a picker, currency-tagged numbers a currency control, everything else
 * follows its storage type. Mirrors the fallback the Fields UI previews.
 */
function defaultInputType(field: SubmittableField): FieldInputType {
  if (field.inputType) return field.inputType;
  if (field.enumValues.length > 0) return 'select';
  switch (field.type) {
    case 'number':
      return field.unit?.startsWith('currency:') ? 'currency' : 'number';
    case 'boolean':
      return 'checkbox';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

function toFormField(field: SubmittableField): FormField {
  return {
    name: field.name,
    type: field.type,
    label: field.label ?? field.name,
    helpText: field.helpText,
    inputType: defaultInputType(field),
    // A field is required on the form when it cannot be absent at evaluate time.
    required: !field.nullable,
    enumValues: field.enumValues,
    unit: field.unit,
    precision: field.precision,
  };
}

/**
 * Nests a dot-path form value into `target` so it resolves the same way the
 * evaluator reads it (`resolvePath`): "vendor.country" → target.vendor.country.
 * Array indexes ("items[0]") normalise to plain segments — `resolvePath` walks
 * object keys when the parent isn't an array, so reads still line up.
 */
function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return;

  const leaf = segments.pop() as string;
  let node = target;
  for (const segment of segments) {
    const child = node[segment];
    if (typeof child !== 'object' || child === null || Array.isArray(child)) {
      node[segment] = {};
    }
    node = node[segment] as Record<string, unknown>;
  }
  node[leaf] = value;
}

@Injectable()
export class PortalService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly evaluate: EvaluateService,
  ) {}

  /** Every user-submittable field scoped to `context`, ordered for the form. */
  private async submittableFields(
    tenantId: string,
    context: string,
  ): Promise<SubmittableField[]> {
    return this.tenantPrisma.forTenant(tenantId).fieldDefinition.findMany({
      where: { userSubmittable: true, contexts: { has: context } },
      // Explicit order first (nulls last), then name for a stable tiebreak.
      orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      select: {
        name: true,
        type: true,
        label: true,
        helpText: true,
        inputType: true,
        nullable: true,
        enumValues: true,
        unit: true,
        precision: true,
      },
    });
  }

  /**
   * The submission types a portal user can pick from: every context that has at
   * least one user-submittable field. Powers the `/submit` landing page.
   */
  async listContexts(tenantId: string) {
    const fields = await this.tenantPrisma.forTenant(tenantId).fieldDefinition.findMany({
      where: { userSubmittable: true },
      select: { contexts: true },
    });

    const counts = new Map<string, number>();
    for (const field of fields) {
      for (const context of field.contexts) {
        counts.set(context, (counts.get(context) ?? 0) + 1);
      }
    }

    const items = [...counts.entries()]
      .map(([context, fieldCount]) => ({ context, fieldCount }))
      .sort((a, b) => a.context.localeCompare(b.context));
    return { items };
  }

  /** The generated form for one context. Powers `/submit/:context`. */
  async getForm(tenantId: string, context: string) {
    const fields = await this.submittableFields(tenantId, context);
    if (fields.length === 0) {
      throw new NotFoundException(`No submission form is configured for context "${context}"`);
    }
    return { context, fields: fields.map(toFormField) };
  }

  /**
   * Submit the generated form. The typed values are restricted to the context's
   * submittable fields (an unknown key is a rejected injection attempt), nested
   * into a payload, then run through the normal match-and-instantiate path.
   */
  async submit(
    tenantId: string,
    userId: string,
    context: string,
    dto: SubmitRequestDto,
    idempotencyKey?: string,
    ip?: string,
  ) {
    const fields = await this.submittableFields(tenantId, context);
    if (fields.length === 0) {
      throw new NotFoundException(`No submission form is configured for context "${context}"`);
    }

    const allowed = new Map(fields.map((field) => [field.name, field]));
    const unknownKeys = Object.keys(dto.data).filter((key) => !allowed.has(key));
    if (unknownKeys.length > 0) {
      throw new BadRequestException(
        `Not submittable on context "${context}": ${unknownKeys.join(', ')}`,
      );
    }

    // A required (non-nullable) field must be present and non-null/empty.
    const missing = fields
      .filter((field) => !field.nullable)
      .filter((field) => {
        const value = dto.data[field.name];
        return value === undefined || value === null || value === '';
      })
      .map((field) => field.name);
    if (missing.length > 0) {
      throw new BadRequestException(`Missing required field(s): ${missing.join(', ')}`);
    }

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto.data)) {
      if (value !== undefined) setPath(payload, key, value);
    }

    const result = (await this.evaluate.evaluate(
      tenantId,
      userId,
      { context, data: payload, mode: 'execute', includeTraces: false },
      idempotencyKey,
      ip,
    )) as {
      requestId?: string | null;
      status?: string | null;
      pendingApprovers?: unknown;
    };

    // Trim the evaluator's rule-internals (considered rules, traces) — a portal
    // requester only needs to know what became of their submission.
    return {
      requestId: result.requestId ?? null,
      status: result.status ?? null,
      pendingApprovers: result.pendingApprovers ?? null,
    };
  }

  /** The requests the current user themselves submitted. Powers `/my-requests`. */
  async myRequests(tenantId: string, userId: string, query: MyRequestsQuery) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const where = {
      createdById: userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.context ? { context: query.context } : {}),
    };
    const [items, total] = await Promise.all([
      client.request.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          title: true,
          externalRef: true,
          context: true,
          status: true,
          createdAt: true,
          completedAt: true,
          steps: {
            where: { status: 'pending' },
            select: { id: true, nodeId: true, assignedRoleId: true, dueAt: true },
          },
        },
      }),
      client.request.count({ where }),
    ]);
    return {
      items: items.map(({ steps, ...request }) => ({ ...request, pendingSteps: steps })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
