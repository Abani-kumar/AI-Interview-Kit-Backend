const { stageJobId, resolveNextPassNumber } = require('../src/queue/jobId');

describe('resolveNextPassNumber / stageJobId', () => {
  test('preserves regeneration pass for downstream stages (not reset to 0)', () => {
    const regenPass = 1789315644110;
    expect(resolveNextPassNumber(undefined, regenPass)).toBe(regenPass);
    expect(resolveNextPassNumber('check-coverage', regenPass)).toBe(regenPass);
    expect(resolveNextPassNumber('generate-flashcards', regenPass)).toBe(regenPass);
  });

  test('bumps only when looping back to generate-questions', () => {
    expect(resolveNextPassNumber('generate-questions', 0)).toBe(1);
    expect(resolveNextPassNumber('generate-questions', 3)).toBe(4);
  });

  test('regeneration chain produces unique jobIds vs initial :0 run', () => {
    const kitId = 'kit123';
    const regenPass = 1789315644110;

    expect(stageJobId(kitId, 'check-coverage', 0)).toBe('kit123:check-coverage:0');
    expect(stageJobId(kitId, 'check-coverage', regenPass)).toBe(
      `kit123:check-coverage:${regenPass}`
    );
    expect(stageJobId(kitId, 'check-coverage', regenPass)).not.toBe(
      stageJobId(kitId, 'check-coverage', 0)
    );
  });
});
