jest.mock('../../src/llm/LLMClient', () => ({
  getLLMClient: jest.fn(),
}));

const { getLLMClient } = require('../../src/llm/LLMClient');
const { splitIntoChunks, isOversized, extractFromChunks } = require('../../src/kits/stages/extractRequirements/chunkExtract');

describe('splitIntoChunks', () => {
  const originalSafe = process.env.SAFE_JD_CHARS;

  beforeEach(() => {
    process.env.SAFE_JD_CHARS = '200';
  });

  afterEach(() => {
    process.env.SAFE_JD_CHARS = originalSafe;
    jest.resetModules();
  });

  test('splits on paragraph boundaries', () => {
    const { splitIntoChunks: split } = require('../../src/kits/stages/extractRequirements/chunkExtract');
    const jd = 'Section one.\n\nSection two.\n\nSection three.';
    const chunks = split(jd);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.join('\n\n')).toContain('Section one');
  });

  test('hard-splits a single oversized paragraph', () => {
    const { splitIntoChunks: split } = require('../../src/kits/stages/extractRequirements/chunkExtract');
    const jd = 'x'.repeat(450);
    const chunks = split(jd);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true);
  });
});

describe('isOversized', () => {
  const originalSafe = process.env.SAFE_JD_CHARS;

  afterEach(() => {
    process.env.SAFE_JD_CHARS = originalSafe;
    jest.resetModules();
  });

  test('returns false for normal JD sizes', () => {
    process.env.SAFE_JD_CHARS = '50000';
    const { isOversized: oversized } = require('../../src/kits/stages/extractRequirements/chunkExtract');
    expect(oversized('Short JD')).toBe(false);
  });

  test('returns true when JD exceeds SAFE_JD_CHARS', () => {
    process.env.SAFE_JD_CHARS = '10';
    const { isOversized: oversized } = require('../../src/kits/stages/extractRequirements/chunkExtract');
    expect(oversized('abcdefghijk')).toBe(true);
  });
});

describe('extractFromChunks', () => {
  const originalSafe = process.env.SAFE_JD_CHARS;

  afterEach(() => {
    process.env.SAFE_JD_CHARS = originalSafe;
    jest.resetModules();
  });

  test('extracts and merges chunk output through the chunk pipeline', async () => {
    process.env.SAFE_JD_CHARS = '50000';
    jest.resetModules();

    const completeJSON = jest.fn().mockResolvedValue({
      roleTitle: 'Backend Engineer',
      seniority: 'Senior',
      responsibilities: ['Build APIs'],
      requirements: [{ text: 'Node.js', kind: 'technical', priority: 'must' }],
    });

    jest.doMock('../../src/llm/LLMClient', () => ({
      getLLMClient: jest.fn(() => ({ completeJSON })),
    }));

    const { extractFromChunks } = require('../../src/kits/stages/extractRequirements/chunkExtract');
    const merged = await extractFromChunks('Short backend role with Node.js requirement.');

    expect(merged.roleTitle).toBe('Backend Engineer');
    expect(merged.requirements).toHaveLength(1);
    expect(merged.requirements[0].text).toBe('Node.js');
    expect(completeJSON).toHaveBeenCalledTimes(1);
  });

  test('rejects malformed JSON from a chunk', async () => {
    process.env.SAFE_JD_CHARS = '50000';
    jest.resetModules();

    jest.doMock('../../src/llm/LLMClient', () => ({
      getLLMClient: jest.fn(() => ({
        completeJSON: jest.fn().mockResolvedValue({
          roleTitle: 'Engineer',
          seniority: 'Mid',
          responsibilities: [],
          requirements: [{ text: '', kind: 'technical', priority: 'must' }],
        }),
      })),
    }));

    const { extractFromChunks } = require('../../src/kits/stages/extractRequirements/chunkExtract');
    await expect(extractFromChunks('Chunk one.\n\nChunk two.')).rejects.toThrow(
      'text must be a non-empty string'
    );
  });
});
