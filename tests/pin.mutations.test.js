jest.mock('../src/models/Kit');

const Kit = require('../src/models/Kit');
const {
  pinQuestion,
  unpinQuestion,
  pinFlashcard,
  unpinFlashcard,
} = require('../src/kits/pin.mutations');
const { withGeneratedState, withUserState } = require('../src/kits/contentState');
const { getPersistPayload } = require('./helpers/persistPayload');

// Capture enqueue attempts if any queue module is pulled in accidentally.
jest.mock('../src/queue/queue', () => ({
  enqueueStage: jest.fn(),
  kitQueue: { add: jest.fn() },
}), { virtual: true });

function baseKit() {
  return {
    _id: 'kit123',
    userId: 'user1',
    results: {
      requirements: {
        items: [{ id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' }],
      },
      questions: [
        withGeneratedState({
          id: 'q1',
          prompt: 'Explain the event loop',
          question: 'Explain the event loop',
          answer_outline: 'Call stack + libuv',
          category: 'technical',
          difficulty: 2,
          minutes: 15,
          requirement_ids: ['r1'],
        }),
        withUserState({
          id: 'q2',
          prompt: 'Custom DSA question',
          question: 'Custom DSA question',
          answer_outline: '',
          category: 'technical',
          difficulty: 1,
          minutes: 15,
          requirement_ids: [],
        }),
      ],
      flashcards: [
        withGeneratedState({
          id: 'f1',
          front: 'What is the event loop?',
          back: 'Handles async I/O in Node.js',
          requirement_ids: ['r1'],
        }),
        withUserState({
          id: 'f2',
          front: 'Big-O of binary search?',
          back: 'O(log n)',
          requirement_ids: [],
        }),
      ],
      schedule: {
        days_available: 1,
        days: [{ day: 1, focus: 'technical', question_ids: ['q1', 'q2'], minutes: 30 }],
      },
      coverage: { uncovered_requirement_ids: [], passes: 1 },
    },
    data: null,
  };
}

function mockFindById(kit) {
  Kit.findById.mockImplementation(() => ({
    lean: () => Promise.resolve(kit),
  }));
}

function mockUpdate() {
  Kit.findByIdAndUpdate.mockImplementation((_id, update) => ({
    lean: () =>
      Promise.resolve({
        results: {
          questions: update['results.questions'],
          flashcards: update['results.flashcards'],
        },
      }),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('pinQuestion / unpinQuestion', () => {
  test('pins a generated question without changing other fields', async () => {
    const kit = baseKit();
    const original = { ...kit.results.questions[0] };
    mockFindById(kit);
    mockUpdate();

    await pinQuestion('kit123', 'q1');

    const payload = getPersistPayload(Kit);
    const updated = payload['results.questions'][0];

    expect(updated.pinned).toBe(true);
    expect(updated.origin).toBe('generated');
    expect(updated.edited).toBe(false);
    expect(updated.prompt).toBe(original.prompt);
    expect(updated.requirement_ids).toEqual(original.requirement_ids);
    expect(updated.category).toBe(original.category);
    expect(updated.difficulty).toBe(original.difficulty);

    // Unrelated sections untouched
    expect(payload['results.flashcards']).toBeUndefined();
    expect(payload['results.schedule']).toBeUndefined();
    expect(payload['results.requirements']).toBeUndefined();
  });

  test('unpins a question without changing other fields', async () => {
    const kit = baseKit();
    kit.results.questions[0] = { ...kit.results.questions[0], pinned: true };
    mockFindById(kit);
    mockUpdate();

    await unpinQuestion('kit123', 'q1');

    const updated = getPersistPayload(Kit)['results.questions'][0];
    expect(updated.pinned).toBe(false);
    expect(updated.origin).toBe('generated');
    expect(updated.edited).toBe(false);
    expect(updated.prompt).toBe('Explain the event loop');
  });

  test('can pin a user-created question', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate();

    await pinQuestion('kit123', 'q2');

    const updated = getPersistPayload(Kit)['results.questions'][1];
    expect(updated.pinned).toBe(true);
    expect(updated.origin).toBe('user');
    expect(updated.edited).toBe(false);
  });
});

describe('pinFlashcard / unpinFlashcard', () => {
  test('pins a generated flashcard without changing other fields', async () => {
    const kit = baseKit();
    const original = { ...kit.results.flashcards[0] };
    mockFindById(kit);
    mockUpdate();

    await pinFlashcard('kit123', 'f1');

    const payload = getPersistPayload(Kit);
    const updated = payload['results.flashcards'][0];

    expect(updated.pinned).toBe(true);
    expect(updated.origin).toBe('generated');
    expect(updated.edited).toBe(false);
    expect(updated.front).toBe(original.front);
    expect(updated.back).toBe(original.back);
    expect(updated.requirement_ids).toEqual(original.requirement_ids);

    expect(payload['results.questions']).toBeUndefined();
    expect(payload['results.schedule']).toBeUndefined();
  });

  test('unpins a flashcard without changing other fields', async () => {
    const kit = baseKit();
    kit.results.flashcards[0] = { ...kit.results.flashcards[0], pinned: true };
    mockFindById(kit);
    mockUpdate();

    await unpinFlashcard('kit123', 'f1');

    const updated = getPersistPayload(Kit)['results.flashcards'][0];
    expect(updated.pinned).toBe(false);
    expect(updated.origin).toBe('generated');
    expect(updated.edited).toBe(false);
    expect(updated.front).toBe('What is the event loop?');
  });

  test('can pin a user-created flashcard', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate();

    await pinFlashcard('kit123', 'f2');

    const updated = getPersistPayload(Kit)['results.flashcards'][1];
    expect(updated.pinned).toBe(true);
    expect(updated.origin).toBe('user');
    expect(updated.edited).toBe(false);
  });
});

describe('no BullMQ side effects', () => {
  test('pin/unpin only persist via MongoDB findByIdAndUpdate', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate();

    await pinQuestion('kit123', 'q1');
    await unpinQuestion('kit123', 'q1');
    await pinFlashcard('kit123', 'f1');
    await unpinFlashcard('kit123', 'f1');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledTimes(4);

    // Ensure we never touch queue helpers (virtual mock stays idle).
    let queue;
    try {
      queue = require('../src/queue/queue');
    } catch {
      queue = null;
    }
    if (queue) {
      expect(queue.enqueueStage).not.toHaveBeenCalled();
      expect(queue.kitQueue.add).not.toHaveBeenCalled();
    }
  });
});

describe('ownership protection', () => {
  test('ownsKit rejects non-owners with 404', async () => {
    jest.resetModules();
    jest.doMock('../src/models/Kit', () => ({
      findById: jest.fn().mockResolvedValue({
        userId: { toString: () => 'owner-id' },
      }),
    }));

    const ownsKit = require('../src/middleware/ownsKit');
    const req = {
      params: { id: 'kit123' },
      user: { _id: { toString: () => 'other-user' } },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await ownsKit(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Kit not found' });
    expect(next).not.toHaveBeenCalled();
  });

  test('pin/unpin routes are wired with protect + ownsKit', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../src/kits/kit.routes.js'), 'utf8');

    expect(source).toMatch(/protect,\s*ownsKit,\s*postPinQuestion/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*postUnpinQuestion/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*postPinFlashcard/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*postUnpinFlashcard/);
  });
});
