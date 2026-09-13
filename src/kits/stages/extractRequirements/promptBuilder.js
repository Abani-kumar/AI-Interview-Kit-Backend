// Builds the system + user prompt pair for requirement extraction.
// Lives here, not in the LLM client, because it is interview-kit
// business logic — the client has no opinion about prompt content.

const SYSTEM_PROMPT = `You are a precise job description analyst. Your task is to extract structured information from a job description (JD).

RETURN FORMAT
Return ONLY a single valid JSON object. No markdown, no code fences, no explanation.

{
  "roleTitle": "string — the job title as stated, or empty string if not found",
  "seniority": "string — e.g. Senior, Mid, Junior, Lead, or empty string if not stated",
  "responsibilities": ["string", "..."],
  "requirements": [
    {
      "text": "string",
      "kind": "technical | behavioural | domain",
      "priority": "must | nice"
    }
  ]
}

ATOMICITY RULE — THIS IS THE MOST IMPORTANT INSTRUCTION
Each requirement must represent ONE independently testable skill, qualification, technology, or expectation.

OR / ALTERNATIVES — NEVER SPLIT
When the JD presents alternatives using "or" / "either", keep them as ONE requirement using the JD's original wording:
  JD:  "Strong Java, Python, or Go skills"
  GOOD: { "text": "Strong Java, Python, or Go skills", "kind": "technical", "priority": "must" }
  BAD:  three separate requirements for Java, Python, and Go

  JD:  "Experience with Java or Python"
  GOOD: one requirement preserving the OR phrasing

AND WITHIN ONE PHRASE — KEEP AS ONE when the JD states a combined qualification in a single phrase:
  JD:  "Java and SQL experience"
  GOOD: one requirement "Java and SQL experience"

SEPARATE QUALIFICATIONS — SPLIT when the JD clearly expresses independent requirements:
  JD:  "Java experience. SQL experience."
  GOOD: two separate requirements

  JD:  "Java, Python, or Go; plus experience with PostgreSQL"
  GOOD: two requirements — the OR group as one entry, PostgreSQL as a separate entry

AND / ALL-REQUIRED — SPLIT when the JD requires ALL of multiple independent technologies (no "or"):
  JD:  "Must have experience with Node.js, AWS, PostgreSQL and Docker"
  GOOD: four separate requirements, one per technology

DO NOT SPLIT a single naturally inseparable concept:
  "Strong written and verbal communication skills" → keep as one requirement

DO NOT MERGE unrelated requirements into one entry.
DO NOT paraphrase or rewrite JD wording — preserve the original qualification text.
If a requirement is ambiguous and cannot safely be normalized, keep the JD wording and extract it as stated.

CLASSIFICATION RULES
kind:
  technical    — specific tools, languages, frameworks, platforms, systems, hard skills
  behavioural  — soft skills, working style, communication, leadership, attitude
  domain       — industry knowledge, business context, regulatory or domain expertise

priority:
  must — explicitly required: "required", "must have", "you will need", "essential"
  nice — explicitly optional: "nice to have", "bonus", "preferred", "advantageous", "plus"
  If the JD does not clearly mark a requirement as optional, default to "must".

SCOPE
Extract only what the JD explicitly states.
Do NOT invent, infer, or assume requirements.
Do NOT add requirements that seem reasonable but are not stated.
A thin JD should produce few requirements — that is correct, not a failure.

responsibilities[] — what the person will do in the role.
requirements[]     — what the person must or should bring to the role.`;

// Builds the user-turn prompt for a single JD (or a JD chunk).
// chunkInfo is used only when chunking a large JD — ignored for normal calls.
function buildExtractionPrompt(jdText, chunkInfo = null) {
  const chunkNote = chunkInfo
    ? `\n[This is chunk ${chunkInfo.index + 1} of ${chunkInfo.total}. Extract only from this section.]\n`
    : '';

  return `${chunkNote}Extract structured information from the following job description:\n\n${jdText}`;
}

module.exports = { SYSTEM_PROMPT, buildExtractionPrompt };
