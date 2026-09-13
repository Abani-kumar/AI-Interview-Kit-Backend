// Tests for generate-questions stage and its sub-modules.
// Uses Jest. Mocks: Kit, LLMClient.

const { validateQuestionsOutput } = require('../src/kits/stages/generateQuestions/questionSchemaValidator');
const { buildQuestionsPrompt } = require('../src/kits/stages/generateQuestions/questionPromptBuilder');

// ─── questionSchemaValidator ──────────────────────────────────────────────────

describe('validateQuestionsOutput', () => {
  const knownIds = new Set(['r1', 'r2', 'r3']);

  const validQuestion = {
    prompt: 'Explain how you would design a rate limiter.',
    answer_outline: 'Cover token bucket vs leaky bucket, distributed state, and failure modes.',
    category: 'system-design',
    difficulty: 2,
    requirement_ids: ['r1'],
  };

  test('accepts a valid single question', () => {
    const result = validateQuestionsOutput([validQuestion], knownIds);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe(validQuestion.prompt);
    expect(result[0].answer_outline).toBe(validQuestion.answer_outline);
  });

  test('accepts an empty array (valid — no questions to generate)', () => {
    const result = validateQuestionsOutput([], knownIds);
    expect(result).toEqual([]);
  });

  test('throws when input is not an array', () => {
    expect(() => validateQuestionsOutput({}, knownIds)).toThrow('must be an array');
  });

  test('throws when prompt is empty', () => {
    expect(() =>
      validateQuestionsOutput([{ ...validQuestion, prompt: '' }], knownIds)
    ).toThrow('Questions schema validation failed');
  });

  test('throws when prompt is missing', () => {
    const { prompt, ...withoutPrompt } = validQuestion;
    expect(() => validateQuestionsOutput([withoutPrompt], knownIds)).toThrow(
      'Questions schema validation failed'
    );
  });

  test('throws when answer_outline is missing', () => {
    const { answer_outline, ...withoutOutline } = validQuestion;
    expect(() => validateQuestionsOutput([withoutOutline], knownIds)).toThrow(
      'Questions schema validation failed'
    );
  });

  test('throws when answer_outline is empty', () => {
    expect(() =>
      validateQuestionsOutput([{ ...validQuestion, answer_outline: '' }], knownIds)
    ).toThrow('Questions schema validation failed');
  });

  test('rejects legacy question field instead of prompt', () => {
    expect(() =>
      validateQuestionsOutput(
        [
          {
            question: 'Legacy question text only',
            category: 'technical',
            difficulty: 2,
            requirement_ids: ['r1'],
          },
        ],
        knownIds
      )
    ).toThrow('legacy "question" field');
  });

  test('throws on invalid category', () => {
    expect(() =>
      validateQuestionsOutput([{ ...validQuestion, category: 'random-category' }], knownIds)
    ).toThrow('Questions schema validation failed');
  });

  test('throws when difficulty is out of range', () => {
    expect(() =>
      validateQuestionsOutput([{ ...validQuestion, difficulty: 4 }], knownIds)
    ).toThrow('Questions schema validation failed');
  });

  test('throws when difficulty is not an integer', () => {
    expect(() =>
      validateQuestionsOutput([{ ...validQuestion, difficulty: 1.5 }], knownIds)
    ).toThrow('Questions schema validation failed');
  });

  test('throws when requirement_ids is empty', () => {
    expect(() =>
      validateQuestionsOutput([{ ...validQuestion, requirement_ids: [] }], knownIds)
    ).toThrow('Questions schema validation failed');
  });

  test('throws when requirement_id references an unknown requirement', () => {
    expect(() =>
      validateQuestionsOutput([{ ...validQuestion, requirement_ids: ['r99'] }], knownIds)
    ).toThrow('unknown requirement_ids: r99');
  });

  test('accepts a question referencing multiple valid requirement IDs', () => {
    const result = validateQuestionsOutput(
      [{ ...validQuestion, requirement_ids: ['r1', 'r2'] }],
      knownIds
    );
    expect(result[0].requirement_ids).toEqual(['r1', 'r2']);
  });

  test('throws when ANY requirement_id in a multi-id question is unknown', () => {
    expect(() =>
      validateQuestionsOutput([{ ...validQuestion, requirement_ids: ['r1', 'r99'] }], knownIds)
    ).toThrow('unknown requirement_ids: r99');
  });
});

