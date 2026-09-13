/**
 * Deterministic merge helpers for section regeneration.
 * Protected items (user / edited / pinned) are preserved; replaceable generated items are replaced.
 */

const { isReplaceable, withGeneratedState } = require('./contentState');
const { nextQuestionId } = require('./questions.mutations');
const { nextFlashcardId } = require('./flashcards.mutations');

function nextIdForCollection(items, nextIdFn) {
  return nextIdFn(items);
}

/**
 * Merge regenerated questions with protected existing questions.
 * Replaceable slots are filled from `generated` in order; surplus generated items are appended.
 */
function mergeQuestions(existing, generated) {
  const existingList = Array.isArray(existing) ? existing : [];
  const generatedList = Array.isArray(generated) ? generated : [];

  const merged = [];
  let genIdx = 0;

  for (const item of existingList) {
    if (isReplaceable(item)) {
      if (genIdx < generatedList.length) {
        const id = nextIdForCollection(merged, nextQuestionId);
        merged.push(
          withGeneratedState({
            ...generatedList[genIdx],
            id,
          })
        );
        genIdx += 1;
      }
    } else {
      merged.push(item);
    }
  }

  while (genIdx < generatedList.length) {
    const id = nextIdForCollection(merged, nextQuestionId);
    merged.push(
      withGeneratedState({
        ...generatedList[genIdx],
        id,
      })
    );
    genIdx += 1;
  }

  return merged;
}

/**
 * Merge regenerated flashcards with protected existing flashcards.
 */
function mergeFlashcards(existing, generated) {
  const existingList = Array.isArray(existing) ? existing : [];
  const generatedList = Array.isArray(generated) ? generated : [];

  const merged = [];
  let genIdx = 0;

  for (const item of existingList) {
    if (isReplaceable(item)) {
      if (genIdx < generatedList.length) {
        const id = nextIdForCollection(merged, nextFlashcardId);
        merged.push(
          withGeneratedState({
            ...generatedList[genIdx],
            id,
          })
        );
        genIdx += 1;
      }
    } else {
      merged.push(item);
    }
  }

  while (genIdx < generatedList.length) {
    const id = nextIdForCollection(merged, nextFlashcardId);
    merged.push(
      withGeneratedState({
        ...generatedList[genIdx],
        id,
      })
    );
    genIdx += 1;
  }

  return merged;
}

/**
 * Append freshly generated items (focused requirement regen) with unique IDs.
 */
function appendGeneratedQuestions(existing, generated) {
  const existingList = Array.isArray(existing) ? existing : [];
  const generatedList = Array.isArray(generated) ? generated : [];
  const merged = [...existingList];

  for (const item of generatedList) {
    const id = nextIdForCollection(merged, nextQuestionId);
    merged.push(withGeneratedState({ ...item, id }));
  }

  return merged;
}

module.exports = {
  mergeQuestions,
  mergeFlashcards,
  appendGeneratedQuestions,
};
