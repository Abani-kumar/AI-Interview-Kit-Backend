const { BraveSearchProvider } = require('./providers/BraveSearchProvider');

const PROVIDERS = { brave: (cfg) => new BraveSearchProvider(cfg) };

let _instance = null;

function getSearchClient() {
  if (_instance) return _instance;

  const providerKey = (process.env.SEARCH_PROVIDER || 'brave').toLowerCase();
  const factory = PROVIDERS[providerKey];

  if (!factory) {
    throw new Error(`Unknown SEARCH_PROVIDER "${providerKey}". Valid: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  const config = { apiKey: process.env.SEARCH_API_KEY };
  if (!config.apiKey) throw new Error('SEARCH_API_KEY env var is required');

  _instance = factory(config);
  return _instance;
}

function resetSearchClient() {
  _instance = null;
}

module.exports = { getSearchClient, resetSearchClient };
