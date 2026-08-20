import { z } from 'zod';

/**
 * A rule version is either a condition tree or a scoring rule (addendum B.3 #3).
 * `ruleType` defaults to condition_tree so every existing payload stays valid;
 * the structure of conditionAst / scoringSpec is validated by @approvex/shared
 * (validateConditionAst / validateScoringSpec) once the type is known.
 */
const ruleVersionFields = {
  ruleType: z.enum(['condition_tree', 'scoring']).default('condition_tree'),
  conditionAst: z.unknown(),
  scoringSpec: z.unknown(),
  priority: z.number().int().min(0).max(100000).default(100),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional(),
};

const effectiveWindowValid = (dto: { effectiveFrom?: Date; effectiveTo?: Date }): boolean =>
  !dto.effectiveFrom || !dto.effectiveTo || dto.effectiveFrom < dto.effectiveTo;

/** Mirrors the rule_versions CHECK constraint: exactly one payload for the type. */
const payloadMatchesType = (dto: {
  ruleType: 'condition_tree' | 'scoring';
  conditionAst?: unknown;
  scoringSpec?: unknown;
}): boolean =>
  dto.ruleType === 'scoring'
    ? dto.scoringSpec !== undefined && dto.conditionAst === undefined
    : dto.conditionAst !== undefined && dto.scoringSpec === undefined;

const payloadMatchesTypeMessage = {
  message:
    'A condition_tree rule requires conditionAst (and no scoringSpec); a scoring rule requires scoringSpec (and no conditionAst)',
};

export const createRuleSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    context: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Z][A-Z0-9_]*$/, 'contexts are SCREAMING_SNAKE_CASE, e.g. PAYMENT_APPROVAL'),
    ...ruleVersionFields,
  })
  .strict()
  .refine(effectiveWindowValid, { message: 'effectiveFrom must be before effectiveTo' })
  .refine(payloadMatchesType, payloadMatchesTypeMessage);
export type CreateRuleDto = z.infer<typeof createRuleSchema>;

export const updateRuleSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
  })
  .strict()
  .refine((dto) => Object.keys(dto).length > 0, { message: 'Provide at least one field' });
export type UpdateRuleDto = z.infer<typeof updateRuleSchema>;

export const upsertDraftSchema = z
  .object(ruleVersionFields)
  .strict()
  .refine(effectiveWindowValid, { message: 'effectiveFrom must be before effectiveTo' })
  .refine(payloadMatchesType, payloadMatchesTypeMessage);
export type UpsertDraftDto = z.infer<typeof upsertDraftSchema>;

export const listRulesQuerySchema = z
  .object({
    context: z.string().optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListRulesQuery = z.infer<typeof listRulesQuerySchema>;
