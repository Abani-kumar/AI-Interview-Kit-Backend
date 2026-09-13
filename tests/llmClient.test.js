const { shouldFallbackToGroq, isGeminiRetryable } = require('../src/llm/llmErrors');
const { FallbackLLMClient } = require('../src/llm/FallbackLLMClient');
const { getLLMClient, resetLLMClient, readEnv } = require('../src/llm/LLMClient');

describe('llmErrors', () => {
  test('shouldFallbackToGroq on 429', () => {
    const err = new Error('rate limited');
    err.statusCode = 429;
    expect(shouldFallbackToGroq(err)).toBe(true);
  });

  test('shouldFallbackToGroq on RESOURCE_EXHAUSTED', () => {
    expect(shouldFallbackToGroq(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
  });

  test('shouldFallbackToGroq on connection reset', () => {
    expect(shouldFallbackToGroq(new Error('read ECONNRESET'))).toBe(true);
  });

  test('shouldFallbackToGroq on 5xx', () => {
    const err = new Error('server error');
    err.statusCode = 503;
    expect(shouldFallbackToGroq(err)).toBe(true);
  });

  test('does not fallback on validation errors', () => {
    expect(shouldFallbackToGroq(new Error('invalid prompt'))).toBe(false);
  });

  test('isGeminiRetryable on 503', () => {
    const err = new Error('unavailable');
    err.statusCode = 503;
    expect(isGeminiRetryable(err)).toBe(true);
  });
});

describe('FallbackLLMClient', () => {
  const system = 'system';
  const user = 'user';

  test('uses Gemini when successful', async () => {
    const gemini = { complete: jest.fn().mockResolvedValue({ text: 'ok' }) };
    const groq = { complete: jest.fn() };
    const client = new FallbackLLMClient({ gemini, groq });

    const result = await client.complete(system, user);

    expect(result).toEqual({ text: 'ok' });
    expect(gemini.complete).toHaveBeenCalledTimes(1);
    expect(groq.complete).not.toHaveBeenCalled();
  });

  test('falls back to Groq on Gemini 429', async () => {
    const geminiErr = new Error('quota');
    geminiErr.statusCode = 429;

    const gemini = { complete: jest.fn().mockRejectedValue(geminiErr) };
    const groq = { complete: jest.fn().mockResolvedValue({ text: 'from groq' }) };
    const client = new FallbackLLMClient({ gemini, groq });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await client.complete(system, user);

    expect(result).toEqual({ text: 'from groq' });
    expect(groq.complete).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  test('retries Gemini on transient 503 then succeeds', async () => {
    const gemini = {
      complete: jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('down'), { statusCode: 503 }))
        .mockResolvedValue({ text: 'recovered' }),
    };
    const groq = { complete: jest.fn() };
    const client = new FallbackLLMClient({ gemini, groq, maxRetries: 3 });

    const result = await client.complete(system, user);

    expect(result).toEqual({ text: 'recovered' });
    expect(gemini.complete).toHaveBeenCalledTimes(2);
    expect(groq.complete).not.toHaveBeenCalled();
  });

  test('completeJSON parses Gemini response', async () => {
    const gemini = { complete: jest.fn().mockResolvedValue({ text: '{"ok":true}' }) };
    const client = new FallbackLLMClient({ gemini, groq: null });

    const parsed = await client.completeJSON(system, user);
    expect(parsed).toEqual({ ok: true });
  });

  test('throws when Gemini fails and no Groq configured', async () => {
    const geminiErr = new Error('quota');
    geminiErr.statusCode = 429;
    const gemini = { complete: jest.fn().mockRejectedValue(geminiErr) };
    const client = new FallbackLLMClient({ gemini, groq: null });

    await expect(client.complete(system, user)).rejects.toThrow('quota');
  });
});

describe('getLLMClient factory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetLLMClient();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
    resetLLMClient();
  });

  test('readEnv prefers GEMINI_* and GROQ_* vars', () => {
    process.env.GEMINI_API_KEY = 'g-key';
    process.env.GEMINI_MODEL_NAME = 'gemini-2.0-flash';
    process.env.GROQ_API_KEY = 'q-key';
    process.env.GROQ_MODEL_NAME = 'llama-3.1-70b-versatile';

    expect(readEnv()).toEqual({
      geminiApiKey: 'g-key',
      geminiModel: 'gemini-2.0-flash',
      groqApiKey: 'q-key',
      groqModel: 'llama-3.1-70b-versatile',
    });
  });

  test('readEnv falls back to legacy LLM_* vars', () => {
    delete process.env.GEMINI_API_KEY;
    process.env.LLM_API_KEY = 'legacy-key';
    process.env.LLM_MODEL = 'gemini-1.5-pro';

    expect(readEnv().geminiApiKey).toBe('legacy-key');
    expect(readEnv().geminiModel).toBe('gemini-1.5-pro');
  });

  test('throws when GEMINI_API_KEY missing in default mode', () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_PROVIDER;

    expect(() => getLLMClient()).toThrow('GEMINI_API_KEY');
  });

  test('returns FallbackLLMClient when both keys set', () => {
    process.env.GEMINI_API_KEY = 'g-key';
    process.env.GROQ_API_KEY = 'q-key';

    const client = getLLMClient();
    expect(client.constructor.name).toBe('FallbackLLMClient');
  });
});
