jest.mock('../../src/kits/createAndEnqueueKit');
jest.mock('../../src/evaluate/waitForKit');
jest.mock('../../src/kits/kit.validator', () => ({
  validateKitStructure: jest.fn(),
}));

const { createAndEnqueueKit } = require('../../src/kits/createAndEnqueueKit');
const { waitForKit } = require('../../src/evaluate/waitForKit');
const { validateKitStructure } = require('../../src/kits/kit.validator');
const { runBatch } = require('../../src/evaluate/batchEvaluator');
const { ERROR_CODES } = require('../../src/evaluate/errors');

const validKit = {
  source: { company: 'Acme', company_url: 'https://acme.com', role: 'Eng', location: 'Remote', jd_chars: 10, researched_at: '2026-01-01T00:00:00.000Z', pages_used: [] },
  company_brief: { summary: 's', what_they_do: 'w', sources: [] },
  role: { title: 'Eng', seniority: 'Mid', responsibilities: [], requirements: [] },
  questions: [],
  flashcards: [],
  schedule: { days_available: 1, days: [{ day: 1, focus: 'rest', question_ids: [], minutes: 0 }] },
  coverage: { uncovered_requirement_ids: [], passes: 1 },
};

describe('runBatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    validateKitStructure.mockImplementation(() => {});
  });

  test('processes a valid batch with multiple successful cases', async () => {
    createAndEnqueueKit
      .mockResolvedValueOnce({ _id: 'kit-1' })
      .mockResolvedValueOnce({ _id: 'kit-2' });
    waitForKit
      .mockResolvedValueOnce({ status: 'ready', data: validKit })
      .mockResolvedValueOnce({ status: 'ready', data: validKit });

    const results = await runBatch([
      { id: 'case-1', jd: 'Backend', company_url: 'https://a.com', days: 5 },
      { id: 'case-2', jd: 'Frontend', company_url: 'https://b.com', days: 10 },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ id: 'case-1', status: 'success', kit: validKit });
    expect(results[1]).toEqual({ id: 'case-2', status: 'success', kit: validKit });
    expect(createAndEnqueueKit).toHaveBeenCalledTimes(2);
    expect(validateKitStructure).toHaveBeenCalledTimes(2);
  });

  test('continues processing when one case fails', async () => {
    createAndEnqueueKit.mockResolvedValueOnce({ _id: 'kit-2' });
    waitForKit.mockResolvedValueOnce({ status: 'ready', data: validKit });

    const results = await runBatch([
      { id: 'case-1', jd: '', company_url: 'https://a.com', days: 5 },
      { id: 'case-2', jd: 'Frontend', company_url: 'https://b.com', days: 10 },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('failed');
    expect(results[0].error.code).toBe(ERROR_CODES.INVALID_INPUT);
    expect(results[1].status).toBe('success');
    expect(createAndEnqueueKit).toHaveBeenCalledTimes(1);
  });

  test('returns structured error for malformed case', async () => {
    const results = await runBatch([{ id: 'case-1', jd: 'x', days: 5 }]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: 'case-1',
      status: 'failed',
      error: {
        code: ERROR_CODES.INVALID_INPUT,
        message: expect.stringContaining('company_url'),
      },
    });
  });

  test('returns one result per processed case', async () => {
    createAndEnqueueKit
      .mockResolvedValueOnce({ _id: 'kit-1' })
      .mockResolvedValueOnce({ _id: 'kit-2' })
      .mockResolvedValueOnce({ _id: 'kit-3' });
    waitForKit
      .mockResolvedValueOnce({ status: 'ready', data: validKit })
      .mockResolvedValueOnce({ status: 'failed', error: 'stage failed' })
      .mockResolvedValueOnce({ status: 'ready', data: validKit });

    const results = await runBatch([
      { id: 'case-1', jd: 'A', company_url: 'https://a.com', days: 5 },
      { id: 'case-2', jd: 'B', company_url: 'https://b.com', days: 5 },
      { id: 'case-3', jd: 'C', company_url: 'https://c.com', days: 5 },
    ]);

    expect(results).toHaveLength(3);
    expect(results.map((item) => item.id)).toEqual(['case-1', 'case-2', 'case-3']);
  });

  test('successful result contains finalized validated kit', async () => {
    createAndEnqueueKit.mockResolvedValue({ _id: 'kit-1' });
    waitForKit.mockResolvedValue({ status: 'ready', data: validKit });

    const results = await runBatch([
      { id: 'case-1', jd: 'Backend', company_url: 'https://a.com', days: 5 },
    ]);

    expect(results[0].status).toBe('success');
    expect(results[0].kit).toEqual(validKit);
    expect(validateKitStructure).toHaveBeenCalledWith(validKit);
  });

  test('failed result contains structured generation error', async () => {
    createAndEnqueueKit.mockResolvedValue({ _id: 'kit-1' });
    waitForKit.mockResolvedValue({ status: 'failed', error: 'LLM rate limit' });

    const results = await runBatch([
      { id: 'case-1', jd: 'Backend', company_url: 'https://a.com', days: 5 },
    ]);

    expect(results[0]).toEqual({
      id: 'case-1',
      status: 'failed',
      error: {
        code: ERROR_CODES.GENERATION_FAILED,
        message: 'LLM rate limit',
      },
    });
  });

  test('reports validation failure for ready kits without valid data', async () => {
    createAndEnqueueKit.mockResolvedValue({ _id: 'kit-1' });
    waitForKit.mockResolvedValue({ status: 'ready', data: validKit });
    validateKitStructure.mockImplementation(() => {
      throw new Error('Missing required top-level section: "coverage"');
    });

    const results = await runBatch([
      { id: 'case-1', jd: 'Backend', company_url: 'https://a.com', days: 5 },
    ]);

    expect(results[0].status).toBe('failed');
    expect(results[0].error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  test('reports enqueue failure without stopping other cases', async () => {
    createAndEnqueueKit
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValueOnce({ _id: 'kit-2' });
    waitForKit.mockResolvedValueOnce({ status: 'ready', data: validKit });

    const results = await runBatch([
      { id: 'case-1', jd: 'Backend', company_url: 'https://a.com', days: 5 },
      { id: 'case-2', jd: 'Frontend', company_url: 'https://b.com', days: 5 },
    ]);

    expect(results[0].error.code).toBe(ERROR_CODES.ENQUEUE_FAILED);
    expect(results[1].status).toBe('success');
  });
});
