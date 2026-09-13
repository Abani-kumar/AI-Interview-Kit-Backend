jest.mock('../src/models/Kit');

const Kit = require('../src/models/Kit');
const { updateCompanyBrief } = require('../src/kits/brief.mutations');
const { withGeneratedState } = require('../src/kits/contentState');
const { getPersistPayload } = require('./helpers/persistPayload');

function baseBrief() {
  return withGeneratedState({
    summary: 'Acme builds APIs.',
    what_they_do: 'API tooling.',
    interview_relevance: 'Know their scale story.',
    hiring_signals: ['Hiring backend engineers'],
    interview_signals: ['System design round'],
    sources: ['https://acme.example/'],
  });
}

function baseKit(overrides = {}) {
  const companyBrief = overrides.companyBrief ?? baseBrief();
  return {
    _id: 'kit123',
    results: {
      companyBrief,
      ...overrides.results,
    },
    data: {
      company_brief: {
        summary: companyBrief.summary,
        what_they_do: companyBrief.what_they_do,
        interview_relevance: companyBrief.interview_relevance,
        hiring_signals: companyBrief.hiring_signals,
        interview_signals: companyBrief.interview_signals,
        sources: companyBrief.sources,
      },
      questions: [],
      ...overrides.data,
    },
    ...overrides,
  };
}

function mockFindById(kit) {
  Kit.findById.mockImplementation(() => ({
    lean: () => Promise.resolve(kit),
  }));
}

function mockUpdate(updatedKit) {
  Kit.findByIdAndUpdate.mockImplementation(() => ({
    lean: () => Promise.resolve(updatedKit),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('updates brief fields, marks edited, and syncs public data.company_brief', async () => {
  const kit = baseKit();
  mockFindById(kit);

  const nextBrief = withGeneratedState({
    ...baseBrief(),
    summary: 'Acme ships payments.',
    hiring_signals: ['Hiring SREs'],
    edited: true,
  });
  mockUpdate({
    ...kit,
    results: { ...kit.results, companyBrief: nextBrief },
  });

  const result = await updateCompanyBrief('kit123', {
    summary: '  Acme ships payments.  ',
    hiring_signals: ['Hiring SREs', '  '],
  });

  const payload = getPersistPayload(Kit);
  expect(payload['results.companyBrief'].summary).toBe('Acme ships payments.');
  expect(payload['results.companyBrief'].edited).toBe(true);
  expect(payload['results.companyBrief'].origin).toBe('generated');
  expect(payload.data.company_brief.summary).toBe('Acme ships payments.');
  expect(payload.data.company_brief.hiring_signals).toEqual(['Hiring SREs']);
  expect(payload.data.questions).toEqual([]);
  expect(result.company_brief.summary).toBe('Acme ships payments.');
  expect(result.company_brief.origin).toBeUndefined();
});

test('allows emptying optional lists and strings', async () => {
  const kit = baseKit();
  mockFindById(kit);
  mockUpdate(kit);

  await updateCompanyBrief('kit123', {
    interview_relevance: '   ',
    hiring_signals: [],
    interview_signals: [],
    sources: [],
  });

  const payload = getPersistPayload(Kit);
  expect(payload['results.companyBrief'].interview_relevance).toBe('');
  expect(payload['results.companyBrief'].hiring_signals).toEqual([]);
  expect(payload['results.companyBrief'].interview_signals).toEqual([]);
  expect(payload['results.companyBrief'].sources).toEqual([]);
});

test('rejects invalid source URLs', async () => {
  mockFindById(baseKit());

  await expect(
    updateCompanyBrief('kit123', { sources: ['not-a-url'] })
  ).rejects.toMatchObject({ status: 400 });
});

test('rejects ftp source URLs', async () => {
  mockFindById(baseKit());

  await expect(
    updateCompanyBrief('kit123', { sources: ['ftp://acme.example/docs'] })
  ).rejects.toMatchObject({ status: 400 });
});

test('returns 409 when the kit has no brief yet', async () => {
  mockFindById({ _id: 'kit123', results: {} });

  await expect(updateCompanyBrief('kit123', { summary: 'Hi' })).rejects.toMatchObject({
    status: 409,
  });
});

test('returns 404 when the kit is missing', async () => {
  mockFindById(null);

  await expect(updateCompanyBrief('missing', { summary: 'Hi' })).rejects.toMatchObject({
    status: 404,
  });
});
