// Tests for the generate-brief stage and its sub-modules.
// Uses Jest. Mocks: LLMClient, Kit.findById, Kit.findByIdAndUpdate.

const { validateBriefOutput } = require('../src/kits/stages/generateBrief/briefSchemaValidator');
const { buildSources } = require('../src/kits/stages/generateBrief/sourceBuilder');
const { buildBriefPrompt, buildKeyEvidence } = require('../src/kits/stages/generateBrief/briefPromptBuilder');

// --- briefSchemaValidator ---

describe('validateBriefOutput', () => {
  test('accepts a valid full output', () => {
    const result = validateBriefOutput({
      summary: 'Acme builds developer tools.',
      what_they_do: 'They make CI/CD pipelines.',
      interview_relevance: 'Know their product well.',
      hiring_signals: ['take-home assessment', 'system design round'],
      interview_signals: ['values ownership'],
    });
    expect(result.summary).toBe('Acme builds developer tools.');
    expect(result.hiring_signals).toHaveLength(2);
  });

  test('accepts valid empty strings and arrays (partial research)', () => {
    const result = validateBriefOutput({
      summary: '',
      what_they_do: '',
    });
    expect(result.summary).toBe('');
    expect(result.hiring_signals).toEqual([]);
    expect(result.interview_signals).toEqual([]);
  });

  test('throws when summary is missing', () => {
    expect(() =>
      validateBriefOutput({ what_they_do: 'They do things.' })
    ).toThrow('Brief schema validation failed');
  });

  test('throws when what_they_do is missing', () => {
    expect(() =>
      validateBriefOutput({ summary: 'A company.' })
    ).toThrow('Brief schema validation failed');
  });

  test('throws when hiring_signals is not an array', () => {
    expect(() =>
      validateBriefOutput({
        summary: 'A company.',
        what_they_do: 'They do things.',
        hiring_signals: 'should be array',
      })
    ).toThrow('Brief schema validation failed');
  });

  test('throws on invalid JSON input (non-object)', () => {
    expect(() => validateBriefOutput('plain string')).toThrow('Brief schema validation failed');
  });

  test('throws on null input', () => {
    expect(() => validateBriefOutput(null)).toThrow('Brief schema validation failed');
  });
});

// --- sourceBuilder ---

describe('buildSources', () => {
  test('collects URLs from pages and discussion results', () => {
    const companyData = { pages: [{ url: 'https://acme.com/about' }, { url: 'https://acme.com/careers' }] };
    const discussionData = { results: [{ url: 'https://glassdoor.com/acme-review' }] };
    const sources = buildSources(companyData, discussionData);
    expect(sources).toHaveLength(3);
    expect(sources).toContain('https://acme.com/about');
  });

  test('deduplicates equivalent URLs', () => {
    const companyData = { pages: [{ url: 'https://acme.com/about/' }, { url: 'https://acme.com/about' }] };
    const discussionData = { results: [] };
    const sources = buildSources(companyData, discussionData);
    expect(sources).toHaveLength(1);
  });

  test('filters out invalid and non-HTTP URLs', () => {
    const companyData = { pages: [{ url: 'not-a-url' }, { url: 'ftp://old.acme.com' }, { url: 'https://acme.com' }] };
    const discussionData = { results: [] };
    const sources = buildSources(companyData, discussionData);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toBe('https://acme.com/');
  });

  test('returns empty array when both inputs are empty', () => {
    expect(buildSources({}, {})).toEqual([]);
  });

  test('handles missing pages and results gracefully', () => {
    expect(buildSources(null, null)).toEqual([]);
    expect(buildSources({ pages: null }, { results: null })).toEqual([]);
  });
});

// --- briefPromptBuilder ---

describe('buildBriefPrompt', () => {
  test('includes role context when requirements present', () => {
    const prompt = buildBriefPrompt(
      { pages: [] },
      { results: [] },
      { roleTitle: 'Backend Engineer', seniority: 'Senior' }
    );
    expect(prompt).toContain('Backend Engineer');
    expect(prompt).toContain('Senior');
  });

  test('includes evidence delimiters', () => {
    const prompt = buildBriefPrompt({ pages: [] }, { results: [] }, {});
    expect(prompt).toContain('<evidence>');
    expect(prompt).toContain('</evidence>');
  });

  test('handles no pages gracefully', () => {
    const prompt = buildBriefPrompt({ pages: [] }, { results: [] }, {});
    expect(prompt).toContain('(no company pages retrieved)');
  });

  test('handles no discussion results gracefully', () => {
    const prompt = buildBriefPrompt({ pages: [] }, { results: [] }, {});
    expect(prompt).toContain('(no public discussion found)');
  });

  test('marks hiring pages with [HIRING PAGE] label', () => {
    const companyData = { pages: [{ url: 'https://acme.com/careers', title: 'Careers', text: 'Join us', isHiringPage: true }] };
    const prompt = buildBriefPrompt(companyData, { results: [] }, {});
    expect(prompt).toContain('[HIRING PAGE]');
  });
});

