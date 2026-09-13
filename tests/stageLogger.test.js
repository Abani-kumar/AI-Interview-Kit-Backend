const { createStageLogger, truncateData, getStageLoggerOrNoop } = require('../src/logging/stageLogger');
const { runWithStageContext } = require('../src/queue/stageContext');

describe('stageLogger', () => {
  test('records start and complete style entries', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createStageLogger({ kitId: 'kit1', stageName: 'generate-brief' });

    logger.info('stage_start', 'Company brief started');
    logger.info('stage_complete', 'Company brief completed in 1200ms', { durationMs: 1200 });

    const entries = logger.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ event: 'stage_start', level: 'info' });
    expect(entries[1].data).toEqual({ durationMs: 1200 });

    logSpy.mockRestore();
  });

  test('response helper stores payload for later full-log wiring', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createStageLogger({ kitId: 'kit1', stageName: 'extract-requirements' });

    logger.response('gemini', { roleTitle: 'Backend Engineer' }, { call: 'extract' });

    expect(logger.getEntries()[0]).toMatchObject({
      event: 'response',
      level: 'debug',
      data: { call: 'extract', payload: { roleTitle: 'Backend Engineer' } },
    });

    logSpy.mockRestore();
  });

  test('truncateData truncates oversized payloads', () => {
    const big = { text: 'x'.repeat(9000) };
    const truncated = truncateData(big);

    expect(truncated._truncated).toBe(true);
    expect(truncated.originalLength).toBeGreaterThan(8000);
  });
});

describe('stage context', () => {
  test('getStageLoggerOrNoop returns logger inside stage context', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createStageLogger({ kitId: 'kit1', stageName: 'build-schedule' });

    await runWithStageContext({ logger }, async () => {
      getStageLoggerOrNoop().info('allocator', 'schedule built', { days: 7 });
    });

    expect(logger.getEntries()).toHaveLength(1);
    logSpy.mockRestore();
  });
});
