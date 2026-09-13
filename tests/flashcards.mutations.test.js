jest.mock('../src/models/Kit');

const Kit = require('../src/models/Kit');
const {
  updateFlashcard,
  addFlashcard,
  deleteFlashcard,
  reorderFlashcards,
  nextFlashcardId,
} = require('../src/kits/flashcards.mutations');
const { withGeneratedState } = require('../src/kits/contentState');
const { getPersistPayload } = require('./helpers/persistPayload');

function baseKit(overrides = {}) {
  return {
    _id: 'kit123',
    userId: 'user1',
    results: {
      requirements: {
        roleTitle: 'Backend Engineer',
        seniority: 'mid',
        responsibilities: ['Build APIs'],
        items: [
          { id: 'r1', text: 'Node.js experience', kind: 'technical', priority: 'must' },
          { id: 'r2', text: 'Clear communication', kind: 'behavioural', priority: 'nice' },
        ],
      },
      questions: [
        {
          id: 'q1',
          prompt: 'How do you structure a Node service?',
          category: 'technical',
          difficulty: 2,
          minutes: 15,
          requirement_ids: ['r1'],
        },
      ],
      flashcards: [
        withGeneratedState({
          id: 'f1',
          front: 'What is the event loop?',
          back: 'Node.js mechanism for handling async I/O',
          requirement_ids: ['r1'],
        }),
        withGeneratedState({
          id: 'f2',
          front: 'What is STAR?',
          back: 'Situation, Task, Action, Result',
          requirement_ids: ['r2'],
        }),
      ],
      schedule: {
        days_available: 2,
        days: [
          { day: 1, focus: 'technical', question_ids: ['q1'], minutes: 15 },
          { day: 2, focus: 'rest', question_ids: [], minutes: 0 },
        ],
      },
      coverage: { uncovered_requirement_ids: [], passes: 1 },
      ...overrides.results,
    },
    data: null,
    ...overrides,
  };
}

function mockFindById(kit) {
  Kit.findById.mockImplementation(() => ({
    lean: () => Promise.resolve(kit),
  }));
}

