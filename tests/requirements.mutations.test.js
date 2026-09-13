jest.mock('../src/models/Kit');

const Kit = require('../src/models/Kit');
const { getPersistPayload } = require('./helpers/persistPayload');
const {
  updateRequirement,
  addRequirement,
  deleteRequirement,
  reorderRequirements,
  nextRequirementId,
  recomputeCoverage,
  detachRequirementRefs,
} = require('../src/kits/requirements.mutations');

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
          question: 'How do you structure a Node service?',
          category: 'technical',
          difficulty: 2,
          minutes: 15,
          requirement_ids: ['r1'],
        },
      ],
      flashcards: [
        {
          id: 'f1',
          front: 'Event loop?',
          back: 'Handles async I/O',
          requirement_ids: ['r1'],
        },
      ],
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

describe('nextRequirementId', () => {
  test('allocates next sequential id', () => {
    expect(nextRequirementId([{ id: 'r1' }, { id: 'r2' }])).toBe('r3');
    expect(nextRequirementId([])).toBe('r1');
    expect(nextRequirementId([{ id: 'r5' }, { id: 'custom' }])).toBe('r6');
  });
});

describe('recomputeCoverage', () => {
  test('nice → must with no question becomes uncovered', () => {
    const requirements = [
      { id: 'r1', priority: 'must' },
      { id: 'r2', priority: 'must' },
    ];
    const coverage = recomputeCoverage(requirements, [{ id: 'q1', requirement_ids: ['r1'] }], {
      uncovered_requirement_ids: [],
      passes: 2,
    });
    expect(coverage.uncovered_requirement_ids).toEqual(['r2']);
    expect(coverage.passes).toBe(2);
  });

  test('must → nice removes from mandatory coverage', () => {
    const requirements = [{ id: 'r1', priority: 'nice' }];
    const coverage = recomputeCoverage(requirements, [], { passes: 1 });
    expect(coverage.uncovered_requirement_ids).toEqual([]);
  });
});

describe('detachRequirementRefs', () => {
  test('removes the requirement id and keeps empty arrays valid', () => {
    const items = [
      { id: 'q1', requirement_ids: ['r1', 'r2'] },
      { id: 'q2', requirement_ids: ['r1'] },
    ];
    const result = detachRequirementRefs(items, 'r1');
    expect(result[0].requirement_ids).toEqual(['r2']);
    expect(result[1].requirement_ids).toEqual([]);
  });
});

