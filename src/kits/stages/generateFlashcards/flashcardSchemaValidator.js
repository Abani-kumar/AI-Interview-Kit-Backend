// Zod validation for the LLM's flashcard output.
// Hard failure on: missing fields, wrong types, empty strings, invalid req IDs.
// The cross-field check (requirement_ids must exist) is applied after Zod.

const { z } = require('zod');

const flashcardItemSchema = z.object({
  front: z.string().min(1, 'front must be non-empty'),
  back: z.string().min(1, 'back must be non-empty'),
  requirement_ids: z
    .array(z.string().min(1))
    .min(1, 'each flashcard must reference at least one requirement_id'),
});

const flashcardsOutputSchema = z.array(flashcardItemSchema);

function validateFlashcardsOutput(raw, knownRequirementIds) {
  if (!Array.isArray(raw)) {
    throw new Error('LLM flashcards output must be an array');
  }

  const result = flashcardsOutputSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  [${i.path.join('.')}]: ${i.message}`)
      .join('\n');
    throw new Error(`Flashcard schema validation failed:\n${issues}`);
  }

  // Cross-field: every requirement_id must reference a real requirement
  for (let i = 0; i < result.data.length; i++) {
    const card = result.data[i];
    const invalid = card.requirement_ids.filter((id) => !knownRequirementIds.has(id));
    if (invalid.length > 0) {
      throw new Error(
        `Flashcard at index ${i} references unknown requirement_ids: ${invalid.join(', ')}. ` +
          'The model must only use IDs from the provided requirements.'
      );
    }
  }

  return result.data;
}

module.exports = { validateFlashcardsOutput };
