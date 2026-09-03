import { WEBHOOK_EVENT_TYPES } from '../../../../shared/src/index';
import { z } from 'zod';

const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value), 'URL must be http(s)');

export const createWebhookSchema = z
  .object({
    url: httpUrl,
    description: z.string().max(500).optional(),
    /** Empty (default) subscribes the endpoint to every event. */
    events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).default([]),
    enabled: z.boolean().default(true),
  })
  .strict();

export const updateWebhookSchema = z
  .object({
    url: httpUrl.optional(),
    description: z.string().max(500).nullable().optional(),
    events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const deliveriesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type CreateWebhookDto = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookDto = z.infer<typeof updateWebhookSchema>;
export type DeliveriesQuery = z.infer<typeof deliveriesQuerySchema>;