function mockUpdate(updatedKit) {
  Kit.findByIdAndUpdate.mockImplementation(() => ({
    lean: () => Promise.resolve(updatedKit),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('nextFlashcardId', () => {
  test('allocates next sequential id', () => {
    expect(nextFlashcardId([{ id: 'f1' }, { id: 'f2' }])).toBe('f3');
    expect(nextFlashcardId([])).toBe('f1');
    expect(nextFlashcardId([{ id: 'f5' }, { id: 'custom' }])).toBe('f6');
  });
});

describe('updateFlashcard', () => {
  test('editing a generated flashcard sets edited = true', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        flashcards: [
          {
            ...kit.results.flashcards[0],
            front: 'Updated front',
            edited: true,
            origin: 'generated',
            pinned: false,
          },
          kit.results.flashcards[1],
        ],
      },
    });

    await updateFlashcard('kit123', 'f1', { front: 'Updated front' });

    const payload = getPersistPayload(Kit);
    const updated = payload['results.flashcards'][0];
    expect(updated.front).toBe('Updated front');
    expect(updated.origin).toBe('generated');
    expect(updated.edited).toBe(true);
    expect(updated.pinned).toBe(false);
    // Must not touch questions/schedule/requirements
    expect(payload['results.questions']).toBeUndefined();
    expect(payload['results.schedule']).toBeUndefined();
    expect(payload['results.requirements']).toBeUndefined();
  });

  test('rejects empty front/back', async () => {
    mockFindById(baseKit());

    await expect(updateFlashcard('kit123', 'f1', { front: '   ' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(updateFlashcard('kit123', 'f1', { back: '' })).rejects.toMatchObject({
      status: 400,
    });
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects invalid requirement id', async () => {
    mockFindById(baseKit());
    await expect(
      updateFlashcard('kit123', 'f1', { requirement_ids: ['r99'] })
    ).rejects.toMatchObject({ status: 400 });
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('allows empty requirement_ids on update', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        flashcards: [{ ...kit.results.flashcards[0], requirement_ids: [], edited: true }],
      },
    });

    await updateFlashcard('kit123', 'f1', { requirement_ids: [] });
    const payload = getPersistPayload(Kit);
    expect(payload['results.flashcards'][0].requirement_ids).toEqual([]);
    expect(payload['results.flashcards'][0].edited).toBe(true);
  });
});

describe('addFlashcard', () => {
  test('adds custom flashcard with origin = user', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        flashcards: [
          ...kit.results.flashcards,
          {
            id: 'f3',
            front: 'What is CAP?',
            back: 'Consistency, Availability, Partition tolerance',
            requirement_ids: [],
            origin: 'user',
            edited: false,
            pinned: false,
          },
        ],
      },
    });

    const result = await addFlashcard('kit123', {
      front: 'What is CAP?',
      back: 'Consistency, Availability, Partition tolerance',
      requirement_ids: [],
    });

    const payload = getPersistPayload(Kit);
    const added = payload['results.flashcards'][2];
    expect(added.id).toBe('f3');
    expect(added.origin).toBe('user');
    expect(added.edited).toBe(false);
    expect(added.pinned).toBe(false);
    expect(added.requirement_ids).toEqual([]);
    expect(result.flashcard.origin).toBe('user');
  });

  test('custom flashcard with empty requirement_ids is allowed', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        flashcards: [
          ...kit.results.flashcards,
          {
            id: 'f3',
            front: 'Big-O of binary search?',
            back: 'O(log n)',
            requirement_ids: [],
            origin: 'user',
            edited: false,
            pinned: false,
          },
        ],
      },
    });

    await addFlashcard('kit123', {
      front: 'Big-O of binary search?',
      back: 'O(log n)',
      requirement_ids: [],
    });

    const added = getPersistPayload(Kit)['results.flashcards'][2];
    expect(added.requirement_ids).toEqual([]);
  });

  test('rejects unknown requirement id on add', async () => {
    mockFindById(baseKit());
    await expect(
      addFlashcard('kit123', {
        front: 'Front',
        back: 'Back',
        requirement_ids: ['r_missing'],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  test('rejects missing front/back on add', async () => {
    mockFindById(baseKit());
    await expect(addFlashcard('kit123', { front: 'Only front' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(addFlashcard('kit123', { back: 'Only back' })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('deleteFlashcard', () => {
  test('deletes flashcard without affecting questions/schedule/requirements', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        flashcards: [kit.results.flashcards[1]],
      },
    });

    await deleteFlashcard('kit123', 'f1');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    const payload = getPersistPayload(Kit);
    expect(payload['results.flashcards'].map((c) => c.id)).toEqual(['f2']);
    expect(payload['results.questions']).toBeUndefined();
    expect(payload['results.schedule']).toBeUndefined();
    expect(payload['results.requirements']).toBeUndefined();
  });
});

describe('reorderFlashcards', () => {
  test('reorders while preserving ids and content', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        flashcards: [kit.results.flashcards[1], kit.results.flashcards[0]],
      },
    });

    await reorderFlashcards('kit123', ['f2', 'f1']);

    const items = getPersistPayload(Kit)['results.flashcards'];
    expect(items.map((c) => c.id)).toEqual(['f2', 'f1']);
    expect(items[0].front).toBe(kit.results.flashcards[1].front);
    expect(items[1].front).toBe(kit.results.flashcards[0].front);
    expect(items[0].requirement_ids).toEqual(['r2']);
    expect(items[1].requirement_ids).toEqual(['r1']);
  });

  test('rejects invalid orderings', async () => {
    mockFindById(baseKit());
    await expect(reorderFlashcards('kit123', ['f1'])).rejects.toMatchObject({ status: 400 });
    await expect(reorderFlashcards('kit123', ['f1', 'f1'])).rejects.toMatchObject({ status: 400 });
    await expect(reorderFlashcards('kit123', ['f1', 'f99'])).rejects.toMatchObject({
      status: 400,
    });
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

  test('flashcard mutation routes are wired with protect + ownsKit', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../src/kits/kit.routes.js'), 'utf8');

    expect(source).toMatch(/protect,\s*ownsKit,\s*postFlashcard/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*putFlashcardsOrder/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*patchFlashcard/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*removeFlashcard/);
  });
});
