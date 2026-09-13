// Stage handler.
//
// FIX: crawlCompanySite and searchPublicDiscussion are now SEQUENTIAL,
// not concurrent. The assessment explicitly requires later steps to
// respond to what earlier steps actually discovered — the crawler's real
// extracted company name and hiring-page-found flag now feed directly
// into the search query generator, instead of a hostname-derived guess.
// The wall-clock cost (crawl finishes before search starts) is accepted
// as worthwhile for the accuracy gain. See design doc for the trade-off
// this replaces.

const Kit = require('../../models/Kit');
const { crawlCompanySite } = require('../../retrieval/crawler');
const { searchPublicDiscussion } = require('../../retrieval/publicDiscussion');

const MAX_PAGE_TEXT_CHARS = parseInt(process.env.MAX_PAGE_TEXT_CHARS || '3000', 10);

async function researchCompany(kitId) {
  const kit = await Kit.findById(kitId).lean();

  if (kit.stages?.['research-company']?.status === 'done' && kit.results?.companyData) {
    return;
  }

  // --- Step 1: crawl first ---
  let companyData;
  try {
    companyData = await crawlCompanySite(kit.input.companyUrl);
  } catch (err) {
    // Unexpected application bug, not a "found nothing" case — let it throw
    // so BullMQ retries the stage.
    throw new Error(`Unexpected crawl error: ${err.message}`);
  }

  companyData = boundPageText(companyData);

  // --- Step 2: search, now informed by the REAL crawl output ---
  const searchContext = {
    companyName: companyData.name || deriveNameFromUrl(kit.input.companyUrl),
    roleTitle: kit.results?.requirements?.roleTitle || '',
    seniority: kit.results?.requirements?.seniority || '',
    hiringPageFound: companyData.hiringInfo?.found === true,
  };

  let discussionData;
  try {
    discussionData = await searchPublicDiscussion(searchContext);
  } catch (err) {
    // Search failures inside searchPublicDiscussion are already caught
    // per-query; this catch is only for a truly unexpected bug.
    discussionData = { results: [], errors: [{ type: 'unexpected_error', message: err.message }], queriesUsed: [] };
  }

  await Kit.findByIdAndUpdate(kitId, {
    'results.companyData': companyData,
    'results.discussionData': discussionData,
  });
}

function deriveNameFromUrl(companyUrl) {
  try {
    const hostname = new URL(companyUrl).hostname.replace(/^www\./, '');
    return hostname.split('.')[0];
  } catch {
    return null;
  }
}

function boundPageText(companyData) {
  return {
    ...companyData,
    pages: companyData.pages.map((p) => ({ ...p, text: p.text.slice(0, MAX_PAGE_TEXT_CHARS) })),
  };
}

module.exports = researchCompany;
