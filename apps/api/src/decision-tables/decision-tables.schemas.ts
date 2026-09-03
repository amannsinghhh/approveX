import { HIT_POLICIES } from '../../../../shared/src/index';
import { z } from 'zod';

const definitionFields = {
  columns: z
    .array(z.object({ field: z.string().min(1), label: z.string().max(200).optional() }).strict())
    .min(1),
  rows: z
    .array(
      z
        .object({
          cells: z.array(z.string()),
          output: z.record(z.unknown()),
          // "best" hit policy only: higher priority wins, ties break by row order.
          priority: z.number().int().optional(),
        })
        .strict(),
    )
    .min(1),
  hitPolicy: z.enum(HIT_POLICIES).default('first'),
};

export const createDecisionTableSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    context: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Z][A-Z0-9_]*$/, 'contexts are SCREAMING_SNAKE_CASE, e.g. PAYMENT_APPROVAL'),
    ...definitionFields,
  })
  .strict();
export type CreateDecisionTableDto = z.infer<typeof createDecisionTableSchema>;

export const updateDecisionTableSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
  })
  .strict()
  .refine((dto) => Object.keys(dto).length > 0, { message: 'Provide at least one field' });
export type UpdateDecisionTableDto = z.infer<typeof updateDecisionTableSchema>;

export const upsertTableDraftSchema = z.object(definitionFields).strict();
export type UpsertTableDraftDto = z.infer<typeof upsertTableDraftSchema>;

export const testDecisionTableSchema = z.object({ data: z.record(z.unknown()) }).strict();
export type TestDecisionTableDto = z.infer<typeof testDecisionTableSchema>;

export const listTablesQuerySchema = z
  .object({
    context: z.string().optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListTablesQuery = z.infer<typeof listTablesQuerySchema>;
