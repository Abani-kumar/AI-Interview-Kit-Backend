const SYSTEM_PROMPT = `You are ranking website links by how likely they are to contain useful information about a company's business, culture, hiring process, or interview process — for someone preparing for a job interview there.

Return ONLY a JSON object:
{
  "rankedUrls": ["most relevant url", "second most relevant url", ...]
}

Rank ALL provided URLs, most relevant first. Do not invent URLs not in the provided list. Do not add commentary.`;

function buildLinkRankerPrompt(candidateLinks) {
  const listing = candidateLinks
    .map((l, i) => `${i + 1}. URL: ${l.url}\n   Anchor text: "${l.anchorText}"\n   Title: "${l.title}"`)
    .join('\n\n');

  return `Rank these candidate links by relevance to company research and hiring/interview information:\n\n${listing}`;
}

module.exports = { SYSTEM_PROMPT, buildLinkRankerPrompt };
