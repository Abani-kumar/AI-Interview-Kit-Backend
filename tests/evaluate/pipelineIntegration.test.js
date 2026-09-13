jest.mock('../../src/models/Kit', () => ({
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));

jest.mock('../../src/queue/queue', () => ({
  enqueueStage: jest.fn(),
}));

const Kit = require('../../src/models/Kit');
const { enqueueStage } = require('../../src/queue/queue');
const { createAndEnqueueKit, FIRST_STAGE } = require('../../src/kits/createAndEnqueueKit');
const { stageRegistry } = require('../../src/queue/stageRegistry');

describe('batch evaluator pipeline integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Kit.create.mockResolvedValue({ _id: 'kit-123' });
    enqueueStage.mockResolvedValue({ id: 'job-1' });
  });

  test('createAndEnqueueKit uses the same first stage as the HTTP kit flow', async () => {
    const userId = '507f1f77bcf86cd799439011';

    const kit = await createAndEnqueueKit({
      userId,
      jd: 'Backend engineer',
      companyUrl: 'https://example.com',
      days: 5,
    });

    expect(Kit.create).toHaveBeenCalledWith({
      userId,
      input: {
        jd: 'Backend engineer',
        companyUrl: 'https://example.com',
        days: 5,
      },
      currentStage: FIRST_STAGE,
      status: 'queued',
    });

    expect(enqueueStage).toHaveBeenCalledWith(
      kit._id,
      FIRST_STAGE,
      stageRegistry[FIRST_STAGE].jobOptions,
      0
    );
  });

  test('batch evaluator module depends on createAndEnqueueKit, not the legacy kitPipeline', () => {
    const batchEvaluatorSource = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../src/evaluate/batchEvaluator.js'),
      'utf8'
    );
    const evaluateScriptSource = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../scripts/evaluate.js'),
      'utf8'
    );

    expect(batchEvaluatorSource).toContain("require('../kits/createAndEnqueueKit')");
    expect(batchEvaluatorSource).not.toContain('kitPipeline');
    expect(evaluateScriptSource).toContain("require('../src/evaluate/batchEvaluator')");
    expect(evaluateScriptSource).not.toContain('kitPipeline');
  });
});
