import { z } from 'zod';
import { API_KEY_SCOPES } from '../common/auth.types';

export const createApiKeySchema = z
  .object({
    name: z.string().min(1).max(100),
    scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
  })
  .strict();

export type CreateApiKeyDto = z.infer<typeof createApiKeySchema>;
