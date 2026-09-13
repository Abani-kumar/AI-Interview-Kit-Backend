const { validateFlashcardsOutput } = require('../src/kits/stages/generateFlashcards/flashcardSchemaValidator');
const { buildFlashcardsPrompt } = require('../src/kits/stages/generateFlashcards/flashcardPromptBuilder');

// ─── flashcardSchemaValidator ─────────────────────────────────────────────────

describe('validateFlashcardsOutput', () => {
  const knownIds = new Set(['r1', 'r2', 'r3']);

  const validCard = {
    front: 'What is event loop in Node.js?',
    back: 'The mechanism that handles async callbacks in a single-threaded runtime.',
    requirement_ids: ['r1'],
  };

  test('accepts a valid flashcard array', () => {
    const result = validateFlashcardsOutput([validCard], knownIds);
    expect(result).toHaveLength(1);
    expect(result[0].front).toBe(validCard.front);
  });

  test('accepts empty array (thin question set)', () => {
    expect(validateFlashcardsOutput([], knownIds)).toEqual([]);
  });

  test('throws when input is not an array', () => {
    expect(() => validateFlashcardsOutput({}, knownIds)).toThrow('must be an array');
  });

  test('throws when front is empty', () => {
    expect(() =>
      validateFlashcardsOutput([{ ...validCard, front: '' }], knownIds)
    ).toThrow('Flashcard schema validation failed');
  });

  test('throws when back is empty', () => {
    expect(() =>
      validateFlashcardsOutput([{ ...validCard, back: '' }], knownIds)
    ).toThrow('Flashcard schema validation failed');
  });

  test('throws when requirement_ids is empty', () => {
    expect(() =>
      validateFlashcardsOutput([{ ...validCard, requirement_ids: [] }], knownIds)
    ).toThrow('Flashcard schema validation failed');
  });

  test('throws when requirement_id references unknown requirement', () => {
    expect(() =>
      validateFlashcardsOutput([{ ...validCard, requirement_ids: ['r_fake'] }], knownIds)
    ).toThrow('unknown requirement_ids: r_fake');
  });

  test('accepts card referencing multiple valid requirement IDs', () => {
    const result = validateFlashcardsOutput(
      [{ ...validCard, requirement_ids: ['r1', 'r2'] }],
      knownIds
    );
    expect(result[0].requirement_ids).toEqual(['r1', 'r2']);
  });

  test('throws when any requirement_id in multi-id card is unknown', () => {
    expect(() =>
      validateFlashcardsOutput(
        [{ ...validCard, requirement_ids: ['r1', 'r_unknown'] }],
        knownIds
      )
    ).toThrow('unknown requirement_ids: r_unknown');
  });
});

// ─── flashcardPromptBuilder ───────────────────────────────────────────────────

describe('buildFlashcardsPrompt', () => {
  const requirements = [
    { id: 'r1', priority: 'must', text: 'Node.js' },
    { id: 'r2', priority: 'nice', text: 'Redis' },
  ];

  const questions = [
    { id: 'q1', prompt: 'How does Node.js handle async?', answer_outline: 'Event loop.', category: 'technical', difficulty: 2, requirement_ids: ['r1'] },
    { id: 'q2', question: 'What is Redis?', category: 'technical', difficulty: 1, requirement_ids: ['r2'] },
  ];

  test('includes valid requirement IDs in prompt', () => {
    const prompt = buildFlashcardsPrompt(questions, requirements);
    expect(prompt).toContain('r1');
    expect(prompt).toContain('r2');
  });

  test('includes question text from prompt field', () => {
    const prompt = buildFlashcardsPrompt(questions, requirements);
    expect(prompt).toContain('How does Node.js handle async?');
  });

  test('falls back to question field when prompt is absent', () => {
    const prompt = buildFlashcardsPrompt(questions, requirements);
    expect(prompt).toContain('What is Redis?');
  });

  test('includes answer_outline when present', () => {
    const prompt = buildFlashcardsPrompt(questions, requirements);
    expect(prompt).toContain('Event loop.');
  });

  test('wraps content in <questions> delimiters', () => {
    const prompt = buildFlashcardsPrompt(questions, requirements);
    expect(prompt).toContain('<questions>');
    expect(prompt).toContain('</questions>');
  });

  test('handles empty questions array gracefully', () => {
    const prompt = buildFlashcardsPrompt([], requirements);
    expect(prompt).toContain('(no questions available)');
  });

  test('handles empty requirements gracefully', () => {
    const prompt = buildFlashcardsPrompt(questions, []);
    expect(prompt).toContain('<questions>');
  });

  test('sorts must-have requirements first', () => {
    const prompt = buildFlashcardsPrompt(questions, requirements);
    const r1Pos = prompt.indexOf('q1');
    const r2Pos = prompt.indexOf('q2');
    // q1 (must-have) should appear before q2 (nice)
    expect(r1Pos).toBeLessThan(r2Pos);
  });
});

