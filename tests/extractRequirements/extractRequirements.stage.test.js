jest.mock('../../src/models/Kit');
jest.mock('../../src/llm/LLMClient');

const Kit = require('../../src/models/Kit');
const { getLLMClient } = require('../../src/llm/LLMClient');

describe('extractRequirements stage handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('persists normalized requirements with stable IDs', async () => {
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue({
        roleTitle: 'Backend Engineer',
        seniority: 'Senior',
        responsibilities: ['Build APIs'],
        requirements: [
          { text: 'Node.js', kind: 'technical', priority: 'must' },
          { text: 'Strong Java, Python, or Go skills', kind: 'technical', priority: 'must' },
        ],
      }),
    });

    Kit.findById.mockReturnValue({
      lean: () =>
        Promise.resolve({
          input: { jd: 'Backend engineer role with Node.js and Java/Python/Go.' },
          stages: { 'extract-requirements': { status: 'pending' } },
          results: {},
        }),
    });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const extractRequirements = require('../../src/kits/stages/extractRequirements/extractRequirements');
    await extractRequirements('kit123');

    const payload = Kit.findByIdAndUpdate.mock.calls[0][1]['results.requirements'];
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0].id).toBe('r1');
    expect(payload.items[1].text).toBe('Strong Java, Python, or Go skills');
    expect(payload.qualityWarnings).toHaveLength(0);
  });

  test('is idempotent when stage already completed', async () => {
    Kit.findById.mockReturnValue({
      lean: () =>
        Promise.resolve({
          input: { jd: 'Role' },
          stages: { 'extract-requirements': { status: 'done' } },
          results: { requirements: { items: [{ id: 'r1' }] } },
        }),
    });

    const extractRequirements = require('../../src/kits/stages/extractRequirements/extractRequirements');
    await extractRequirements('kit123');

    expect(getLLMClient).not.toHaveBeenCalled();
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('throws when JD text is missing', async () => {
    Kit.findById.mockReturnValue({
      lean: () =>
        Promise.resolve({
          input: { jd: '   ' },
          stages: { 'extract-requirements': { status: 'pending' } },
          results: {},
        }),
    });

    const extractRequirements = require('../../src/kits/stages/extractRequirements/extractRequirements');
    await expect(extractRequirements('kit123')).rejects.toThrow('Kit has no JD text');
  });
});
