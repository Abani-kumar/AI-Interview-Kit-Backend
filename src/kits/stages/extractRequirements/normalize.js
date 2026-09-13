// Deterministic normalization and ID assignment.
// Deliberately narrow scope — see design doc for what is and isn't done here.
//
// DOES:   trim, collapse whitespace, remove single trailing period,
//         case-insensitive exact-duplicate removal, assign r1..rN
// DOES NOT: paraphrase, rewrite, synonym-match, semantic-merge, auto-split

function normalizeText(text) {
  return text
    .trim()
    .replace(/\s+/g, ' ') // collapse repeated internal whitespace
    .replace(/\.\s*$/, ''); // remove single trailing period
}

// Case-insensitive exact-match deduplication.
// First occurrence wins; later exact duplicates are dropped.
// Near-duplicates ("Node.js experience" vs "Experience with Node.js") survive —
// this is a known V1 limitation, documented in the design doc.
function deduplicateRequirements(requirements) {
  const seen = new Set();
  return requirements.filter((req) => {
    const key = req.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Assigns stable sequential IDs to a validated, deduplicated requirements array.
// IDs are always assigned by the application — never by the LLM.
function assignRequirementIds(requirements) {
  return requirements.map((req, idx) => ({
    id: `r${idx + 1}`,
    text: req.text,
    kind: req.kind,
    priority: req.priority,
  }));
}

// Full normalization pipeline on the raw LLM output object.
// Returns the normalized + ID-assigned structure ready for MongoDB persistence.
function normalizeRequirementsOutput(raw) {
  const normalizedResponsibilities = (raw.responsibilities || [])
    .map((r) => (typeof r === 'string' ? normalizeText(r) : ''))
    .filter(Boolean);

  const normalizedRequirements = (raw.requirements || []).map((req) => ({
    text: normalizeText(req.text),
    kind: req.kind,
    priority: req.priority,
  }));

  const deduped = deduplicateRequirements(normalizedRequirements);
  const withIds = assignRequirementIds(deduped);

  return {
    roleTitle: normalizeText(raw.roleTitle || ''),
    seniority: normalizeText(raw.seniority || ''),
    responsibilities: normalizedResponsibilities,
    items: withIds, // 'items' is the field name downstream stages read from
  };
}

module.exports = {
  normalizeText,
  deduplicateRequirements,
  assignRequirementIds,
  normalizeRequirementsOutput,
};
