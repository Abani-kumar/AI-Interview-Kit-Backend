/**
 * Content-state helpers for Kit Builder editable items (questions, flashcards).
 *
 * State shape:
 *   { origin: "generated" | "user", edited: boolean, pinned: boolean }
 *
 * Regeneration contract (merge logic implemented later):
 *   origin=user            → preserve
 *   edited=true            → preserve
 *   pinned=true            → preserve
 *   generated + untouched  → replaceable
 *
 * Stored on items in results.questions / results.flashcards.
 * Stripped from Appendix A public kit.data so the assessment contract stays clean.
 */

const ORIGIN = Object.freeze({
  GENERATED: 'generated',
  USER: 'user',
});

const CONTENT_STATE_KEYS = Object.freeze(['origin', 'edited', 'pinned']);

const DEFAULT_CONTENT_STATE = Object.freeze({
  origin: ORIGIN.GENERATED,
  edited: false,
  pinned: false,
});

function createGeneratedState() {
  return { origin: ORIGIN.GENERATED, edited: false, pinned: false };
}

function createUserState() {
  return { origin: ORIGIN.USER, edited: false, pinned: false };
}

/**
 * Resolve content state for an item, defaulting missing fields for older kits.
 * Does not mutate the input.
 */
function normalizeContentState(item) {
  if (!item || typeof item !== 'object') {
    return { ...DEFAULT_CONTENT_STATE };
  }

  const origin =
    item.origin === ORIGIN.USER || item.origin === ORIGIN.GENERATED
      ? item.origin
      : DEFAULT_CONTENT_STATE.origin;

  return {
    origin,
    edited: typeof item.edited === 'boolean' ? item.edited : DEFAULT_CONTENT_STATE.edited,
    pinned: typeof item.pinned === 'boolean' ? item.pinned : DEFAULT_CONTENT_STATE.pinned,
  };
}

/**
 * Attach generated defaults onto a newly AI-created item.
 */
function withGeneratedState(item) {
  return { ...item, ...createGeneratedState() };
}

/**
 * Attach user-created defaults onto a manually added item.
 */
function withUserState(item) {
  return { ...item, ...createUserState() };
}

/**
 * Mark an item as user-edited. Preserves origin and pinned.
 */
function markEdited(item) {
  const state = normalizeContentState(item);
  return {
    ...item,
    origin: state.origin,
    edited: true,
    pinned: state.pinned,
  };
}

/**
 * Set pinned flag only. Preserves origin and edited.
 */
function setPinned(item, pinned) {
  const state = normalizeContentState(item);
  return {
    ...item,
    origin: state.origin,
    edited: state.edited,
    pinned: Boolean(pinned),
  };
}

/**
 * True when regeneration may replace this item.
 */
function isReplaceable(item) {
  const state = normalizeContentState(item);
  return state.origin === ORIGIN.GENERATED && !state.edited && !state.pinned;
}

/**
 * Remove content-state keys for Appendix A / public output.
 */
function stripContentState(item) {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  for (const key of CONTENT_STATE_KEYS) {
    delete out[key];
  }
  return out;
}

function stripContentStateFromItems(items) {
  if (!Array.isArray(items)) return items;
  return items.map(stripContentState);
}

module.exports = {
  ORIGIN,
  CONTENT_STATE_KEYS,
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
  stripContentStateFromItems,
};
