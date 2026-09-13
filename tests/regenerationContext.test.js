const {
  REGENERATION_SECTIONS,
  STAGES_BY_SECTION,
  buildStageResets,
  validateSection,
  validateSectionPrerequisites,
  validateMissingRequirementIds,
  regenerationConflictError,
} = require('../src/kits/regenerationContext');

describe('regenerationContext', () => {
  test('exposes supported regeneration sections and stage chains', () => {
    expect(Object.values(REGENERATION_SECTIONS)).toEqual(['brief', 'questions', 'flashcards']);
    expect(STAGES_BY_SECTION.questions[0]).toBe('generate-questions');
    expect(STAGES_BY_SECTION.questions).toContain('validate-and-finalize');
  });

  test('buildStageResets marks only requested downstream stages pending', () => {
    const resets = buildStageResets(STAGES_BY_SECTION.questions);
    expect(resets['stages.generate-questions.status']).toBe('pending');
    expect(resets['stages.check-coverage.status']).toBe('pending');
    expect(resets['stages.generate-flashcards.status']).toBe('pending');
    expect(resets['stages.build-schedule.status']).toBe('pending');
    expect(resets['stages.validate-and-finalize.status']).toBe('pending');
    expect(resets['stages.research-company.status']).toBeUndefined();
  });

  test('validateSection rejects unknown sections', () => {
    expect(() => validateSection('schedule')).toThrow('Invalid regeneration section');
  });

  test('validateSectionPrerequisites requires existing questions for question regen', () => {
    expect(() => validateSectionPrerequisites({ results: {} }, 'questions')).toThrow(
      'Kit has no questions to regenerate yet'
    );
  });

  test('validateMissingRequirementIds rejects unknown requirement IDs', () => {
    const kit = {
      results: {
        requirements: {
          items: [{ id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' }],
        },
      },
    };

    expect(() => validateMissingRequirementIds(kit, ['r1', 'r_missing'])).toThrow(
      'Unknown requirement id in missingRequirementIds'
    );
  });

  test('regenerationConflictError includes revision metadata', () => {
    const err = regenerationConflictError(3, 5);
    expect(err.code).toBe('REGENERATION_CONFLICT');
    expect(err.details).toEqual({
      code: 'REGENERATION_CONFLICT',
      baselineContentRevision: 3,
      currentContentRevision: 5,
    });
  });
});
