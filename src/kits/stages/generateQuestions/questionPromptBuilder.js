// Builds system + user prompts for question generation.
//
// Two modes (same function, different inputs):
//   Initial pass   — targetRequirements = all requirements
//   Gap-fill pass  — targetRequirements = only uncovered must-have requirements
//
// companyBrief is the ONLY source of company context in this stage.
// companyData and discussionData are NOT passed — they have already been
// compressed into the brief by generate-brief.
//
// qualityWarnings from extract-requirements are read here and injected into
// the prompt as an advisory: "these requirements may contain multiple topics;
// ensure all explicitly named topics receive adequate coverage."

const { MIN_QUESTIONS_PER_MUST_REQUIREMENT } = require('../../../config/coverageConfig');

const VALID_CATEGORIES = ['technical', 'behavioural', 'system-design', 'company-fit'];

const SYSTEM_PROMPT = `You are an expert technical interviewer generating structured interview questions for a specific role.

OUTPUT FORMAT
Return ONLY a valid JSON array of question objects. No markdown, no code fences, no commentary.
[
  {
    "prompt": "string — the interview question text",
    "answer_outline": "string — concise bullet-style guidance for a strong answer",
    "category": "technical | behavioural | system-design | company-fit",
    "difficulty": 1 | 2 | 3,
    "requirement_ids": ["r1", "r2"]
  }
]

CATEGORIES
  technical     — specific tools, languages, frameworks, platforms, algorithms, hard skills
  behavioural   — soft skills, working style, communication, leadership, teamwork, values
  system-design — architecture, scalability, system trade-offs, design decisions
  company-fit   — company-specific knowledge, culture, values, mission alignment

DIFFICULTY
  1 — foundational (any relevant candidate should know this)
  2 — intermediate (requires solid experience)
  3 — advanced (requires deep expertise or senior judgment)

COVERAGE MINIMUM
For every must-have requirement, generate at least MIN_QUESTIONS_PER_MUST questions.
This minimum does not apply to nice-to-have requirements.

STRICT RULES
- Use ONLY the provided requirements as the scope.
- Each question must map to at least one requirement via requirement_ids.
- Only use requirement IDs from the provided list — never invent or modify them.
- A question may map to multiple requirements if it genuinely tests all of them.
- Do not attach unrelated requirements to a question just to increase apparent coverage.
- Use companyBrief to make questions company-specific and interview-relevant where applicable.
- Never invent company facts, technologies, or requirements not in the provided input.
- Assign difficulty based on the seniority level and requirement kind.
- answer_outline must be a non-empty string with concrete talking points (not a single word).
- Avoid duplicate questions.
- Return an empty array [] if there is genuinely nothing to generate.
- Treat technical requirements → technical/system-design questions.
- Treat behavioural requirements → behavioural questions.
- Treat domain requirements → technical or domain-knowledge questions.`;

function formatRequirementsForPrompt(requirements) {
  return requirements
    .map((r) => `  - ID: ${r.id} | kind: ${r.kind} | priority: ${r.priority} | text: "${r.text}"`)
    .join('\n');
}

function formatCompanyBriefForPrompt(companyBrief) {
  if (!companyBrief || (!companyBrief.summary && !companyBrief.what_they_do)) {
    return '(no company brief available — company research was incomplete)';
  }

  const lines = [
    companyBrief.summary ? `Summary: ${companyBrief.summary}` : null,
    companyBrief.what_they_do ? `What they do: ${companyBrief.what_they_do}` : null,
    companyBrief.interview_relevance ? `Interview relevance: ${companyBrief.interview_relevance}` : null,
    companyBrief.hiring_signals?.length
      ? `Hiring signals:\n${companyBrief.hiring_signals.map((s) => `  - ${s}`).join('\n')}`
      : null,
    companyBrief.interview_signals?.length
      ? `Interview signals:\n${companyBrief.interview_signals.map((s) => `  - ${s}`).join('\n')}`
      : null,
  ].filter(Boolean);

  return lines.join('\n');
}

// qualityWarnings come from extract-requirements. They signal that a
// requirement may contain multiple independently testable topics.
// We surface this as a prompt advisory — not a splitting instruction.
function formatQualityWarnings(qualityWarnings) {
  if (!qualityWarnings || qualityWarnings.length === 0) return null;

  const warnings = qualityWarnings
    .map((w) => `  - "${w.text}"`)
    .join('\n');

  return (
    `NOTE: The following requirements may contain multiple independently testable topics. ` +
    `Ensure all explicitly named technologies or skills within them receive adequate question coverage:\n${warnings}`
  );
}

function buildQuestionsPrompt({
  targetRequirements,
  allRequirements,
  companyBrief,
  roleTitle,
  seniority,
  qualityWarnings,
  isGapFillPass,
}) {
  const roleContext = [
    roleTitle ? `Role: ${roleTitle}` : null,
    seniority ? `Seniority: ${seniority}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const warningNote = formatQualityWarnings(qualityWarnings);

  const passNote = isGapFillPass
    ? `NOTE: This is a COVERAGE GAP-FILL pass. Generate questions ONLY for the requirements listed below — they currently have no question covering them. Do not re-generate questions for other requirements.`
    : null;

  // Thread the minimum through to the prompt so the LLM knows the floor.
  // The placeholder MIN_QUESTIONS_PER_MUST in SYSTEM_PROMPT is resolved here
  // at call time so it reflects the current env config, not a build-time constant.
  const minQuestionsNote =
    `COVERAGE MINIMUM (must-have requirements): generate at least ` +
    `${MIN_QUESTIONS_PER_MUST_REQUIREMENT} question(s) per must-have requirement.`;

  const mustHaveIds = targetRequirements
    .filter((r) => r.priority === 'must')
    .map((r) => r.id);

  const mustHaveNote =
    mustHaveIds.length > 0
      ? `Must-have requirements requiring minimum ${MIN_QUESTIONS_PER_MUST_REQUIREMENT} question(s) each: ${mustHaveIds.join(', ')}`
      : null;

  const sections = [
    roleContext ? `ROLE CONTEXT:\n${roleContext}` : null,
    `COMPANY CONTEXT:\n${formatCompanyBriefForPrompt(companyBrief)}`,
    minQuestionsNote,
    mustHaveNote,
    passNote,
    warningNote,
    `REQUIREMENTS TO COVER:\n${formatRequirementsForPrompt(targetRequirements)}`,
    isGapFillPass && allRequirements.length > targetRequirements.length
      ? `ALL REQUIREMENT IDs (for requirement_ids mapping only):\n${allRequirements.map((r) => r.id).join(', ')}`
      : null,
  ].filter(Boolean);

  return sections.join('\n\n');
}

module.exports = { SYSTEM_PROMPT, buildQuestionsPrompt, VALID_CATEGORIES };
