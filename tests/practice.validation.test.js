jest.mock('../src/models/Kit');

const Kit = require('../src/models/Kit');
const { recordPracticeAttempt, getPracticeSummary } = require('../src/kits/practice.mutations');

function baseKit(overrides = {}) {
  return {
    _id: 'kit123',
    userId: 'user1',
    status: 'ready',
    results: {
      flashcards: [{ id: 'f1', front: 'Q', back: 'A', requirement_ids: ['r1'] }],
      requirements: { items: [{ id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' }] },
    },
    practice: { attempts: [] },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('practice validation', () => {
  test.each(['low', 'medium', 'high'])('accepts confidence "%s"', async (confidence) => {
    const kit = baseKit();
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kit) });
    Kit.findByIdAndUpdate.mockReturnValue({ lean: () => Promise.resolve(kit) });

    const result = await recordPracticeAttempt('kit123', 'f1', { confidence });
    expect(result.attempt.confidence).toBe(confidence);
  });

  test('rejects invalid confidence', async () => {
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit()) });
    await expect(recordPracticeAttempt('kit123', 'f1', { confidence: 'sure' })).rejects.toMatchObject({
      status: 400,
    });
  });

  test('rejects missing kit', async () => {
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(null) });
    await expect(recordPracticeAttempt('missing', 'f1', { confidence: 'low' })).rejects.toMatchObject({
      status: 404,
    });
  });

  test('rejects invalid flashcard id', async () => {
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit()) });
    await expect(recordPracticeAttempt('kit123', 'f_missing', { confidence: 'low' })).rejects.toMatchObject({
      status: 404,
    });
  });

  test('rejects kits without flashcards', async () => {
    Kit.findById.mockReturnValue({
      lean: () => Promise.resolve(baseKit({ results: { flashcards: [], requirements: { items: [] } } })),
    });
    await expect(recordPracticeAttempt('kit123', 'f1', { confidence: 'low' })).rejects.toMatchObject({
      status: 409,
    });
  });

  test('getPracticeSummary rejects missing kit', async () => {
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(null) });
    await expect(getPracticeSummary('missing')).rejects.toMatchObject({ status: 404 });
  });
});
