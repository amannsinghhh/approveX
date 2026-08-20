import { z } from 'zod';

/** A named value list backing IN_LIST / NOT_IN_LIST membership checks. */
export const createManagedListSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    values: z.array(z.string().min(1).max(200)).default([]),
  })
  .strict();
export type CreateManagedListDto = z.infer<typeof createManagedListSchema>;

export const updateManagedListSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    values: z.array(z.string().min(1).max(200)).optional(),
  })
  .strict()
  .refine((dto) => Object.keys(dto).length > 0, { message: 'Provide at least one field' });
export type UpdateManagedListDto = z.infer<typeof updateManagedListSchema>;
