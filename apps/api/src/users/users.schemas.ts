import { z } from 'zod';

export const updateUserSchema = z
  .object({
    status: z.enum(['active', 'deactivated']).optional(),
    roleIds: z.array(z.string().uuid()).optional(),
  })
  .strict()
  .refine((dto) => dto.status !== undefined || dto.roleIds !== undefined, {
    message: 'Provide status and/or roleIds',
  });
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

/**
 * Per-user UI preferences (Part A dismissal flags, etc.). A free-form JSON object
 * shallow-merged into the stored settings, so the client can set one key without
 * clobbering the rest. Bounded to keep the column small.
 */
export const updateSettingsSchema = z
  .record(z.unknown())
  .refine((s) => Object.keys(s).length <= 100, { message: 'Too many settings keys' });
export type UpdateSettingsDto = z.infer<typeof updateSettingsSchema>;

export const listUsersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
