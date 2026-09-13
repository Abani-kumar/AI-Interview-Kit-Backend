const {
  mergeQuestions,
  mergeFlashcards,
  appendGeneratedQuestions,
} = require('../src/kits/regenerationMerge');
const {
  withGeneratedState,
  withUserState,
  markEdited,
  setPinned,
} = require('../src/kits/contentState');

describe('regenerationMerge', () => {
  test('mergeQuestions replaces untouched generated items', () => {
    const existing = [
      withGeneratedState({ id: 'q1', question: 'Old generated', category: 'technical', difficulty: 1, minutes: 10, requirement_ids: ['r1'] }),
      markEdited(withGeneratedState({ id: 'q2', question: 'Edited', category: 'technical', difficulty: 2, minutes: 10, requirement_ids: ['r1'] })),
      withUserState({ id: 'q3', question: 'User created', category: 'behavioural', difficulty: 1, minutes: 10, requirement_ids: [] }),
    ];

    const generated = [
      { question: 'New A', category: 'technical', difficulty: 2, minutes: 15, requirement_ids: ['r1'] },
      { question: 'New B', category: 'behavioural', difficulty: 1, minutes: 10, requirement_ids: ['r2'] },
    ];

    const merged = mergeQuestions(existing, generated);

    expect(merged).toHaveLength(4);
    expect(merged[0].question).toBe('New A');
    expect(merged[0].origin).toBe('generated');
    expect(merged[0].edited).toBe(false);
    expect(merged[0].pinned).toBe(false);
    expect(new Set(merged.map((q) => q.id)).size).toBe(merged.length);

    expect(merged[1].question).toBe('Edited');
    expect(merged[1].id).toBe('q2');
    expect(merged[1].edited).toBe(true);

    expect(merged[2].question).toBe('User created');
    expect(merged[2].id).toBe('q3');
    expect(merged[2].origin).toBe('user');
  });

  test('mergeQuestions preserves pinned generated items', () => {
    const existing = [
      setPinned(withGeneratedState({ id: 'q1', question: 'Pinned', category: 'technical', difficulty: 1, minutes: 10, requirement_ids: [] }), true),
      withGeneratedState({ id: 'q2', question: 'Replaceable', category: 'technical', difficulty: 1, minutes: 10, requirement_ids: [] }),
    ];

    const generated = [{ question: 'Fresh', category: 'technical', difficulty: 2, minutes: 15, requirement_ids: [] }];
    const merged = mergeQuestions(existing, generated);

    expect(merged[0].question).toBe('Pinned');
    expect(merged[0].pinned).toBe(true);
    expect(merged[1].question).toBe('Fresh');
  });

  test('mergeFlashcards applies same preservation rules', () => {
    const existing = [
      withGeneratedState({ id: 'f1', front: 'Old', back: 'Old back', requirement_ids: [] }),
      withUserState({ id: 'f2', front: 'User card', back: 'User back', requirement_ids: [] }),
    ];

    const generated = [{ front: 'New front', back: 'New back', requirement_ids: [] }];
    const merged = mergeFlashcards(existing, generated);

    expect(merged).toHaveLength(2);
    expect(merged[0].front).toBe('New front');
    expect(merged[1].front).toBe('User card');
  });

  test('appendGeneratedQuestions keeps all existing and assigns unique ids', () => {
    const existing = [
      withGeneratedState({ id: 'q1', question: 'Keep', category: 'technical', difficulty: 1, minutes: 10, requirement_ids: [] }),
      withUserState({ id: 'q5', question: 'User', category: 'technical', difficulty: 1, minutes: 10, requirement_ids: [] }),
    ];

    const generated = [
      { question: 'Gap fill', category: 'technical', difficulty: 2, minutes: 15, requirement_ids: ['r9'] },
    ];

    const merged = appendGeneratedQuestions(existing, generated);

    expect(merged).toHaveLength(3);
    expect(merged[0].id).toBe('q1');
    expect(merged[1].id).toBe('q5');
    expect(merged[2].id).toBe('q6');
    expect(merged[2].question).toBe('Gap fill');
  });
});