describe('buildKeyEvidence', () => {
  test('only includes hiring pages, not all pages', () => {
    const companyData = {
      pages: [
        { url: 'https://acme.com', title: 'Home', text: 'We build tools', isHiringPage: false },
        { url: 'https://acme.com/careers', title: 'Careers', text: 'Join us', isHiringPage: true },
      ],
    };
    const result = buildKeyEvidence(companyData, { results: [] });
    expect(result.hiringPages).toHaveLength(1);
    expect(result.hiringPages[0].url).toBe('https://acme.com/careers');
  });

  test('bounds discussion snippets to MAX count', () => {
    const results = Array.from({ length: 10 }, (_, i) => ({
      url: `https://glassdoor.com/review-${i}`,
      title: `Review ${i}`,
      snippet: 'Great place',
    }));
    const result = buildKeyEvidence({ pages: [] }, { results });
    expect(result.boundedDiscussionSnippets.length).toBeLessThanOrEqual(5);
  });

  test('returns empty arrays when no data', () => {
    const result = buildKeyEvidence(null, null);
    expect(result.hiringPages).toEqual([]);
    expect(result.boundedDiscussionSnippets).toEqual([]);
  });
});

// --- stage handler (integration-style with mocks) ---

jest.mock('../src/models/Kit');
jest.mock('../src/llm/LLMClient');

describe('generateBrief stage handler', () => {
  const mockKitBase = {
    stages: { 'generate-brief': { status: 'pending' } },
    input: { companyUrl: 'https://acme.com' },
    results: {
      requirements: { roleTitle: 'Backend Engineer', seniority: 'Senior' },
      companyData: { pages: [{ url: 'https://acme.com', title: 'Acme', text: 'We build tools', isHiringPage: false }] },
      discussionData: { results: [] },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('persists companyBrief and keyEvidence on valid LLM output', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(mockKitBase) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue({
        summary: 'Acme builds tools.',
        what_they_do: 'Developer tooling.',
        interview_relevance: 'Know their stack.',
        hiring_signals: [],
        interview_signals: [],
      }),
    });

    const generateBrief = require('../src/kits/stages/generateBrief');
    await generateBrief('kit123');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledWith(
      'kit123',
      expect.objectContaining({
        'results.companyBrief': expect.objectContaining({ summary: 'Acme builds tools.' }),
        'results.keyEvidence': expect.any(Object),
      })
    );
  });

  test('throws on schema validation failure so BullMQ retries', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(mockKitBase) });
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue({ summary: 'missing what_they_do field' }),
    });

    const generateBrief = require('../src/kits/stages/generateBrief');
    await expect(generateBrief('kit123')).rejects.toThrow('Brief schema validation failed');
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('throws on invalid JSON from LLM', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(mockKitBase) });
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockRejectedValue(new Error('LLM returned non-JSON response')),
    });

    const generateBrief = require('../src/kits/stages/generateBrief');
    await expect(generateBrief('kit123')).rejects.toThrow('LLM returned non-JSON response');
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('is idempotent — skips if stage already done', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    const doneKit = {
      ...mockKitBase,
      stages: { 'generate-brief': { status: 'done' } },
      results: { ...mockKitBase.results, companyBrief: { summary: 'Already done.' } },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(doneKit) });

    const generateBrief = require('../src/kits/stages/generateBrief');
    await generateBrief('kit123');

    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(getLLMClient).not.toHaveBeenCalled();
  });

  test('proceeds with partial research (no company pages, no discussion)', async () => {
    const Kit = require('../src/models/Kit');
    const { getLLMClient } = require('../src/llm/LLMClient');
    const thinKit = {
      ...mockKitBase,
      results: {
        ...mockKitBase.results,
        companyData: { pages: [], errors: [{ type: 'homepage_unreachable', message: 'timed out' }] },
        discussionData: { results: [], errors: [] },
      },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(thinKit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue({ summary: '', what_they_do: '' }),
    });

    const generateBrief = require('../src/kits/stages/generateBrief');
    await generateBrief('kit123');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledWith(
      'kit123',
      expect.objectContaining({
        'results.companyBrief': expect.objectContaining({ summary: '', sources: [] }),
      })
    );
  });
});
