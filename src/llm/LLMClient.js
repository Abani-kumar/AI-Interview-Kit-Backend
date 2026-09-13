// Factory. Returns a Gemini-primary client with optional Groq fallback.
// All application code imports from here — never a provider directly.
//
// Env (preferred):
//   GEMINI_API_KEY, GEMINI_MODEL_NAME
//   GROQ_API_KEY, GROQ_MODEL_NAME
//
// Legacy fallbacks (deprecated):
//   LLM_API_KEY -> GEMINI_API_KEY
//   LLM_MODEL   -> GEMINI_MODEL_NAME

const { GeminiProvider } = require('./providers/GeminiProvider');
const { GroqProvider } = require('./providers/GroqProvider');
const { FallbackLLMClient } = require('./FallbackLLMClient');
const { OpenAIProvider } = require('./providers/OpenAIProvider');

const PROVIDERS = {
  gemini: (cfg) => new GeminiProvider(cfg),
  groq: (cfg) => new GroqProvider(cfg),
  openai: (cfg) => new OpenAIProvider(cfg),
};

let _instance = null;

function readEnv() {
  const geminiApiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL_NAME || process.env.LLM_MODEL || 'gemini-1.5-flash';
  const groqApiKey = process.env.GROQ_API_KEY;
  const groqModel = process.env.GROQ_MODEL_NAME || 'llama-3.1-8b-instant';

  return { geminiApiKey, geminiModel, groqApiKey, groqModel };
}

function getLLMClient() {
  if (_instance) return _instance;

  const providerKey = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  const { geminiApiKey, geminiModel, groqApiKey, groqModel } = readEnv();

  // Explicit single-provider mode (openai / groq-only / gemini-only)
  if (providerKey === 'openai') {
    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('LLM_API_KEY or OPENAI_API_KEY is required when LLM_PROVIDER=openai');
    _instance = PROVIDERS.openai({
      apiKey,
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      baseURL: process.env.LLM_BASE_URL,
    });
    return _instance;
  }

  if (providerKey === 'groq') {
    if (!groqApiKey) throw new Error('GROQ_API_KEY env var is required when LLM_PROVIDER=groq');
    _instance = PROVIDERS.groq({ apiKey: groqApiKey, model: groqModel });
    return _instance;
  }

  if (providerKey === 'gemini' && process.env.LLM_DISABLE_GROQ_FALLBACK === 'true') {
    if (!geminiApiKey) throw new Error('GEMINI_API_KEY (or LLM_API_KEY) is required');
    _instance = PROVIDERS.gemini({ apiKey: geminiApiKey, model: geminiModel });
    return _instance;
  }

  // Default: Gemini primary + Groq fallback (free-tier friendly)
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY (or LLM_API_KEY) env var is required');
  }

  const gemini = new GeminiProvider({ apiKey: geminiApiKey, model: geminiModel });
  const groq = groqApiKey ? new GroqProvider({ apiKey: groqApiKey, model: groqModel }) : null;

  if (!groq) {
    console.warn(
      'GROQ_API_KEY not set — Gemini fallback disabled. ' +
        'Set GROQ_API_KEY and GROQ_MODEL_NAME to auto-failover on quota/rate limits.'
    );
  }

  _instance = new FallbackLLMClient({ gemini, groq });
  return _instance;
}

function resetLLMClient() {
  _instance = null;
}

module.exports = { getLLMClient, resetLLMClient, readEnv };
