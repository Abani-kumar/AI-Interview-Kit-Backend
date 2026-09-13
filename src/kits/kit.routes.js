const express = require('express');
const ownsKit = require('../middleware/ownsKit');
const { protect } = require('../auth/auth.middleware');
const { registerSSEClient } = require('../queue/progress.sse');
const { createKit, listKits, getKit, deleteKit } = require('./kit.controller');
const {
  patchRequirement,
  postRequirement,
  removeRequirement,
  putRequirementsOrder,
} = require('./requirements.controller');
const {
  patchQuestion,
  postQuestion,
  removeQuestion,
  putQuestionsOrder,
} = require('./questions.controller');
const {
  patchFlashcard,
  postFlashcard,
  removeFlashcard,
  putFlashcardsOrder,
} = require('./flashcards.controller');
const {
  postMoveQuestion,
  putDayQuestionsOrder,
  patchDayFocus,
} = require('./schedule.controller');
const {
  postPinQuestion,
  postUnpinQuestion,
  postPinFlashcard,
  postUnpinFlashcard,
} = require('./pin.controller');
const { patchCompanyBrief } = require('./brief.controller');
const {
  postRegenerateBrief,
  postRegenerateQuestions,
  postRegenerateFlashcards,
} = require('./regenerate.controller');
const { getPractice, postPracticeAttempt } = require('./practice.controller');

const router = express.Router();

// All kit routes require login. Per-kit routes also verify ownership via ownsKit.
router.post('/', protect, createKit);
router.get('/', protect, listKits);
router.get('/:id', protect, ownsKit, getKit);
router.delete('/:id', protect, ownsKit, deleteKit);
router.get('/:id/progress', protect, ownsKit, (req, res) => {
  registerSSEClient(req.params.id, res);
});

// Kit Builder — requirement mutations (auth + ownership required; MongoDB only).
router.post('/:id/requirements', protect, ownsKit, postRequirement);
router.put('/:id/requirements/reorder', protect, ownsKit, putRequirementsOrder);
router.patch('/:id/requirements/:requirementId', protect, ownsKit, patchRequirement);
router.delete('/:id/requirements/:requirementId', protect, ownsKit, removeRequirement);

// Kit Builder — question mutations (auth + ownership required; MongoDB only).
router.post('/:id/questions', protect, ownsKit, postQuestion);
router.put('/:id/questions/reorder', protect, ownsKit, putQuestionsOrder);
router.post('/:id/questions/:questionId/pin', protect, ownsKit, postPinQuestion);
router.post('/:id/questions/:questionId/unpin', protect, ownsKit, postUnpinQuestion);
router.patch('/:id/questions/:questionId', protect, ownsKit, patchQuestion);
router.delete('/:id/questions/:questionId', protect, ownsKit, removeQuestion);

// Kit Builder — flashcard mutations (auth + ownership required; MongoDB only).
router.post('/:id/flashcards', protect, ownsKit, postFlashcard);
router.put('/:id/flashcards/reorder', protect, ownsKit, putFlashcardsOrder);
router.post('/:id/flashcards/:flashcardId/pin', protect, ownsKit, postPinFlashcard);
router.post('/:id/flashcards/:flashcardId/unpin', protect, ownsKit, postUnpinFlashcard);
router.patch('/:id/flashcards/:flashcardId', protect, ownsKit, patchFlashcard);
router.delete('/:id/flashcards/:flashcardId', protect, ownsKit, removeFlashcard);

// Kit Builder — schedule mutations (auth + ownership required; MongoDB only).
// Day count is immutable — these routes never create/delete days.
router.post('/:id/schedule/move', protect, ownsKit, postMoveQuestion);
router.put('/:id/schedule/days/:dayNumber/reorder', protect, ownsKit, putDayQuestionsOrder);
router.patch('/:id/schedule/days/:dayNumber', protect, ownsKit, patchDayFocus);

// Practice Mode — confidence tracking (auth + ownership required; MongoDB only).
router.get('/:id/practice', protect, ownsKit, getPractice);
router.post(
  '/:id/practice/flashcards/:flashcardId',
  protect,
  ownsKit,
  postPracticeAttempt
);

// Kit Builder — company brief edit (auth + ownership required; MongoDB only).
// Normal save: no BullMQ, no LLM, no research.
router.patch('/:id/company-brief', protect, ownsKit, patchCompanyBrief);

// Kit Builder — explicit section regeneration (BullMQ pipeline).
router.post('/:id/regenerate/brief', protect, ownsKit, postRegenerateBrief);
router.post('/:id/regenerate/questions', protect, ownsKit, postRegenerateQuestions);
router.post('/:id/regenerate/flashcards', protect, ownsKit, postRegenerateFlashcards);

module.exports = router;
