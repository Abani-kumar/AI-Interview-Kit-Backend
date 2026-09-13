// Validates the LLM's raw question array before any persistence.
// Two levels:
//   STRUCTURAL — wrong types, missing fields, invalid enums → throw (BullMQ retry)
//   CROSS-FIELD — requirement_ids reference IDs not in the current requirements → throw
//
// Uses Zod for per-question shape, then a second pass for cross-field rules
// that Zod alone cannot express (e.g. "every requirement_id must exist in
// the provided set").

const { z } = require('zod');

const VALID_CATEGORIES = ['technical', 'behavioural', 'system-design', 'company-fit'];

const questionItemSchema = z
  .object({
    prompt: z.string().min(1, 'prompt must be non-empty'),
    answer_outline: z.string().min(1, 'answer_outline must be non-empty'),
    category: z.enum(VALID_CATEGORIES, {
      errorMap: () => ({ message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }),
    }),
    difficulty: z
      .number()
      .int()
      .min(1)
      .max(3, 'difficulty must be 1, 2, or 3'),
    requirement_ids: z
      .array(z.string().min(1))
      .min(1, 'each question must reference at least one requirement_id'),
  })
  .strict();

const questionsOutputSchema = z.array(questionItemSchema);

// knownRequirementIds: Set<string> — the IDs from kit.results.requirements.items
function validateQuestionsOutput(raw, knownRequirementIds) {
  // Must be an array
  if (!Array.isArray(raw)) {
    throw new Error('LLM questions output must be an array');
  }

  // Reject legacy question-only objects before Zod (clearer error message).
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (item && typeof item === 'object' && item.question !== undefined && item.prompt === undefined) {
      throw new Error(
        `Question at index ${i} uses legacy "question" field; expected "prompt" and "answer_outline"`
      );
    }
  }

  // Per-item Zod validation
  const result = questionsOutputSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  [${i.path.join('.')}]: ${i.message}`)
      .join('\n');
    throw new Error(`Questions schema validation failed:\n${issues}`);
  }

  // Cross-field: every requirement_id must exist in the current requirements.
  // The model must never invent or modify requirement IDs.
  for (let i = 0; i < result.data.length; i++) {
    const q = result.data[i];
    const invalid = q.requirement_ids.filter((id) => !knownRequirementIds.has(id));
    if (invalid.length > 0) {
      throw new Error(
        `Question at index ${i} references unknown requirement_ids: ${invalid.join(', ')}. ` +
          'The model must only use IDs from the provided requirements.'
      );
    }
  }

  return result.data;
}

module.exports = { validateQuestionsOutput, VALID_CATEGORIES };
