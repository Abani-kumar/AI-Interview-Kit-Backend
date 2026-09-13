class PublicSearchProvider {
  constructor(config = {}) {
    if (new.target === PublicSearchProvider) {
      throw new Error('PublicSearchProvider is abstract — extend it, do not instantiate directly');
    }
    this.config = config;
  }

  async search(query, options = {}) {
    throw new Error(`${this.constructor.name} must implement search()`);
  }
}

module.exports = { PublicSearchProvider };
