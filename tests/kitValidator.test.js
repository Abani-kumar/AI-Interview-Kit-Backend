const { validateKitStructure } = require('../src/kits/kit.validator');

describe('validateKitStructure', () => {
  test('rejects malformed kits', () => {
    expect(() => validateKitStructure({})).toThrow('Kit structure validation failed');
  });

  test('rejects kits missing source.company_url', () => {
    const kit = {
      source: { company: 'Acme' },
      company_brief: { summary: '', what_they_do: '', sources: [] },
      role: { title: '', seniority: '', responsibilities: [], requirements: [] },
      questions: [],
      flashcards: [],
      schedule: { days_available: 1, days: [{ day: 1, focus: 'rest', question_ids: [], minutes: 0 }] },
      coverage: { uncovered_requirement_ids: [], passes: 1 },
    };

    expect(() => validateKitStructure(kit)).toThrow('source: missing required field "company_url"');
  });
});
