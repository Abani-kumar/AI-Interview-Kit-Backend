const {
  DEFAULT_CONTENT_STATE,
  createGeneratedState,
  createUserState,
  normalizeContentState,
  withGeneratedState,
  withUserState,
  markEdited,
  setPinned,
  isReplaceable,
  stripContentState,
} = require('../src/kits/contentState');

describe('contentState', () => {
  test('AI-generated question gets generated/false/false', () => {
    const question = withGeneratedState({
      id: 'q1',
      question: 'Explain rate limiting.',
      category: 'system-design',
      difficulty: 2,
      minutes: 20,
      requirement_ids: ['r1'],
    });

    expect(question).toMatchObject({
      id: 'q1',
      origin: 'generated',
      edited: false,
      pinned: false,
    });
    expect(createGeneratedState()).toEqual(DEFAULT_CONTENT_STATE);
  });

  test('AI-generated flashcard gets generated/false/false', () => {
    const flashcard = withGeneratedState({
      id: 'f1',
      front: 'What is a rate limiter?',
      back: 'Controls request throughput.',
      requirement_ids: ['r1'],
    });

    expect(flashcard).toMatchObject({
      id: 'f1',
      origin: 'generated',
      edited: false,
      pinned: false,
    });
  });

  test('user-created question gets user/false/false', () => {
    const question = withUserState({
      id: 'q9',
      question: 'Walk me through a DSA problem you solved recently.',
      category: 'technical',
      difficulty: 1,
      minutes: 15,
      requirement_ids: [],
    });

    expect(question).toMatchObject({
      id: 'q9',
      origin: 'user',
      edited: false,
      pinned: false,
    });
    expect(createUserState()).toEqual({
      origin: 'user',
      edited: false,
      pinned: false,
    });
  });

  test('editing an item sets edited=true without changing origin', () => {
    const generated = withGeneratedState({ id: 'q1', question: 'Original' });
    const edited = markEdited({ ...generated, question: 'Updated prompt' });

    expect(edited.origin).toBe('generated');
    expect(edited.edited).toBe(true);
    expect(edited.pinned).toBe(false);
    expect(edited.question).toBe('Updated prompt');

    const userItem = withUserState({ id: 'q2', question: 'Custom' });
    const editedUser = markEdited({ ...userItem, question: 'Custom edited' });
    expect(editedUser.origin).toBe('user');
    expect(editedUser.edited).toBe(true);
  });

  test('pin/unpin changes only pinned', () => {
    const base = withGeneratedState({ id: 'f1', front: 'A', back: 'B' });
    const pinned = setPinned(base, true);

    expect(pinned).toMatchObject({
      origin: 'generated',
      edited: false,
      pinned: true,
    });

    const unpinned = setPinned(pinned, false);
    expect(unpinned).toMatchObject({
      origin: 'generated',
      edited: false,
      pinned: false,
    });

    const editedThenPinned = setPinned(markEdited(base), true);
    expect(editedThenPinned).toMatchObject({
      origin: 'generated',
      edited: true,
      pinned: true,
    });
  });

  test('missing state on old data defaults safely to generated/false/false', () => {
    const legacyQuestion = {
      id: 'q1',
      question: 'Legacy question without state fields',
      category: 'technical',
      difficulty: 1,
      minutes: 10,
      requirement_ids: ['r1'],
    };

    expect(normalizeContentState(legacyQuestion)).toEqual({
      origin: 'generated',
      edited: false,
      pinned: false,
    });

    expect(normalizeContentState({})).toEqual(DEFAULT_CONTENT_STATE);
    expect(normalizeContentState(null)).toEqual(DEFAULT_CONTENT_STATE);
    expect(normalizeContentState({ origin: 'bogus', edited: 'yes', pinned: 1 })).toEqual(
      DEFAULT_CONTENT_STATE
    );
    expect(normalizeContentState({ origin: 'user' })).toEqual({
      origin: 'user',
      edited: false,
      pinned: false,
    });
  });

  test('isReplaceable follows regeneration preserve rules', () => {
    expect(isReplaceable(withGeneratedState({ id: 'q1' }))).toBe(true);
    expect(isReplaceable(markEdited(withGeneratedState({ id: 'q1' })))).toBe(false);
    expect(isReplaceable(setPinned(withGeneratedState({ id: 'q1' }), true))).toBe(false);
    expect(isReplaceable(withUserState({ id: 'q1' }))).toBe(false);
    expect(isReplaceable({ id: 'q1' })).toBe(true); // legacy → generated/false/false
  });

  test('stripContentState removes builder fields for Appendix A output', () => {
    const question = withGeneratedState({
      id: 'q1',
      question: 'Q',
      category: 'technical',
      difficulty: 1,
      minutes: 10,
      requirement_ids: ['r1'],
    });

    expect(stripContentState(question)).toEqual({
      id: 'q1',
      question: 'Q',
      category: 'technical',
      difficulty: 1,
      minutes: 10,
      requirement_ids: ['r1'],
    });
  });
});
