import { z } from 'zod';

export const createInvitationSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    roleIds: z.array(z.string().uuid()).min(1),
  })
  .strict();
export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;
