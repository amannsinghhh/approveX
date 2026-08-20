import { z } from 'zod';

/**
 * P0.1 Request Portal — self-service submission.
 *
 * A portal submission carries only the values a user typed into the generated
 * form (keyed by field name, i.e. a dot-path). The workflow is *not* named by
 * the submitter: the chosen context drives rule-matching, which resolves the
 * bound workflow — the same path `POST /evaluate` (mode "execute") takes.
 */
export const submitRequestSchema = z
  .object({
    /** Form values, keyed by user-submittable field name (a dot-path). */
    data: z.record(z.unknown()),
    /** Optional requester-supplied label shown in inboxes and lists. */
    title: z.string().max(300).optional(),
    /** Optional caller reference (e.g. a ticket id in the originating system). */
    externalRef: z.string().max(200).optional(),
  })
  .strict();
export type SubmitRequestDto = z.infer<typeof submitRequestSchema>;

export const myRequestsQuerySchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'expired']).optional(),
    context: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type MyRequestsQuery = z.infer<typeof myRequestsQuerySchema>;
