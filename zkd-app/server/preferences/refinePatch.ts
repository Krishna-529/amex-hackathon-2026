/**
 * What the refine LLM (server/geminiRefine.ts, or server/bedrock.ts if that
 * provider is swapped back in) is allowed to produce when a member types a
 * free-text refine prompt ("arrive before 6pm," "avoid layovers") — and
 * nothing else.
 * The LLM's job is narrow: natural-language-to-structured-constraint
 * parsing, never flight selection (server/engine/refine.ts still runs the
 * real deterministic scorer, server/pipeline/score.ts, on whatever this
 * patch narrows down to).
 *
 * Every field here is either an ADDITIVE hard exclusion or a re-selection
 * of an EXISTING enum value — there is no field that could raise a
 * per-transaction cap, raise a cabin ceiling, un-reject a rejected offer,
 * or reference a specific flight/offer id. The safety envelope is enforced
 * by this schema not HAVING those fields, not by a runtime check alone —
 * see server/engine/refine.ts for exactly how a validated patch is merged.
 */
import { z } from 'zod';

export const PreferencePatchSchema = z
  .object({
    optimization_strategy: z
      .enum(['earliest_arrival', 'stick_to_preferred_airline', 'minimize_layovers', 'lowest_cost'])
      .optional(),
    /** ADDITIVE ONLY — merged with the member's existing avoid list in
     *  refine.ts, never replaces it. */
    avoid_airlines_add: z.array(z.string().min(2).max(3)).max(5).optional(),
    /** HH:mm, 24h, local to the destination airport. */
    arrival_before_local: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm, 24h')
      .optional(),
    /** May only TIGHTEN the member's existing max_acceptable_layovers,
     *  never loosen it — enforced at the merge site in refine.ts, not here. */
    max_layovers: z.number().int().min(0).max(3).optional(),
    /** The model's own one-line justification — surfaced as the 'llm-refined'
     *  OptionReason's text alongside the deterministic scorer's own reason. */
    rationale: z.string().min(1).max(200),
  })
  .strict();

export type PreferencePatch = z.infer<typeof PreferencePatchSchema>;

/** The JSON Schema Bedrock's Converse API tool-use spec needs — kept as a
 *  plain object (not derived from the zod schema) so the two can be diffed
 *  by eye against each other; they must describe the same shape. Untyped
 *  (not `as const`) deliberately: the AWS SDK's `DocumentType` wants a
 *  plain mutable JSON value, not a readonly literal-typed one. */
export const PREFERENCE_PATCH_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    optimization_strategy: {
      type: 'string',
      enum: ['earliest_arrival', 'stick_to_preferred_airline', 'minimize_layovers', 'lowest_cost'],
      description: 'Only set if the member clearly implied a change of priority.',
    },
    avoid_airlines_add: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 5,
      description: 'IATA carrier codes (2-3 letters) the member wants to avoid, in addition to any already excluded.',
    },
    arrival_before_local: {
      type: 'string',
      description: '24h HH:mm local to the destination airport, only if the member gave a specific arrival deadline.',
    },
    max_layovers: {
      type: 'integer',
      minimum: 0,
      maximum: 3,
      description: 'Only if the member asked to reduce connections below what they already have.',
    },
    rationale: {
      type: 'string',
      description: 'One short sentence: what you understood from the member and why.',
    },
  },
  required: ['rationale'],
};
