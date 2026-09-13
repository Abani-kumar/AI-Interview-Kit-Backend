export function generateQuestions(requirements) {
  return requirements.map((requirement, index) => ({ id: `q${index + 1}`, requirement_ids: [requirement.id], category: requirement.kind === 'behavioural' ? 'behavioural' : 'technical', prompt: `How have you demonstrated ${requirement.text}?`, answer_outline: 'Use a specific example, your approach, trade-offs, and outcome.', difficulty: requirement.priority === 'must' ? 2 : 1 }));
}
