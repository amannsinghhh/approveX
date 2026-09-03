import { REJECTION_POLICIES } from '../../../../shared/src/index';
import { z } from 'zod';

const definitionFields = {
  graph: z.unknown(), // structure validated by shared/ validateWorkflowGraph
  rejectionPolicy: z.enum(REJECTION_POLICIES).default('any_reject_kills'),
};

export const createWorkflowSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    ...definitionFields,
  })
  .strict();
export type CreateWorkflowDto = z.infer<typeof createWorkflowSchema>;

export const updateWorkflowSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
  })
  .strict()
  .refine((dto) => Object.keys(dto).length > 0, { message: 'Provide at least one field' });
export type UpdateWorkflowDto = z.infer<typeof updateWorkflowSchema>;

export const upsertWorkflowDraftSchema = z.object(definitionFields).strict();
export type UpsertWorkflowDraftDto = z.infer<typeof upsertWorkflowDraftSchema>;

export const validateWorkflowSchema = z.object(definitionFields).strict();
export type ValidateWorkflowDto = z.infer<typeof validateWorkflowSchema>;

export const listWorkflowsQuerySchema = z
  .object({
    status: z.enum(['draft', 'published', 'archived']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuerySchema>;

export const bindWorkflowSchema = z.object({ workflowId: z.string().uuid() }).strict();
export type BindWorkflowDto = z.infer<typeof bindWorkflowSchema>;
