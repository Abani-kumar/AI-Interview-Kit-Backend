const SYSTEM_PROMPT = `You generate a small set of targeted web search queries to find public discussion of a company's interview and hiring process.

Return ONLY a JSON object:
{ "queries": ["query 1", "query 2", "query 3"] }

Generate 2-4 queries. Focus on: interview experience, hiring process stages, technical/system-design rounds, take-home assessments, behavioural rounds. Use the company name in every query. Do not fabricate details not implied by the provided context.`;

function buildSearchQueryPrompt({ companyName, roleTitle, seniority, hiringPageFound }) {
  const context = [
    `Company: ${companyName || 'unknown'}`,
    roleTitle ? `Role: ${roleTitle}` : null,
    seniority ? `Seniority: ${seniority}` : null,
    `Hiring/interview page found on company site: ${hiringPageFound ? 'yes' : 'no'}`,
  ]
    .filter(Boolean)
    .join('\n');

  return `Generate search queries for this context:\n\n${context}`;
}

module.exports = { SYSTEM_PROMPT, buildSearchQueryPrompt };
