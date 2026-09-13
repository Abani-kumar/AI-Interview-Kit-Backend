jest.mock('../../src/models/Kit');

const Kit = require('../../src/models/Kit');
const { waitForKit, TERMINAL_STATUSES } = require('../../src/evaluate/waitForKit');

describe('waitForKit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns immediately for terminal statuses', async () => {
    const readyKit = { _id: 'kit1', status: 'ready', data: { source: {} } };
    Kit.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: () => Promise.resolve(readyKit) }),
    });

    const result = await waitForKit('kit1', { pollIntervalMs: 100, timeoutMs: 1000 });
    expect(result).toEqual(readyKit);
    expect(TERMINAL_STATUSES.has('ready')).toBe(true);
  });

  test('polls until kit becomes ready', async () => {
    jest.useFakeTimers();

    Kit.findById
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: () => Promise.resolve({ _id: 'kit1', status: 'generating' }),
        }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: () => Promise.resolve({ _id: 'kit1', status: 'ready', data: {} }),
        }),
      });

    const promise = waitForKit('kit1', { pollIntervalMs: 100, timeoutMs: 5000 });
    await jest.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result.status).toBe('ready');
    expect(Kit.findById).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  test('throws timeout error when kit never reaches terminal status', async () => {
    Kit.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: () => Promise.resolve({ _id: 'kit1', status: 'generating' }),
      }),
    });

    await expect(
      waitForKit('kit1', { pollIntervalMs: 10, timeoutMs: 30 })
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
