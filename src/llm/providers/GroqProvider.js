const { OpenAIProvider } = require('./OpenAIProvider');

// Groq via OpenAI-compatible chat completions API.
class GroqProvider extends OpenAIProvider {
  constructor(config = {}) {
    super({
      ...config,
      baseURL: config.baseURL || 'https://api.groq.com/openai/v1',
      model: config.model || 'llama-3.1-8b-instant',
    });
    this._providerName = 'Groq';
  }

  async complete(systemPrompt, userPrompt, options = {}) {
    try {
      return await super.complete(systemPrompt, userPrompt, options);
    } catch (err) {
      const wrapped = new Error(`Groq request failed: ${err.message}`);
      wrapped.provider = 'groq';
      wrapped.cause = err;
      wrapped.statusCode = err.status || err.statusCode;
      throw wrapped;
    }
  }
}

module.exports = { GroqProvider };
