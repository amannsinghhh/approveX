import { z } from 'zod';

export const createRequestSchema = z
  .object({
    workflowId: z.string().uuid(),
    payload: z.record(z.unknown()),
    title: z.string().max(300).optional(),
    context: z.string().max(100).optional(),
    externalRef: z.string().max(200).optional(),
  })
  .strict();
export type CreateRequestDto = z.infer<typeof createRequestSchema>;

export const listRequestsQuerySchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'expired']).optional(),
    context: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

export const approveStepSchema = z.object({ comment: z.string().max(2000).optional() }).strict();
export type ApproveStepDto = z.infer<typeof approveStepSchema>;

export const rejectStepSchema = z
  .object({ comment: z.string().min(1, 'A reason is required to reject').max(2000) })
  .strict();
export type RejectStepDto = z.infer<typeof rejectStepSchema>;

export const delegateStepSchema = z.object({ toUserId: z.string().uuid() }).strict();
export type DelegateStepDto = z.infer<typeof delegateStepSchema>;

export const createDelegationSchema = z
  .object({
    toUserId: z.string().uuid(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .strict()
  .refine((dto) => dto.startsAt < dto.endsAt, { message: 'startsAt must be before endsAt' });
export type CreateDelegationDto = z.infer<typeof createDelegationSchema>;
