import {
  FIELD_INPUT_TYPES,
  FIELD_PATTERN,
  FIELD_SOURCES,
  FIELD_TYPES,
  LOOKUP_FALLBACK_BEHAVIORS,
} from '@approvex/shared';
import { z } from 'zod';

// Addendum B.2: a field may declare a unit ("currency:INR"), minor-unit
// precision, nullability, a missing-value default, provenance, and enum values.
const metaShape = {
  unit: z.string().max(60).nullable().optional(),
  precision: z.number().int().min(0).max(12).nullable().optional(),
  nullable: z.boolean().optional(),
  defaultIfMissing: z.unknown().optional(),
  source: z.enum(FIELD_SOURCES).optional(),
  enumValues: z.array(z.string().max(200)).max(200).optional(),
  // Addendum B.3 #10: looked_up fields resolve via an external endpoint.
  lookupUrl: z.string().url().max(2000).nullable().optional(),
  lookupFallback: z.enum(LOOKUP_FALLBACK_BEHAVIORS).optional(),
  // P0.1 Request Portal: expose a field on the generated request form.
  // contexts scopes which forms it appears on; label/helpText are form copy;
  // inputType overrides the rendered control; displayOrder sorts the form.
  userSubmittable: z.boolean().optional(),
  contexts: z.array(z.string().min(1).max(100)).max(50).optional(),
  label: z.string().max(200).nullable().optional(),
  helpText: z.string().max(500).nullable().optional(),
  inputType: z.enum(FIELD_INPUT_TYPES).nullable().optional(),
  displayOrder: z.number().int().min(0).max(10000).nullable().optional(),
};

export const createFieldSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(200)
      .regex(FIELD_PATTERN, 'must be a dot path like amount or vendor.country'),
    type: z.enum(FIELD_TYPES),
    description: z.string().max(500).optional(),
    ...metaShape,
  })
  .strict();
export type CreateFieldDto = z.infer<typeof createFieldSchema>;

export const updateFieldSchema = z
  .object({
    type: z.enum(FIELD_TYPES).optional(),
    description: z.string().max(500).nullable().optional(),
    ...metaShape,
  })
  .strict()
  .refine((dto) => Object.keys(dto).length > 0, { message: 'Provide at least one field' });
export type UpdateFieldDto = z.infer<typeof updateFieldSchema>;