describe('updateRequirement', () => {
  test('updates requirement text/kind/priority and returns coverage', async () => {
    const kit = baseKit();
    mockFindById(kit);
    const updated = {
      ...kit,
      results: {
        ...kit.results,
        requirements: {
          ...kit.results.requirements,
          items: [
            { id: 'r1', text: 'Deep Node.js experience', kind: 'technical', priority: 'must' },
            kit.results.requirements.items[1],
          ],
        },
        coverage: { uncovered_requirement_ids: [], passes: 1 },
      },
    };
    mockUpdate(updated);

    const result = await updateRequirement('kit123', 'r1', {
      text: 'Deep Node.js experience',
    });

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    const payload = getPersistPayload(Kit);
    expect(payload['results.requirements'].items[0].text).toBe('Deep Node.js experience');
    expect(payload['results.requirements'].items[0].id).toBe('r1');
    expect(result.requirements[0].text).toBe('Deep Node.js experience');
    expect(result.coverage).toEqual({ uncovered_requirement_ids: [], passes: 1 });
  });

  test('must → nice removes mandatory coverage gap', async () => {
    const kit = baseKit({
      results: {
        questions: [],
        flashcards: [],
        coverage: { uncovered_requirement_ids: ['r1'], passes: 1 },
        requirements: {
          roleTitle: 'Backend Engineer',
          seniority: 'mid',
          responsibilities: [],
          items: [{ id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' }],
        },
      },
    });
    mockFindById(kit);
    mockUpdate({
      results: {
        requirements: {
          items: [{ id: 'r1', text: 'Node.js', kind: 'technical', priority: 'nice' }],
        },
        coverage: { uncovered_requirement_ids: [], passes: 1 },
      },
    });

    const result = await updateRequirement('kit123', 'r1', { priority: 'nice' });
    const payload = getPersistPayload(Kit);
    expect(payload['results.requirements'].items[0].priority).toBe('nice');
    expect(payload['results.coverage'].uncovered_requirement_ids).toEqual([]);
    expect(result.coverage.uncovered_requirement_ids).toEqual([]);
  });

  test('nice → must with no question → uncovered', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        requirements: {
          items: [
            kit.results.requirements.items[0],
            { id: 'r2', text: 'Clear communication', kind: 'behavioural', priority: 'must' },
          ],
        },
        coverage: { uncovered_requirement_ids: ['r2'], passes: 1 },
      },
    });

    const result = await updateRequirement('kit123', 'r2', { priority: 'must' });
    const payload = getPersistPayload(Kit);
    expect(payload['results.coverage'].uncovered_requirement_ids).toEqual(['r2']);
    expect(result.coverage.uncovered_requirement_ids).toContain('r2');
  });

  test('rejects invalid requirement data', async () => {
    mockFindById(baseKit());

    await expect(updateRequirement('kit123', 'r1', { text: '   ' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(updateRequirement('kit123', 'r1', { kind: 'soft-skill' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(updateRequirement('kit123', 'r1', { priority: 'optional' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(updateRequirement('kit123', 'r99', { text: 'Nope' })).rejects.toMatchObject({
      status: 404,
    });
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('addRequirement', () => {
  test('adds a requirement with application-generated unique id', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        requirements: {
          items: [
            ...kit.results.requirements.items,
            { id: 'r3', text: 'System design', kind: 'technical', priority: 'must' },
          ],
        },
        coverage: { uncovered_requirement_ids: ['r3'], passes: 1 },
      },
    });

    const result = await addRequirement('kit123', {
      text: 'System design',
      kind: 'technical',
      priority: 'must',
    });

    const payload = getPersistPayload(Kit);
    const items = payload['results.requirements'].items;
    expect(items).toHaveLength(3);
    expect(items[2]).toEqual({
      id: 'r3',
      text: 'System design',
      kind: 'technical',
      priority: 'must',
    });
    expect(payload['results.coverage'].uncovered_requirement_ids).toEqual(['r3']);
    expect(result.requirement.id).toBe('r3');
  });

  test('rejects invalid add payloads', async () => {
    mockFindById(baseKit());
    await expect(
      addRequirement('kit123', { text: '', kind: 'technical', priority: 'must' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      addRequirement('kit123', { text: 'X', kind: 'technical', priority: 'must', index: 99 })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('reorderRequirements', () => {
  test('reorders without changing ids or content', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        requirements: {
          items: [kit.results.requirements.items[1], kit.results.requirements.items[0]],
        },
        coverage: { uncovered_requirement_ids: [], passes: 1 },
      },
    });

    await reorderRequirements('kit123', ['r2', 'r1']);

    const items = getPersistPayload(Kit)['results.requirements'].items;
    expect(items.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(items[0]).toEqual(kit.results.requirements.items[1]);
    expect(items[1]).toEqual(kit.results.requirements.items[0]);
  });

  test('rejects invalid orderings', async () => {
    mockFindById(baseKit());
    await expect(reorderRequirements('kit123', ['r1'])).rejects.toMatchObject({ status: 400 });
    await expect(reorderRequirements('kit123', ['r1', 'r1'])).rejects.toMatchObject({ status: 400 });
    await expect(reorderRequirements('kit123', ['r1', 'r99'])).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('deleteRequirement', () => {
  test('deletes requirement and detaches question references atomically', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        requirements: { items: [kit.results.requirements.items[1]] },
        questions: [{ ...kit.results.questions[0], requirement_ids: [] }],
        flashcards: [{ ...kit.results.flashcards[0], requirement_ids: [] }],
        coverage: { uncovered_requirement_ids: [], passes: 1 },
      },
    });

    await deleteRequirement('kit123', 'r1');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    const payload = getPersistPayload(Kit);
    expect(payload['results.requirements'].items.map((r) => r.id)).toEqual(['r2']);
    expect(payload['results.questions'][0].requirement_ids).toEqual([]);
    expect(payload['results.flashcards'][0].requirement_ids).toEqual([]);
    expect(payload['results.questions'][0].id).toBe('q1');
    expect(payload['results.flashcards'][0].id).toBe('f1');
  });

  test('deletes requirement and detaches flashcard references', async () => {
    const kit = baseKit({
      results: {
        questions: [],
        flashcards: [
          { id: 'f1', front: 'A', back: 'B', requirement_ids: ['r2'] },
          { id: 'f2', front: 'C', back: 'D', requirement_ids: ['r1', 'r2'] },
        ],
        coverage: { uncovered_requirement_ids: [], passes: 1 },
        requirements: {
          items: [
            { id: 'r1', text: 'Node.js', kind: 'technical', priority: 'nice' },
            { id: 'r2', text: 'Comms', kind: 'behavioural', priority: 'nice' },
          ],
        },
      },
    });
    mockFindById(kit);
    mockUpdate({
      results: {
        requirements: { items: [kit.results.requirements.items[1]] },
        questions: [],
        flashcards: [
          { id: 'f1', front: 'A', back: 'B', requirement_ids: ['r2'] },
          { id: 'f2', front: 'C', back: 'D', requirement_ids: ['r2'] },
        ],
        coverage: { uncovered_requirement_ids: [], passes: 1 },
      },
    });

    await deleteRequirement('kit123', 'r1');
    const payload = getPersistPayload(Kit);
    expect(payload['results.flashcards'][0].requirement_ids).toEqual(['r2']);
    expect(payload['results.flashcards'][1].requirement_ids).toEqual(['r2']);
  });

  test('does not enqueue jobs or call LLM (single Mongo write only)', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        requirements: { items: [kit.results.requirements.items[1]] },
        questions: [{ ...kit.results.questions[0], requirement_ids: [] }],
        flashcards: [{ ...kit.results.flashcards[0], requirement_ids: [] }],
        coverage: { uncovered_requirement_ids: [], passes: 1 },
      },
    });

    await deleteRequirement('kit123', 'r1');
    expect(Kit.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(Object.keys(Kit).filter((k) => typeof Kit[k] === 'function')).not.toContain('enqueue');
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

  test('requirement mutation routes are wired with protect + ownsKit', () => {
    // Read the route source to avoid importing queue/worker connections.
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../src/kits/kit.routes.js'),
      'utf8'
    );

    expect(source).toMatch(/protect,\s*ownsKit,\s*postRequirement/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*putRequirementsOrder/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*patchRequirement/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*removeRequirement/);
  });
});
