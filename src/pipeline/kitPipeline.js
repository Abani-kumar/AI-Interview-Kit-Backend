import { crawlCompanySite } from '../retrieval/crawler.js';
import { extractRequirements } from '../extraction/requirementExtractor.js';
import { generateCompanyBrief } from '../generation/companyBrief.generator.js';
import { generateQuestions } from '../generation/questions.generator.js';
import { generateFlashcards } from '../generation/flashcards.generator.js';
import { buildSchedule } from '../generation/schedule.builder.js';
import { checkCoverage } from '../generation/coverage.checker.js';
import { validateKit } from '../kits/kit.validator.js';

export async function buildKit({ jd, company_url, days }) {
  const pages = await crawlCompanySite(company_url);
  const requirements = extractRequirements(jd);
  const questions = generateQuestions(requirements);
  const coverage = checkCoverage(requirements, questions);
  const kit = { source: { company: new URL(company_url).hostname, company_url, role: '', location: '', jd_chars: jd.length, researched_at: new Date().toISOString(), pages_used: pages.map((page) => page.url) }, company_brief: generateCompanyBrief(pages), role: { title: '', seniority: '', responsibilities: [], requirements }, questions, flashcards: generateFlashcards(requirements), schedule: buildSchedule({ days, requirements, questions }), coverage: { ...coverage, passes: 1 } };
  return validateKit(kit);
}
