// Terminal stage handler.
// Assembles all results.* into the exact Appendix A shape,
// runs the final integrity validator, persists kit.data.

const Kit = require('../../models/Kit');
const { validateKitStructure } = require('../kit.validator');
const { stripContentStateFromItems, stripContentState } = require('../contentState');
const {
  isRegenerationActive,
  assertRegenerationBaseline,
  reloadKitForConcurrencyCheck,
} = require('../regenerationContext');

function stripLegacyQuestionFields(question) {
  const { question: _legacy, ...rest } = question;
  return rest;
}

async function validateAndFinalize(kitId) {
  const kit = await Kit.findById(kitId).lean();
  const isRegen = isRegenerationActive(kit);

  if (kit.data && !isRegen) {
    return;
  }

  assertRegenerationBaseline(kit);

  const { requirements, companyData, companyBrief, questions, flashcards, schedule, coverage } =
    kit.results || {};

  const publicBrief = stripContentState(companyBrief || {});

  const finalKit = {
    source: {
      company: companyData?.name || '',
      company_url: kit.input.companyUrl,
      role: requirements?.roleTitle || '',
      location: requirements?.location || '',
      jd_chars: kit.input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: companyData?.pagesUsed || [],
    },
    company_brief: {
      summary: publicBrief.summary || '',
      what_they_do: publicBrief.what_they_do || '',
      sources: publicBrief.sources || [],
      ...(publicBrief.interview_relevance !== undefined && {
        interview_relevance: publicBrief.interview_relevance,
      }),
      ...(publicBrief.hiring_signals !== undefined && { hiring_signals: publicBrief.hiring_signals }),
      ...(publicBrief.interview_signals !== undefined && {
        interview_signals: publicBrief.interview_signals,
      }),
    },
    role: {
      title: requirements?.roleTitle || '',
      seniority: requirements?.seniority || '',
      responsibilities: requirements?.responsibilities || [],
      requirements: requirements?.items || [],
    },
    questions: stripContentStateFromItems(questions || []).map(stripLegacyQuestionFields),
    flashcards: stripContentStateFromItems(flashcards || []),
    schedule: schedule || { days_available: kit.input.days, days: [] },
    coverage: {
      uncovered_requirement_ids: coverage?.uncovered_requirement_ids || [],
      passes: coverage?.passes || 1,
    },
  };

  validateKitStructure(finalKit);

  await reloadKitForConcurrencyCheck(kitId);

  await Kit.findByIdAndUpdate(kitId, {
    data: finalKit,
    'results.regeneration': null,
  });
}

module.exports = validateAndFinalize;
