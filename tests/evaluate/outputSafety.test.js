const { runBatch, buildFailureResult } = require('../../src/evaluate/batchEvaluator');
const { buildError, ERROR_CODES } = require('../../src/evaluate/errors');

jest.mock('../../src/kits/createAndEnqueueKit');
jest.mock('../../src/evaluate/waitForKit');
jest.mock('../../src/kits/kit.validator', () => ({
  validateKitStructure: jest.fn(),
}));

const { createAndEnqueueKit } = require('../../src/kits/createAndEnqueueKit');
const { waitForKit } = require('../../src/evaluate/waitForKit');

describe('evaluate output safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('failed results never include raw secret values in error messages', async () => {
    createAndEnqueueKit.mockResolvedValue({ _id: 'kit-1' });
    waitForKit.mockResolvedValue({
      status: 'failed',
      error: 'LLM failed: api_key=super-secret-token',
    });

    const results = await runBatch([
      { id: 'case-1', jd: 'Backend', company_url: 'https://a.com', days: 5 },
    ]);

    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain('super-secret-token');
    expect(results[0].error.message).toContain('[redacted]');
  });

  test('buildFailureResult preserves structured evaluator errors', () => {
    const result = buildFailureResult('case-1', buildError(ERROR_CODES.INVALID_INPUT, 'Bad case'));
    expect(result).toEqual({
      id: 'case-1',
      status: 'failed',
      error: { code: ERROR_CODES.INVALID_INPUT, message: 'Bad case' },
    });
  });
});