// ─── questionPromptBuilder ────────────────────────────────────────────────────

describe('buildQuestionsPrompt', () => {
  const baseArgs = {
    targetRequirements: [{ id: 'r1', kind: 'technical', priority: 'must', text: 'Node.js experience' }],
    allRequirements: [{ id: 'r1', kind: 'technical', priority: 'must', text: 'Node.js experience' }],
    companyBrief: { summary: 'Acme builds APIs.', what_they_do: 'API tooling.' },
    roleTitle: 'Backend Engineer',
    seniority: 'Senior',
    qualityWarnings: [],
    isGapFillPass: false,
  };

  test('includes role context', () => {
    const prompt = buildQuestionsPrompt(baseArgs);
    expect(prompt).toContain('Backend Engineer');
    expect(prompt).toContain('Senior');
  });

  test('includes company brief content', () => {
    const prompt = buildQuestionsPrompt(baseArgs);
    expect(prompt).toContain('Acme builds APIs.');
  });

  test('includes requirement ID and text', () => {
    const prompt = buildQuestionsPrompt(baseArgs);
    expect(prompt).toContain('r1');
    expect(prompt).toContain('Node.js experience');
  });

  test('includes gap-fill pass note when isGapFillPass is true', () => {
    const prompt = buildQuestionsPrompt({ ...baseArgs, isGapFillPass: true });
    expect(prompt).toContain('COVERAGE GAP-FILL');
  });

  test('does NOT include gap-fill note on initial pass', () => {
    const prompt = buildQuestionsPrompt(baseArgs);
    expect(prompt).not.toContain('COVERAGE GAP-FILL');
  });

  test('includes quality warning advisory when warnings present', () => {
    const prompt = buildQuestionsPrompt({
      ...baseArgs,
      qualityWarnings: [{ text: 'Node.js and AWS experience', type: 'compoundRequirementWarning' }],
    });
    expect(prompt).toContain('Node.js and AWS experience');
    expect(prompt).toContain('adequate question coverage');
  });

  test('handles missing company brief gracefully', () => {
    const prompt = buildQuestionsPrompt({ ...baseArgs, companyBrief: null });
    expect(prompt).toContain('company research was incomplete');
  });

  test('includes all requirement IDs reference list on gap-fill when extras exist', () => {
    const prompt = buildQuestionsPrompt({
      ...baseArgs,
      allRequirements: [
        { id: 'r1', kind: 'technical', priority: 'must', text: 'Node.js' },
        { id: 'r2', kind: 'technical', priority: 'must', text: 'AWS' },
      ],
      targetRequirements: [{ id: 'r2', kind: 'technical', priority: 'must', text: 'AWS' }],
      isGapFillPass: true,
    });
    expect(prompt).toContain('r1');
    expect(prompt).toContain('r2');
  });
});

// ─── stage handler (integration-style with mocks) ────────────────────────────

jest.mock('../src/models/Kit');
jest.mock('../src/llm/LLMClient');