// ─── stage handler (integration-style with mocks) ────────────────────────────

jest.mock('../src/models/Kit');
jest.mock('../src/llm/LLMClient');

describe('generateFlashcards stage handler', () => {
  const baseKit = {
    stages: { 'generate-flashcards': { status: 'pending' } },
    results: {
      requirements: {
        items: [{ id: 'r1', priority: 'must', text: 'Node.js' }],
      },
      questions: [
        {
          id: 'q1',
          prompt: 'Explain the Node.js event loop.',
          answer_outline: 'Single-threaded, non-blocking I/O via libuv.',
          category: 'technical',
          difficulty: 2,
          requirement_ids: ['r1'],
        },
      ],
      flashcards: null,
    },
  };

  const validLLMCard = {
    front: 'What is the Node.js event loop?',
    back: 'A mechanism for handling async operations via libuv.',
    requirement_ids: ['r1'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('persists flashcards with application-assigned IDs', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([validLLMCard]),
    });

    const generateFlashcards = require('../src/kits/stages/generateFlashcards');
    await generateFlashcards('kit123');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledWith(
      'kit123',
      expect.objectContaining({
        'results.flashcards': expect.arrayContaining([
          expect.objectContaining({
            id: 'f1',
            front: validLLMCard.front,
            origin: 'generated',
            edited: false,
            pinned: false,
          }),
        ]),
      })
    );
  });

  test('is idempotent when flashcards already exist', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    const doneKit = {
      ...baseKit,
      stages: { 'generate-flashcards': { status: 'done' } },
      results: {
        ...baseKit.results,
        flashcards: [{ id: 'f1', front: 'existing', back: 'card', requirement_ids: ['r1'] }],
      },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(doneKit) });

    const generateFlashcards = require('../src/kits/stages/generateFlashcards');
    await generateFlashcards('kit123');

    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(getLLMClient).not.toHaveBeenCalled();
  });

  test('persists empty array when LLM returns [] for thin question set', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([]),
    });

    const generateFlashcards = require('../src/kits/stages/generateFlashcards');
    await generateFlashcards('kit123');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledWith(
      'kit123',
      expect.objectContaining({ 'results.flashcards': [] })
    );
  });

  test('throws on schema validation failure so BullMQ retries', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit) });
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([{ front: '', back: 'answer', requirement_ids: ['r1'] }]),
    });

    const generateFlashcards = require('../src/kits/stages/generateFlashcards');
    await expect(generateFlashcards('kit123')).rejects.toThrow('Flashcard schema validation failed');
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('throws when model invents unknown requirement_id', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit) });
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([{ ...validLLMCard, requirement_ids: ['r_invented'] }]),
    });

    const generateFlashcards = require('../src/kits/stages/generateFlashcards');
    await expect(generateFlashcards('kit123')).rejects.toThrow('unknown requirement_ids');
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('throws on LLM call failure so BullMQ retries', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit) });
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockRejectedValue(new Error('provider timeout')),
    });

    const generateFlashcards = require('../src/kits/stages/generateFlashcards');
    await expect(generateFlashcards('kit123')).rejects.toThrow('provider timeout');
  });

  test('proceeds with empty questions array without inventing content', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    const emptyKit = {
      ...baseKit,
      results: { ...baseKit.results, questions: [] },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(emptyKit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue([]),
    });

    const generateFlashcards = require('../src/kits/stages/generateFlashcards');
    await generateFlashcards('kit123');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledWith(
      'kit123',
      expect.objectContaining({ 'results.flashcards': [] })
    );
  });
});
