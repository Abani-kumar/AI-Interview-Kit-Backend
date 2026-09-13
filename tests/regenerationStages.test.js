jest.mock('../src/models/Kit');
jest.mock('../src/llm/LLMClient');

const Kit = require('../src/models/Kit');
const { getLLMClient } = require('../src/llm/LLMClient');
const {
  withGeneratedState,
  withUserState,
  markEdited,
} = require('../src/kits/contentState');

const validLLMQuestion = {
  prompt: 'Fresh generated question',
  answer_outline: 'Cover architecture, trade-offs, and operational concerns.',
  category: 'technical',
  difficulty: 2,
  requirement_ids: ['r1'],
};

const validLLMFlashcard = {
  front: 'Fresh front',
  back: 'Fresh back',
  requirement_ids: ['r1'],
};

function baseKit(overrides = {}) {
  const { results: resultsOverride, ...restOverrides } = overrides;

  return {
    _id: 'kit123',
    contentRevision: 3,
    input: { jd: 'jd text', companyUrl: 'https://acme.com', days: 2 },
    results: {
      requirements: {
        roleTitle: 'Engineer',
        seniority: 'mid',
        items: [{ id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' }],
      },
      companyData: { name: 'Acme', pagesUsed: [] },
      discussionData: { results: [] },
      companyBrief: withGeneratedState({
        summary: 'Old summary',
        what_they_do: 'Old description',
        sources: [],
      }),
      questions: [
        withGeneratedState({
          id: 'q1',
          prompt: 'Replace me',
          answer_outline: 'Outline',
          category: 'technical',
          difficulty: 1,
          requirement_ids: ['r1'],
        }),
        markEdited(
          withGeneratedState({
            id: 'q2',
            prompt: 'Keep edited',
            answer_outline: 'Outline',
            category: 'technical',
            difficulty: 2,
            requirement_ids: ['r1'],
          })
        ),
        withUserState({
          id: 'q3',
          prompt: 'Keep user',
          answer_outline: 'Outline',
          category: 'behavioural',
          difficulty: 1,
          requirement_ids: [],
        }),
      ],
      flashcards: [
        withGeneratedState({ id: 'f1', front: 'Replace card', back: 'Old back', requirement_ids: [] }),
        withUserState({ id: 'f2', front: 'User card', back: 'User back', requirement_ids: [] }),
      ],
      schedule: { days_available: 2, days: [{ day: 1, question_ids: ['q1'], minutes: 10 }] },
      coverage: { uncovered_requirement_ids: [], passes: 1 },
      coveragePass: 0,
      regeneration: {
        section: 'questions',
        baselineContentRevision: 3,
        missingRequirementIds: null,
      },
      ...resultsOverride,
    },
    stages: { 'generate-questions': { status: 'pending' } },
    ...restOverrides,
  };
}

function mockKitFindById(kit) {
  Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kit) });
}

const { getPersistPayload } = require('./helpers/persistPayload');
const generateQuestions = require('../src/kits/stages/generateQuestions');
const generateFlashcards = require('../src/kits/stages/generateFlashcards');
const generateBrief = require('../src/kits/stages/generateBrief');
const checkCoverage = require('../src/kits/stages/checkCoverage');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('generateQuestions regeneration', () => {
  test('merges fresh generated questions while preserving protected items', async () => {
    const kit = baseKit();
    mockKitFindById(kit);
    Kit.findByIdAndUpdate.mockResolvedValue({});

    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([validLLMQuestion]),
    });

    await generateQuestions('kit123');

    const questions = getPersistPayload(Kit)['results.questions'];

    expect(questions).toHaveLength(3);
    expect(questions[0].prompt).toBe('Fresh generated question');
    expect(questions[0].answer_outline).toBe(validLLMQuestion.answer_outline);
    expect(questions[1].prompt).toBe('Keep edited');
    expect(questions[1].edited).toBe(true);
    expect(questions[2].prompt).toBe('Keep user');
    expect(questions[2].origin).toBe('user');
  });

  test('focused missingRequirementIds appends without replacing protected items', async () => {
    const kit = baseKit({
      results: {
        regeneration: {
          section: 'questions',
          baselineContentRevision: 3,
          missingRequirementIds: ['r1'],
        },
      },
    });
    mockKitFindById(kit);
    Kit.findByIdAndUpdate.mockResolvedValue({});

    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([validLLMQuestion]),
    });

    await generateQuestions('kit123');

    const questions = getPersistPayload(Kit)['results.questions'];
    expect(questions).toHaveLength(4);
    expect(questions[0].prompt).toBe('Replace me');
    expect(questions[3].prompt).toBe('Fresh generated question');
  });

  test('failed regeneration leaves previous content intact on LLM error', async () => {
    const kit = baseKit();
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kit) });

    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockRejectedValue(new Error('LLM failed')),
    });

    await expect(generateQuestions('kit123')).rejects.toThrow('LLM failed');
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('concurrency conflict prevents persist', async () => {
    const kit = baseKit({ contentRevision: 5 });
    mockKitFindById(kit);

    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([validLLMQuestion]),
    });

    await expect(generateQuestions('kit123')).rejects.toMatchObject({
      code: 'REGENERATION_CONFLICT',
    });
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('generateFlashcards regeneration', () => {
  test('merges flashcards while preserving user cards', async () => {
    const kit = baseKit({
      results: {
        regeneration: {
          section: 'flashcards',
          baselineContentRevision: 3,
        },
      },
    });
    mockKitFindById(kit);
    Kit.findByIdAndUpdate.mockResolvedValue({});

    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([validLLMFlashcard]),
    });

    const result = await generateFlashcards('kit123');

    const flashcards = getPersistPayload(Kit)['results.flashcards'];
    expect(flashcards).toHaveLength(2);
    expect(flashcards[0].front).toBe('Fresh front');
    expect(flashcards[1].front).toBe('User card');
    expect(result).toEqual({ next: 'validate-and-finalize' });
  });
});

describe('generateBrief regeneration', () => {
  test('skips LLM when brief is protected and jumps to finalize', async () => {
    const kit = baseKit({
      results: {
        companyBrief: markEdited(
          withGeneratedState({
            summary: 'User edited summary',
            what_they_do: 'Edited',
            sources: [],
          })
        ),
        regeneration: {
          section: 'brief',
          baselineContentRevision: 3,
        },
      },
    });
    mockKitFindById(kit);

    const result = await generateBrief('kit123');

    expect(getLLMClient).not.toHaveBeenCalled();
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ next: 'validate-and-finalize' });
  });
});

describe('checkCoverage after regeneration', () => {
  test('recomputes coverage for merged questions', async () => {
    const kit = {
      ...baseKit(),
      results: {
        ...baseKit().results,
        questions: [
          withUserState({
            id: 'q1',
            prompt: 'Only user question',
            answer_outline: 'Outline',
            category: 'technical',
            difficulty: 1,
            requirement_ids: [],
          }),
        ],
        regeneration: {
          section: 'questions',
          baselineContentRevision: 3,
        },
      },
    };
    mockKitFindById(kit);
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const result = await checkCoverage('kit123');

    const payload = getPersistPayload(Kit);
    expect(payload['results.coverage'].uncovered_requirement_ids).toEqual(['r1']);
    expect(result.next).toBe('generate-questions');
  });
});
