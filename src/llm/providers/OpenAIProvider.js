const { LLMProvider } = require('../LLMProvider');

// OpenAI / OpenAI-compatible endpoints (Groq, OpenRouter, local vLLM, etc.)
// Set OPENAI_BASE_URL in env to point at any OpenAI-compatible endpoint.
class OpenAIProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    const OpenAI = require('openai');
    this._client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL, // undefined = default OpenAI endpoint
    });
    this._model = config.model || 'gpt-4o-mini';
  }

  async complete(systemPrompt, userPrompt, options = {}) {
    const { temperature = 0.2, maxTokens = 4096, expectJson = false } = options;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let response;
    try {
      response = await this._client.chat.completions.create({
        model: this._model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(expectJson ? { response_format: { type: 'json_object' } } : {}),
      });
    } catch (err) {
      throw new Error(`OpenAI request failed: ${err.message}`);
    }

    const text = response.choices?.[0]?.message?.content ?? '';
    if (!text) throw new Error('OpenAI returned an empty response');

    return { text };
  }
}

module.exports = { OpenAIProvider };
