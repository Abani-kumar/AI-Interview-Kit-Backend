jest.mock('../src/models/Kit');
jest.mock('../src/retrieval/crawler');
jest.mock('../src/retrieval/publicDiscussion');

const Kit = require('../src/models/Kit');
const { crawlCompanySite } = require('../src/retrieval/crawler');
const { searchPublicDiscussion } = require('../src/retrieval/publicDiscussion');

describe('researchCompany stage handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('persists crawl and search results sequentially', async () => {
    crawlCompanySite.mockResolvedValue({
      name: 'Acme',
      pages: [{ url: 'https://acme.com', text: 'We hire engineers.' }],
      hiringInfo: { found: true },
    });
    searchPublicDiscussion.mockResolvedValue({
      results: [{ title: 'Interview tips', url: 'https://discuss.example/t/1' }],
      errors: [],
      queriesUsed: ['Acme interview process'],
    });

    Kit.findById.mockReturnValue({
      lean: () =>
        Promise.resolve({
          input: { companyUrl: 'https://acme.com' },
          stages: { 'research-company': { status: 'pending' } },
          results: {
            requirements: { roleTitle: 'Backend Engineer', seniority: 'Senior' },
          },
        }),
    });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const researchCompany = require('../src/kits/stages/researchCompany');
    await researchCompany('kit123');

    expect(crawlCompanySite).toHaveBeenCalledWith('https://acme.com');
    expect(searchPublicDiscussion).toHaveBeenCalledWith({
      companyName: 'Acme',
      roleTitle: 'Backend Engineer',
      seniority: 'Senior',
      hiringPageFound: true,
    });

    const update = Kit.findByIdAndUpdate.mock.calls[0][1];
    expect(update['results.companyData'].name).toBe('Acme');
    expect(update['results.discussionData'].results).toHaveLength(1);
  });

  test('continues with empty discussion data when search throws unexpectedly', async () => {
    crawlCompanySite.mockResolvedValue({
      name: 'Acme',
      pages: [],
      hiringInfo: { found: false },
    });
    searchPublicDiscussion.mockRejectedValue(new Error('search provider down'));

    Kit.findById.mockReturnValue({
      lean: () =>
        Promise.resolve({
          input: { companyUrl: 'https://acme.com' },
          stages: { 'research-company': { status: 'pending' } },
          results: { requirements: {} },
        }),
    });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const researchCompany = require('../src/kits/stages/researchCompany');
    await researchCompany('kit123');

    const update = Kit.findByIdAndUpdate.mock.calls[0][1];
    expect(update['results.discussionData'].results).toEqual([]);
    expect(update['results.discussionData'].errors[0].type).toBe('unexpected_error');
  });

  test('rethrows unexpected crawl failures for BullMQ retry', async () => {
    crawlCompanySite.mockRejectedValue(new Error('robots blocked'));

    Kit.findById.mockReturnValue({
      lean: () =>
        Promise.resolve({
          input: { companyUrl: 'https://acme.com' },
          stages: { 'research-company': { status: 'pending' } },
          results: {},
        }),
    });

    const researchCompany = require('../src/kits/stages/researchCompany');
    await expect(researchCompany('kit123')).rejects.toThrow('Unexpected crawl error');
  });
});
