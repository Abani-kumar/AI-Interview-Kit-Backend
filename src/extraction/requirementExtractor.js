const niceWords = /bonus|preferred|nice to have|plus|desirable/i;
const behavioralWords = /mentor|communicat|collaborat|leadership|stakeholder/i;
export function extractRequirements(jd) {
  const lines = jd.split(/\n|[.!?]/).map((line) => line.trim()).filter((line) => line.length >= 12);
  const likely = lines.filter((line) => /required|requirement|experience|proficien|knowledge|must|responsib|skill|years|ability/i.test(line));
  return likely.slice(0, 20).map((text, index) => ({ id: `r${index + 1}`, text, kind: behavioralWords.test(text) ? 'behavioural' : 'technical', priority: niceWords.test(text) ? 'nice' : 'must' }));
}
