// Zod schema for the LLM output. First use of Zod in this codebase —
// introduced here because the brief has more optional fields than
// extract-requirements did, and Zod's partial() + discriminated error
// messages make the distinction between "missing required" and "valid empty"
// much cleaner than hand-rolled checks.
//
// Mandatory:   summary, what_they_do, sources (built by application, not LLM)
// Optional:    interview_relevance, hiring_signals, interview_signals
// All may be empty string / empty array — partial research is a valid outcome.

const { z } = require('zod');

const briefOutputSchema = z.object({
  // Mandatory — LLM produces these, must be present even if empty string
  summary: z.string(),
  what_they_do: z.string(),

  // Optional extensions beyond Appendix A minimum
  interview_relevance: z.string().optional().default(''),
  hiring_signals: z.array(z.string()).optional().default([]),
  interview_signals: z.array(z.string()).optional().default([]),

  // sources is NOT validated here because it is built deterministically
  // by sourceBuilder.js in application code, never by the LLM.
  // It is merged into the final object after LLM validation passes.
});

// Validates raw LLM JSON output.
// Throws a structured error on any schema failure so BullMQ retries the stage.
// Returns the parsed, coerced, defaulted object on success.
function validateBriefOutput(raw) {
  const result = briefOutputSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Brief schema validation failed:\n${issues}`);
  }

  return result.data;
}

module.exports = { validateBriefOutput, briefOutputSchema };
