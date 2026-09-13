// Abstract base class. Every provider adapter extends this.
// A new developer adding a provider only needs to implement
// buildRequest() and parseResponse() — nothing else.

class LLMProvider {
  constructor(config = {}) {
    if (new.target === LLMProvider) {
      throw new Error('LLMProvider is abstract — extend it, do not instantiate it directly');
    }
    this.config = config;
  }

  // Must return: { text: string }
  // systemPrompt: string — provider-level instruction (role, format rules)
  // userPrompt: string   — the actual request content
  // options: { temperature?, maxTokens?, expectJson? }
  async complete(systemPrompt, userPrompt, options = {}) {
    throw new Error(`${this.constructor.name} must implement complete()`);
  }

  // Convenience: complete() + JSON.parse() + throw on parse failure
  async completeJSON(systemPrompt, userPrompt, options = {}) {
    const { text } = await this.complete(systemPrompt, userPrompt, {
      ...options,
      expectJson: true,
    });

    let parsed;
    try {
      // Strip markdown code fences that some models add even when told not to
      const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(clean);
    } catch (err) {
      const preview = text.slice(0, 200);
      throw new Error(`LLM returned non-JSON response. Preview: ${preview}`);
    }

    return parsed;
  }
}

module.exports = { LLMProvider };
