const { SYSTEM_PROMPT, buildExtractionPrompt } = require('../../src/kits/stages/extractRequirements/promptBuilder');

describe('requirement extraction prompts', () => {
  test('system prompt enforces atomicity and valid enums', () => {
    expect(SYSTEM_PROMPT).toContain('technical | behavioural | domain');
    expect(SYSTEM_PROMPT).toContain('must | nice');
    expect(SYSTEM_PROMPT).toContain('ATOMICITY RULE');
    expect(SYSTEM_PROMPT).toContain('DO NOT SPLIT a single naturally inseparable concept');
  });

  test('system prompt preserves OR alternatives as single atomic requirements', () => {
    expect(SYSTEM_PROMPT).toContain('OR / ALTERNATIVES — NEVER SPLIT');
    expect(SYSTEM_PROMPT).toContain('Strong Java, Python, or Go skills');
    expect(SYSTEM_PROMPT).toContain('Experience with Java or Python');
    expect(SYSTEM_PROMPT).toContain('DO NOT paraphrase or rewrite JD wording');
  });

  test('system prompt distinguishes separate qualifications from combined phrases', () => {
    expect(SYSTEM_PROMPT).toContain('Java experience. SQL experience.');
    expect(SYSTEM_PROMPT).toContain('Java, Python, or Go; plus experience with PostgreSQL');
    expect(SYSTEM_PROMPT).toContain('DO NOT MERGE unrelated requirements into one entry');
  });

  test('buildExtractionPrompt includes JD text and optional chunk note', () => {
    const prompt = buildExtractionPrompt('Backend role', { index: 1, total: 3 });
    expect(prompt).toContain('chunk 2 of 3');
    expect(prompt).toContain('Backend role');
  });
});
