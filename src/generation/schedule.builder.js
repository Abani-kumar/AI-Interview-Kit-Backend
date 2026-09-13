export function buildSchedule({ days, requirements, questions }) {
  const totalDays = Math.max(1, Math.min(60, Number(days) || 1));
  const mustIds = new Set(requirements.filter((r) => r.priority === 'must').map((r) => r.id));
  const ordered = [...questions].sort((a, b) => Number(b.requirement_ids.some((id) => mustIds.has(id))) - Number(a.requirement_ids.some((id) => mustIds.has(id))) || b.difficulty - a.difficulty);
  const buckets = Array.from({ length: totalDays }, () => []);
  ordered.forEach((question, index) => buckets[index % totalDays].push(question.id));
  return { days_available: totalDays, days: buckets.map((questionIds, index) => ({ day: index + 1, focus: questionIds.length ? `Interview preparation - ${index + 1}` : 'Review and rest', question_ids: questionIds, minutes: Math.max(30, questionIds.length * 20) })) };
}
