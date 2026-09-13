const VALID_KINDS = ['technical', 'behavioural', 'domain'];
const VALID_PRIORITIES = ['must', 'nice'];

// Heuristic: AND-style compounds (comma / "and" joined tech nouns) may need extra
// downstream coverage. OR alternatives are intentional single requirements — do not warn.
const COMPOUND_PATTERN =
  /([A-Z][a-zA-Z0-9.#+]+(?:\s[A-Z][a-zA-Z0-9.#+]+)*)\s*,\s*([A-Z][a-zA-Z0-9.#+]+)|([A-Z][a-zA-Z0-9.#+]+)\s+and\s+([A-Z][a-zA-Z0-9.#+]+)/;

const OR_ALTERNATIVE_PATTERN = /(?:,\s*)?\bor\b/i;

function isAlternativeRequirement(text) {
  return OR_ALTERNATIVE_PATTERN.test(text);
}

function isCompoundAndRequirement(text) {
  return COMPOUND_PATTERN.test(text) && !isAlternativeRequirement(text);
}

function validateRequirementsOutput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('LLM output must be a JSON object');
  }

  const requiredTopLevelKeys = ['roleTitle', 'seniority', 'responsibilities', 'requirements'];
  for (const key of requiredTopLevelKeys) {
    if (!(key in raw)) {
      throw new Error(`LLM output missing required key: "${key}"`);
    }
  }

  if (!Array.isArray(raw.responsibilities)) {
    throw new Error('"responsibilities" must be an array');
  }

  if (!Array.isArray(raw.requirements)) {
    throw new Error('"requirements" must be an array');
  }

  if (typeof raw.roleTitle !== 'string') {
    throw new Error('"roleTitle" must be a string');
  }

  if (typeof raw.seniority !== 'string') {
    throw new Error('"seniority" must be a string');
  }

  const qualityWarnings = [];

  for (let i = 0; i < raw.requirements.length; i++) {
    const req = raw.requirements[i];
    const loc = `requirements[${i}]`;

    if (!req || typeof req !== 'object') {
      throw new Error(`${loc} must be an object`);
    }

    for (const key of ['text', 'kind', 'priority']) {
      if (!(key in req)) {
        throw new Error(`${loc} missing required key: "${key}"`);
      }
    }

    if (typeof req.text !== 'string' || req.text.trim() === '') {
      throw new Error(`${loc}.text must be a non-empty string`);
    }

    if (!VALID_KINDS.includes(req.kind)) {
      throw new Error(
        `${loc}.kind "${req.kind}" is invalid. Must be one of: ${VALID_KINDS.join(', ')}`
      );
    }

    if (!VALID_PRIORITIES.includes(req.priority)) {
      throw new Error(
        `${loc}.priority "${req.priority}" is invalid. Must be one of: ${VALID_PRIORITIES.join(', ')}`
      );
    }

    // --- Quality check — never throw, only warn ---
    // OR alternatives (e.g. "Java, Python, or Go") are intentionally atomic — skip warning.
    if (isCompoundAndRequirement(req.text)) {
      qualityWarnings.push({
        type: 'compoundRequirementWarning',
        index: i,
        text: req.text,
        message:
          'Requirement may contain multiple independently testable topics. ' +
          'Downstream generation should ensure all explicitly named topics ' +
          'receive adequate coverage.',
      });
    }
  }

  return { valid: true, qualityWarnings };
}

module.exports = {
  validateRequirementsOutput,
  VALID_KINDS,
  VALID_PRIORITIES,
  isAlternativeRequirement,
  isCompoundAndRequirement,
};
