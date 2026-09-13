const { validateKitStructure } = require('../src/kits/kit.validator');

// ─── helpers ─────────────────────────────────────────────────────────────────

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
      { id: 'q1', prompt: 'Explain Node.js event loop', answer_outline: 'Cover single-threaded async I/O.', category: 'technical', difficulty: 2, requirement_ids: ['r1'] },
    ],
    flashcards: [
      { id: 'f1', front: 'What is event loop?', back: 'Single-threaded async mechanism.', requirement_ids: ['r1'] },
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

// ─── validateKitStructure ─────────────────────────────────────────────────────

describe('validateKitStructure', () => {
  test('passes a fully valid complete kit', () => {
    expect(() => validateKitStructure(buildValidKit())).not.toThrow();
  });

  // Missing top-level sections
  test.each(
    ['source', 'company_brief', 'role', 'questions', 'flashcards', 'schedule', 'coverage']
  )('throws when "%s" section is missing', (section) => {
    const kit = buildValidKit();
    delete kit[section];
    expect(() => validateKitStructure(kit)).toThrow('Kit structure validation failed');
  });

  // Required field names
  test('throws when source is missing company_url', () => {
    const kit = buildValidKit();
    delete kit.source.company_url;
    expect(() => validateKitStructure(kit)).toThrow('source: missing required field "company_url"');
  });

  test('throws when company_brief is missing summary', () => {
    const kit = buildValidKit();
    delete kit.company_brief.summary;
    expect(() => validateKitStructure(kit)).toThrow('company_brief: missing required field "summary"');
  });

  test('throws when company_brief is missing what_they_do', () => {
    const kit = buildValidKit();
    delete kit.company_brief.what_they_do;
    expect(() => validateKitStructure(kit)).toThrow('company_brief: missing required field "what_they_do"');
  });

  test('throws when role is missing requirements field', () => {
    const kit = buildValidKit();
    delete kit.role.requirements;
    expect(() => validateKitStructure(kit)).toThrow('role: missing required field "requirements"');
  });

  // Cross-reference integrity
  test('throws when questions use legacy question field without prompt', () => {
    const kit = buildValidKit({
      questions: [
        {
          id: 'q1',
          question: 'Legacy only',
          category: 'technical',
          difficulty: 2,
          requirement_ids: ['r1'],
        },
      ],
    });
    expect(() => validateKitStructure(kit)).toThrow('legacy "question" field');
  });

  test('throws when questions are missing answer_outline', () => {
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

  test('throws when schedule references unknown question_id', () => {
    const kit = buildValidKit();
    kit.schedule.days[0].question_ids = ['q_unknown'];
    expect(() => validateKitStructure(kit)).toThrow('unknown question_id: "q_unknown"');
  });

  test('throws when flashcard references unknown requirement_id', () => {
    const kit = buildValidKit();
    kit.flashcards[0].requirement_ids = ['r_unknown'];
    expect(() => validateKitStructure(kit)).toThrow('unknown requirement_id: "r_unknown"');
  });

  // Coverage gate
  test('throws when uncovered_requirement_ids is non-empty', () => {
    const kit = buildValidKit({
      coverage: { uncovered_requirement_ids: ['r1'], passes: 2 },
    });
    expect(() => validateKitStructure(kit)).toThrow('uncovered_requirement_ids is non-empty');
  });

  // Schedule day count
  test('throws when schedule.days length does not match days_available', () => {
    const kit = buildValidKit();
    kit.schedule.days_available = 5; // mismatch: only 2 days in days[]
    expect(() => validateKitStructure(kit)).toThrow(
      'schedule.days has 2 entries but days_available is 5'
    );
  });

  // Arrays check
  test('throws when questions is not an array', () => {
    const kit = buildValidKit({ questions: {} });
    expect(() => validateKitStructure(kit)).toThrow('"questions" must be an array');
  });

  test('throws when flashcards is not an array', () => {
    const kit = buildValidKit({ flashcards: {} });
    expect(() => validateKitStructure(kit)).toThrow('"flashcards" must be an array');
  });

  // Valid partial/empty fields — not structural failures
  test('passes when questions is empty array (thin JD)', () => {
    const kit = buildValidKit({
      questions: [],
      schedule: { days_available: 1, days: [{ day: 1, focus: 'rest', question_ids: [], minutes: 0 }] },
    });
    expect(() => validateKitStructure(kit)).not.toThrow();
  });

  test('passes when flashcards is empty array', () => {
    const kit = buildValidKit({ flashcards: [] });
    expect(() => validateKitStructure(kit)).not.toThrow();
  });

  test('passes when company_brief fields are empty strings (no research)', () => {
    const kit = buildValidKit({
      company_brief: { summary: '', what_they_do: '', sources: [] },
    });
    expect(() => validateKitStructure(kit)).not.toThrow();
  });
});

// ─── stage handler (integration-style with mocks) ────────────────────────────

jest.mock('../src/models/Kit');

describe('validateAndFinalize stage handler', () => {
  const baseKit = {
    data: null,
    input: { companyUrl: 'https://acme.com', jd: 'Backend Engineer...', days: 2 },
    results: {
      requirements: {
        roleTitle: 'Backend Engineer',
        seniority: 'Senior',
        location: '',
        responsibilities: ['Design APIs'],
        items: [{ id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' }],
      },
      companyData: { name: 'Acme', pagesUsed: ['https://acme.com'] },
      companyBrief: {
        summary: 'Acme builds APIs.',
        what_they_do: 'API tooling.',
        sources: ['https://acme.com'],
      },
      questions: [
        { id: 'q1', prompt: 'Explain event loop', answer_outline: 'Cover libuv and the call stack.', category: 'technical', difficulty: 2, requirement_ids: ['r1'] },
      ],
      flashcards: [
        { id: 'f1', front: 'Event loop?', back: 'Async mechanism.', requirement_ids: ['r1'] },
      ],
      schedule: {
        days_available: 2,
        days: [
          { day: 1, focus: 'technical', question_ids: ['q1'], minutes: 15 },
          { day: 2, focus: 'rest', question_ids: [], minutes: 0 },
        ],
      },
      coverage: { uncovered_requirement_ids: [], passes: 1 },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('persists kit.data with valid complete inputs', async () => {
    const Kit = require('../src/models/Kit');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const validateAndFinalize = require('../src/kits/stages/validateAndFinalize');
    await validateAndFinalize('kit123');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledWith(
      'kit123',
      expect.objectContaining({
        data: expect.objectContaining({
          source: expect.objectContaining({ company_url: 'https://acme.com' }),
          company_brief: expect.objectContaining({ summary: 'Acme builds APIs.' }),
          role: expect.objectContaining({ title: 'Backend Engineer' }),
          questions: expect.arrayContaining([expect.objectContaining({ id: 'q1' })]),
          flashcards: expect.arrayContaining([expect.objectContaining({ id: 'f1' })]),
          coverage: expect.objectContaining({ uncovered_requirement_ids: [] }),
        }),
      })
    );
  });

  test('strips legacy question field from finalized kit.data', async () => {
    const Kit = require('../src/models/Kit');
    const kitWithLegacy = {
      ...baseKit,
      results: {
        ...baseKit.results,
        questions: [
          {
            id: 'q1',
            prompt: 'Explain event loop',
            question: 'Explain event loop',
            answer_outline: 'Cover libuv and the call stack.',
            category: 'technical',
            difficulty: 2,
            requirement_ids: ['r1'],
          },
        ],
      },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kitWithLegacy) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const validateAndFinalize = require('../src/kits/stages/validateAndFinalize');
    await validateAndFinalize('kit123');

    const data = Kit.findByIdAndUpdate.mock.calls[0][1].data;
    expect(data.questions[0].prompt).toBe('Explain event loop');
    expect(data.questions[0]).not.toHaveProperty('question');
  });

  test('strips content-state fields from Appendix A kit.data', async () => {
    const Kit = require('../src/models/Kit');
    const kitWithState = {
      ...baseKit,
      results: {
        ...baseKit.results,
        questions: [
          {
            id: 'q1',
            prompt: 'Explain event loop',
            answer_outline: 'Cover libuv and the call stack.',
            category: 'technical',
            difficulty: 2,
            requirement_ids: ['r1'],
            origin: 'generated',
            edited: false,
            pinned: true,
          },
        ],
        flashcards: [
          {
            id: 'f1',
            front: 'Event loop?',
            back: 'Async mechanism.',
            requirement_ids: ['r1'],
            origin: 'user',
            edited: true,
            pinned: false,
          },
        ],
      },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kitWithState) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const validateAndFinalize = require('../src/kits/stages/validateAndFinalize');
    await validateAndFinalize('kit123');

    const data = Kit.findByIdAndUpdate.mock.calls[0][1].data;
    expect(data.questions[0]).not.toHaveProperty('origin');
    expect(data.questions[0]).not.toHaveProperty('edited');
    expect(data.questions[0]).not.toHaveProperty('pinned');
    expect(data.flashcards[0]).not.toHaveProperty('origin');
    expect(data.flashcards[0]).not.toHaveProperty('edited');
    expect(data.flashcards[0]).not.toHaveProperty('pinned');
    expect(data.questions[0].id).toBe('q1');
    expect(data.flashcards[0].id).toBe('f1');
  });

  test('is idempotent when kit.data already exists', async () => {
    const Kit = require('../src/models/Kit');
    const alreadyDone = { ...baseKit, data: { source: {}, company_brief: {} } };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(alreadyDone) });

    const validateAndFinalize = require('../src/kits/stages/validateAndFinalize');
    await validateAndFinalize('kit123');

    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('throws and does not persist when integrity check fails', async () => {
    const Kit = require('../src/models/Kit');
    const kitWithUncovered = {
      ...baseKit,
      results: {
        ...baseKit.results,
        coverage: { uncovered_requirement_ids: ['r1'], passes: 2 },
      },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kitWithUncovered) });

    const validateAndFinalize = require('../src/kits/stages/validateAndFinalize');
    await expect(validateAndFinalize('kit123')).rejects.toThrow('uncovered_requirement_ids is non-empty');
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('throws when schedule days count mismatches days_available', async () => {
    const Kit = require('../src/models/Kit');
    const badKit = {
      ...baseKit,
      results: {
        ...baseKit.results,
        schedule: {
          days_available: 5,
          days: [{ day: 1, focus: 'technical', question_ids: ['q1'], minutes: 15 }],
        },
      },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(badKit) });

    const validateAndFinalize = require('../src/kits/stages/validateAndFinalize');
    await expect(validateAndFinalize('kit123')).rejects.toThrow('schedule.days has 1 entries but days_available is 5');
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('throws when schedule references unknown question_id', async () => {
    const Kit = require('../src/models/Kit');
    const badKit = {
      ...baseKit,
      results: {
        ...baseKit.results,
        schedule: {
          days_available: 2,
          days: [
            { day: 1, focus: 'technical', question_ids: ['q_ghost'], minutes: 15 },
            { day: 2, focus: 'rest', question_ids: [], minutes: 0 },
          ],
        },
      },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(badKit) });

    const validateAndFinalize = require('../src/kits/stages/validateAndFinalize');
    await expect(validateAndFinalize('kit123')).rejects.toThrow('unknown question_id');
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('succeeds with empty questions/flashcards for thin JD', async () => {
    const Kit = require('../src/models/Kit');
    const thinKit = {
      ...baseKit,
      results: {
        ...baseKit.results,
        requirements: { ...baseKit.results.requirements, items: [] },
        questions: [],
        flashcards: [],
        schedule: {
          days_available: 2,
          days: [
            { day: 1, focus: 'rest', question_ids: [], minutes: 0 },
            { day: 2, focus: 'rest', question_ids: [], minutes: 0 },
          ],
        },
        coverage: { uncovered_requirement_ids: [], passes: 1 },
      },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(thinKit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const validateAndFinalize = require('../src/kits/stages/validateAndFinalize');
    await validateAndFinalize('kit123');
    expect(Kit.findByIdAndUpdate).toHaveBeenCalled();
  });
});
