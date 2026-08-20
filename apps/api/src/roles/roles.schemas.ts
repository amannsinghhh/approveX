import { z } from 'zod';
import { PERMISSION_KEYS } from '../common/auth.types';

export const createRoleSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    permissionKeys: z.array(z.enum(PERMISSION_KEYS)).default([]),
  })
  .strict();
export type CreateRoleDto = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    permissionKeys: z.array(z.enum(PERMISSION_KEYS)).optional(),
  })
  .strict()
  .refine((dto) => Object.keys(dto).length > 0, { message: 'Provide at least one field' });
export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;
