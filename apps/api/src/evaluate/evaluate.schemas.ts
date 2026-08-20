import { z } from 'zod';

export const evaluateSchema = z
  .object({
    context: z.string().min(1).max(100),
    data: z.record(z.unknown()),
    mode: z.enum(['execute', 'dry_run']),
    /** dry_run only: include the full trace of every rule evaluated. */
    includeTraces: z.boolean().default(false),
  })
  .strict();
export type EvaluateDto = z.infer<typeof evaluateSchema>;