describe('generateQuestions stage handler', () => {
  const validLLMQuestion = {
    prompt: 'How would you design a distributed cache?',
    answer_outline: 'Discuss consistency models, eviction, partitioning, and hot keys.',
    category: 'system-design',
    difficulty: 3,
    requirement_ids: ['r1'],
  };

  const baseKit = {
    stages: { 'generate-questions': { status: 'pending' } },
    results: {
      coveragePass: 0,
      requirements: {
        items: [{ id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' }],
        roleTitle: 'Backend Engineer',
        seniority: 'Senior',
        qualityWarnings: [],
      },
      companyBrief: { summary: 'Acme.', what_they_do: 'APIs.' },
      questions: null,
      coverage: null,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('persists questions with Appendix A contract on initial pass', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([validLLMQuestion]),
    });

    const generateQuestions = require('../src/kits/stages/generateQuestions');
    await generateQuestions('kit123');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledWith(
      'kit123',
      expect.objectContaining({
        'results.questions': expect.arrayContaining([
          expect.objectContaining({
            id: 'q1',
            prompt: validLLMQuestion.prompt,
            answer_outline: validLLMQuestion.answer_outline,
            category: validLLMQuestion.category,
            difficulty: validLLMQuestion.difficulty,
            requirement_ids: validLLMQuestion.requirement_ids,
            origin: 'generated',
            edited: false,
            pinned: false,
          }),
        ]),
      })
    );

    const persisted = Kit.findByIdAndUpdate.mock.calls[0][1]['results.questions'][0];
    expect(persisted).not.toHaveProperty('question');
    expect(persisted).not.toHaveProperty('minutes');
  });

  test('is idempotent on initial pass when questions already exist', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    const doneKit = {
      ...baseKit,
      stages: { 'generate-questions': { status: 'done' } },
      results: {
        ...baseKit.results,
        questions: [{ id: 'q1', prompt: 'existing', answer_outline: 'Outline' }],
      },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(doneKit) });

    const generateQuestions = require('../src/kits/stages/generateQuestions');
    await generateQuestions('kit123');

    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(getLLMClient).not.toHaveBeenCalled();
  });

  test('appends gap-fill questions with continuing IDs', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    const gapFillKit = {
      ...baseKit,
      stages: { 'generate-questions': { status: 'pending' } },
      results: {
        ...baseKit.results,
        coveragePass: 1,
        questions: [{ id: 'q1', prompt: 'existing question', answer_outline: 'Outline' }],
        coverage: { uncovered_requirement_ids: ['r1'] },
      },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(gapFillKit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([validLLMQuestion]),
    });

    const generateQuestions = require('../src/kits/stages/generateQuestions');
    await generateQuestions('kit123');

    const updateCall = Kit.findByIdAndUpdate.mock.calls[0][1];
    const allQ = updateCall['results.questions'];
    expect(allQ).toHaveLength(2);
    expect(allQ[0].id).toBe('q1');
    expect(allQ[1].id).toBe('q2');
    expect(allQ[1].prompt).toBe(validLLMQuestion.prompt);
    expect(allQ[1].answer_outline).toBe(validLLMQuestion.answer_outline);
  });

  test('throws on schema validation failure so BullMQ retries', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit) });
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([{ ...validLLMQuestion, difficulty: 5 }]),
    });

    const generateQuestions = require('../src/kits/stages/generateQuestions');
    await expect(generateQuestions('kit123')).rejects.toThrow('Questions schema validation failed');
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('throws when model invents an unknown requirement_id', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit) });
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([{ ...validLLMQuestion, requirement_ids: ['r_fake'] }]),
    });

    const generateQuestions = require('../src/kits/stages/generateQuestions');
    await expect(generateQuestions('kit123')).rejects.toThrow('unknown requirement_ids');
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('throws on LLM call failure so BullMQ retries', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit) });
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockRejectedValue(new Error('rate limit exceeded')),
    });

    const generateQuestions = require('../src/kits/stages/generateQuestions');
    await expect(generateQuestions('kit123')).rejects.toThrow('rate limit exceeded');
  });

  test('skips gap-fill if no uncovered requirements despite coveragePass > 0', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    const noGapsKit = {
      ...baseKit,
      stages: { 'generate-questions': { status: 'pending' } },
      results: {
        ...baseKit.results,
        coveragePass: 1,
        questions: [{ id: 'q1', prompt: 'existing', answer_outline: 'Outline' }],
        coverage: { uncovered_requirement_ids: [] },
      },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(noGapsKit) });

    const generateQuestions = require('../src/kits/stages/generateQuestions');
    await generateQuestions('kit123');

    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(getLLMClient).not.toHaveBeenCalled();
  });

  test('proceeds with empty companyBrief (sparse research)', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    const sparseKit = {
      ...baseKit,
      results: { ...baseKit.results, companyBrief: null },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(sparseKit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([validLLMQuestion]),
    });

    const generateQuestions = require('../src/kits/stages/generateQuestions');
    await generateQuestions('kit123');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalled();
  });
});
