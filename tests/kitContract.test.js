const { validateKitStructure } = require('../src/kits/kit.validator');
const { VALID_CATEGORIES } = require('../src/kits/stages/generateQuestions/questionSchemaValidator');
const { VALID_KINDS, VALID_PRIORITIES } = require('../src/kits/stages/extractRequirements/requirements.schema');

function buildValidKit(overrides = {}) {
  return {
    source: {
      company: 'Acme',
      company_url: 'https://acme.com',
      role: 'Backend Engineer',
      location: 'Remote',
      jd_chars: 1200,
      researched_at: new Date().toISOString(),
      pages_used: ['https://acme.com/about'],
    },
    company_brief: {
      summary: 'Acme builds APIs.',
      what_they_do: 'API tooling for developers.',
      sources: ['https://acme.com'],
    },
    role: {
      title: 'Backend Engineer',
      seniority: 'Senior',
      responsibilities: ['Design APIs'],
      requirements: [
        { id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'AWS', kind: 'technical', priority: 'nice' },
      ],
    },
    questions: [
      {
        id: 'q1',
        prompt: 'Explain Node.js event loop',
        answer_outline: 'Cover single-threaded async I/O.',
        category: 'technical',
        difficulty: 2,
        requirement_ids: ['r1'],
      },
    ],
    flashcards: [
      { id: 'f1', front: 'What is event loop?', back: 'Async mechanism.', requirement_ids: ['r1'] },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: 'technical', question_ids: ['q1'], minutes: 15 },
        { day: 2, focus: 'rest', question_ids: [], minutes: 0 },
      ],
    },
    coverage: {
      uncovered_requirement_ids: [],
      passes: 1,
    },
    ...overrides,
  };
}

function assertAppendixAQuestionContract(question) {
  expect(typeof question.prompt).toBe('string');
  expect(question.prompt.trim().length).toBeGreaterThan(0);
  expect(typeof question.answer_outline).toBe('string');
  expect(VALID_CATEGORIES).toContain(question.category);
  expect(question.difficulty).toBeGreaterThanOrEqual(1);
  expect(question.difficulty).toBeLessThanOrEqual(3);
}

describe('Appendix A kit contract', () => {
  test('passes a fully valid finalized kit', () => {
    const kit = buildValidKit();
    expect(() => validateKitStructure(kit)).not.toThrow();
    assertAppendixAQuestionContract(kit.questions[0]);
  });

  test('requires unique requirement IDs', () => {
    const kit = buildValidKit({
      role: {
        ...buildValidKit().role,
        requirements: [
          { id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' },
          { id: 'r1', text: 'Duplicate id', kind: 'technical', priority: 'must' },
        ],
      },
    });

    const ids = kit.role.requirements.map((item) => item.id);
    expect(new Set(ids).size).not.toBe(ids.length);
  });

  test('validates requirement kind and priority enums', () => {
    const kit = buildValidKit();
    for (const req of kit.role.requirements) {
      expect(VALID_KINDS).toContain(req.kind);
      expect(VALID_PRIORITIES).toContain(req.priority);
    }
  });

  test('rejects kits where only legacy question field is present without prompt', () => {
    const kit = buildValidKit({
      questions: [
        {
          id: 'q1',
          question: 'Legacy-only question text',
          category: 'technical',
          difficulty: 2,
          requirement_ids: ['r1'],
        },
      ],
    });

    expect(() => validateKitStructure(kit)).toThrow('legacy "question" field');
  });

  test('rejects questions missing answer_outline in Appendix A contract', () => {
    const kit = buildValidKit({
      questions: [
        {
          id: 'q1',
          prompt: 'Explain caching',
          category: 'technical',
          difficulty: 2,
          requirement_ids: ['r1'],
        },
      ],
    });

    expect(() => validateKitStructure(kit)).toThrow('missing or empty "answer_outline"');
  });

  test('rejects invalid question categories in Appendix A contract', () => {
    const kit = buildValidKit({
      questions: [
        {
          id: 'q1',
          prompt: 'Explain caching',
          answer_outline: 'Outline',
          category: 'random',
          difficulty: 2,
          requirement_ids: ['r1'],
        },
      ],
    });

    expect(() => validateKitStructure(kit)).toThrow('invalid category');
  });

  test('rejects difficulty outside 1-3 in Appendix A contract', () => {
    const kit = buildValidKit({
      questions: [
        {
          id: 'q1',
          prompt: 'Explain caching',
          answer_outline: 'Outline',
          category: 'technical',
          difficulty: 5,
          requirement_ids: ['r1'],
        },
      ],
    });

    expect(() => validateKitStructure(kit)).toThrow('difficulty must be 1, 2, or 3');
  });

  test('rejects questions with invalid requirement references', () => {
    const kit = buildValidKit({
      questions: [
        {
          id: 'q1',
          prompt: 'Explain caching',
          answer_outline: 'Outline',
          category: 'technical',
          difficulty: 2,
          requirement_ids: ['r_missing'],
        },
      ],
    });

    expect(() => validateKitStructure(kit)).toThrow('unknown requirement_id');
  });

  test('rejects flashcards with invalid requirement references', () => {
    const kit = buildValidKit({
      flashcards: [{ id: 'f1', front: 'Q', back: 'A', requirement_ids: ['r_missing'] }],
    });
    expect(() => validateKitStructure(kit)).toThrow('unknown requirement_id');
  });

  test('rejects incomplete kits missing mandatory sections', () => {
    const kit = buildValidKit();
    delete kit.coverage;
    expect(() => validateKitStructure(kit)).toThrow('Missing required top-level section: "coverage"');
  });

  test('rejects kits with uncovered mandatory requirements', () => {
    const kit = buildValidKit({
      coverage: { uncovered_requirement_ids: ['r1'], passes: 2 },
    });
    expect(() => validateKitStructure(kit)).toThrow('uncovered_requirement_ids is non-empty');
  });
});
