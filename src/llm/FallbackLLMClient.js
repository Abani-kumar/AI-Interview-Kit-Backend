const { LLMProvider } = require('./LLMProvider');
const { shouldFallbackToGroq, isGeminiRetryable } = require('./llmErrors');
const { withRetries } = require('./retry');
const { getStageLoggerOrNoop } = require('../logging/stageLogger');

// Gemini primary, Groq fallback — mirrors the Python LLMClient pattern.
// Free-tier Gemini quota/rate limits automatically route to Groq.
class FallbackLLMClient extends LLMProvider {
  constructor({ gemini, groq, maxRetries = 3 } = {}) {
    super();
    if (!gemini) {
      throw new Error('Gemini provider is required for FallbackLLMClient');
    }

    this._gemini = gemini;
    this._groq = groq;
    this._maxRetries = maxRetries;
    this._groqModelName = groq?.config?.model || process.env.GROQ_MODEL_NAME || 'llama-3.1-8b-instant';
  }

  async _logCall(provider, startedMs, options, usedFallback = false) {
    const logger = getStageLoggerOrNoop();
    logger.info('llm_call', `${provider} call completed`, {
      provider,
      durationMs: Date.now() - startedMs,
      expectJson: Boolean(options.expectJson),
      usedFallback,
    });
  }

  async complete(systemPrompt, userPrompt, options = {}) {
    const maxRetries = options.maxRetries ?? this._maxRetries;
    const geminiStartedMs = Date.now();

    try {
      const result = await withRetries(
        () => this._gemini.complete(systemPrompt, userPrompt, options),
        { maxRetries, isRetryable: isGeminiRetryable }
      );
      await this._logCall('gemini', geminiStartedMs, options);
      return result;
    } catch (error) {
      if (!this._groq || !shouldFallbackToGroq(error)) {
        throw error;
      }

      const logger = getStageLoggerOrNoop();
      logger.warn(
        'llm_fallback',
        `Gemini unavailable — falling back to Groq (${this._groqModelName})`,
        { reason: error.message }
      );

      console.warn(
        `Gemini unavailable (${error.constructor?.name || 'Error'}). ` +
          `Falling back to Groq: ${this._groqModelName}`
      );

      const groqStartedMs = Date.now();
      const result = await withRetries(
        () => this._groq.complete(systemPrompt, userPrompt, options),
        { maxRetries, isRetryable: () => true }
      );
      await this._logCall('groq', groqStartedMs, options, true);
      return result;
    }
  }
}

module.exports = { FallbackLLMClient };
