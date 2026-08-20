import { z } from 'zod';

export const signupSchema = z
  .object({
    tenantName: z.string().min(2).max(100),
    slug: z
      .string()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits, and hyphens only')
      .optional(),
    name: z.string().min(1).max(100),
    email: z.string().email().toLowerCase(),
    password: z.string().min(8).max(128),
  })
  .strict();
export type SignupDto = z.infer<typeof signupSchema>;

export const loginSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(1).max(128),
  })
  .strict();
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(1) }).strict();
export type RefreshDto = z.infer<typeof refreshSchema>;

export const acceptInvitationSchema = z
  .object({
    token: z.string().min(1),
    name: z.string().min(1).max(100),
    password: z.string().min(8).max(128),
  })
  .strict();
export type AcceptInvitationDto = z.infer<typeof acceptInvitationSchema>;
