const { LLMProvider } = require('../LLMProvider');
const { wrapProviderError } = require('../llmErrors');

// Google Gemini via @google/generative-ai SDK.
class GeminiProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    // Lazy-load so the SDK is only required when Gemini is the active provider
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const client = new GoogleGenerativeAI(config.apiKey);
    this._model = client.getGenerativeModel({
      model: config.model || 'gemini-1.5-flash',
    });
  }

  async complete(systemPrompt, userPrompt, options = {}) {
    const { temperature = 0.2, maxTokens = 4096, expectJson = false } = options;

    const generationConfig = {
      temperature,
      maxOutputTokens: maxTokens,
      ...(expectJson ? { responseMimeType: 'application/json' } : {}),
    };

    let result;
    try {
      result = await this._model.generateContent({
        systemInstruction: systemPrompt,
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig,
      });
    } catch (err) {
      throw wrapProviderError('Gemini', err);
    }

    const text = result.response?.text?.() ?? '';
    if (!text) throw new Error('Gemini returned an empty response');

    return { text };
  }
}

module.exports = { GeminiProvider };
