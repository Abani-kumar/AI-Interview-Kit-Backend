export function checkCoverage(requirements, questions) {
  const covered = new Set(questions.flatMap((question) => question.requirement_ids));
  return { uncovered_requirement_ids: requirements.filter((requirement) => requirement.priority === 'must' && !covered.has(requirement.id)).map((requirement) => requirement.id) };
}
