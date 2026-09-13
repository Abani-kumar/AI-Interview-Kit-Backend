/**
 * Practice Mode — confidence attempt persistence (MongoDB only).
 * Does not trigger AI, BullMQ, or Kit Builder contentRevision bumps.
 */

const Kit = require('../models/Kit');

const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const CONFIDENCE_WEIGHTS = {
  low: 0,
  medium: 50,
  high: 100,
};
const IDEMPOTENCY_WINDOW_MS = 10_000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function getFlashcards(kit) {
  const fromResults = kit.results?.flashcards;
  if (Array.isArray(fromResults) && fromResults.length > 0) {
    return fromResults;
  }

  const fromData = kit.data?.flashcards;
  if (Array.isArray(fromData) && fromData.length > 0) {
    return fromData;
  }

  throw httpError(409, 'Kit has no flashcards to practice yet');
}

function getAttempts(kit) {
  const attempts = kit.practice?.attempts;
  return Array.isArray(attempts) ? attempts : [];
}

function validateConfidence(confidence) {
  if (typeof confidence !== 'string' || !CONFIDENCE_LEVELS.has(confidence)) {
    throw httpError(400, 'confidence must be one of: low, medium, high');
  }
  return confidence;
}

function findFlashcard(flashcards, flashcardId) {
  const card = flashcards.find((item) => item.id === flashcardId);
  if (!card) {
    throw httpError(404, 'Flashcard not found');
  }
  return card;
}

function latestAttemptByFlashcard(attempts) {
  const latest = new Map();

  for (const attempt of attempts) {
    const existing = latest.get(attempt.flashcardId);
    const attemptTime = new Date(attempt.practicedAt).getTime();
    const existingTime = existing ? new Date(existing.practicedAt).getTime() : -1;

    if (!existing || attemptTime >= existingTime) {
      latest.set(attempt.flashcardId, attempt);
    }
  }

  return latest;
}

function getRequirementItems(kit) {
  const items = kit.results?.requirements?.items;
  return Array.isArray(items) ? items : [];
}

function getKnownRequirementIds(kit) {
  return new Set(getRequirementItems(kit).map((item) => item.id));
}

function buildWeakRequirementIds(flashcards, latestByFlashcard, knownRequirementIds) {
  const weak = new Set();

  for (const [flashcardId, attempt] of latestByFlashcard.entries()) {
    if (attempt.confidence !== 'low') continue;

    const card = flashcards.find((item) => item.id === flashcardId);
    if (!card || !Array.isArray(card.requirement_ids)) continue;

    for (const requirementId of card.requirement_ids) {
      if (!knownRequirementIds.has(requirementId)) continue;
      weak.add(requirementId);
    }
  }

  return [...weak];
}

function buildRequirementAnalytics(flashcards, latestByFlashcard, requirementItems) {
  const knownRequirementIds = new Set(requirementItems.map((item) => item.id));
  const stats = new Map(
    requirementItems.map((item) => [
      item.id,
      {
        requirementId: item.id,
        flashcardCount: 0,
        practicedFlashcardCount: 0,
        lowCount: 0,
        mediumCount: 0,
        highCount: 0,
      },
    ])
  );

  for (const card of flashcards) {
    const requirementIds = Array.isArray(card.requirement_ids) ? card.requirement_ids : [];
    const latest = latestByFlashcard.get(card.id);

    for (const requirementId of requirementIds) {
      if (!knownRequirementIds.has(requirementId)) continue;

      const entry = stats.get(requirementId);
      entry.flashcardCount += 1;

      if (!latest) continue;

      entry.practicedFlashcardCount += 1;
      if (latest.confidence === 'low') entry.lowCount += 1;
      if (latest.confidence === 'medium') entry.mediumCount += 1;
      if (latest.confidence === 'high') entry.highCount += 1;
    }
  }

  return requirementItems.map((item) => {
    const entry = stats.get(item.id);
    let strengthPercent = 0;
    let weaknessPercent = 0;

    if (entry.practicedFlashcardCount > 0) {
      const totalWeight =
        entry.lowCount * CONFIDENCE_WEIGHTS.low +
        entry.mediumCount * CONFIDENCE_WEIGHTS.medium +
        entry.highCount * CONFIDENCE_WEIGHTS.high;
      strengthPercent = Math.round(totalWeight / entry.practicedFlashcardCount);
      weaknessPercent = 100 - strengthPercent;
    }

    return {
      requirementId: entry.requirementId,
      flashcardCount: entry.flashcardCount,
      practicedFlashcardCount: entry.practicedFlashcardCount,
      lowCount: entry.lowCount,
      mediumCount: entry.mediumCount,
      highCount: entry.highCount,
      strengthPercent,
      weaknessPercent,
    };
  });
}

function buildPracticeSummary(kit) {
  const flashcards = getFlashcards(kit);
  const attempts = getAttempts(kit);
  const latestByFlashcard = latestAttemptByFlashcard(attempts);
  const requirementItems = getRequirementItems(kit);
  const knownRequirementIds = getKnownRequirementIds(kit);

  const totalFlashcards = flashcards.length;
  const practicedFlashcards = latestByFlashcard.size;

  let lowConfidenceCount = 0;
  let mediumConfidenceCount = 0;
  let highConfidenceCount = 0;

  for (const attempt of latestByFlashcard.values()) {
    if (attempt.confidence === 'low') lowConfidenceCount += 1;
    if (attempt.confidence === 'medium') mediumConfidenceCount += 1;
    if (attempt.confidence === 'high') highConfidenceCount += 1;
  }

  const coveragePercent =
    totalFlashcards === 0 ? 0 : Math.round((practicedFlashcards / totalFlashcards) * 100);

  return {
    totalFlashcards,
    practicedFlashcards,
    coveragePercent,
    lowConfidenceCount,
    mediumConfidenceCount,
    highConfidenceCount,
    weakRequirementIds: buildWeakRequirementIds(
      flashcards,
      latestByFlashcard,
      knownRequirementIds
    ),
    requirements: buildRequirementAnalytics(
      flashcards,
      latestByFlashcard,
      requirementItems
    ),
  };
}

function findRecentDuplicateAttempt(attempts, flashcardId, confidence, now) {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (attempt.flashcardId !== flashcardId) continue;

    const practicedAt = new Date(attempt.practicedAt).getTime();
    if (now - practicedAt > IDEMPOTENCY_WINDOW_MS) {
      return null;
    }

    if (attempt.confidence === confidence) {
      return attempt;
    }

    return null;
  }

  return null;
}

async function persistPracticeAttempt(kitId, attempt) {
  const updated = await Kit.findByIdAndUpdate(
    kitId,
    { $push: { 'practice.attempts': attempt } },
    { new: true }
  ).lean();

  if (!updated) {
    throw httpError(404, 'Kit not found');
  }

  return updated;
}

async function recordPracticeAttempt(kitId, flashcardId, body) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) {
    throw httpError(404, 'Kit not found');
  }

  if (kit.status !== 'ready') {
    throw httpError(409, 'Kit is not ready for practice yet');
  }

  const confidence = validateConfidence(body?.confidence);
  const flashcards = getFlashcards(kit);
  findFlashcard(flashcards, flashcardId);

  const attempts = getAttempts(kit);
  const now = Date.now();
  const duplicate = findRecentDuplicateAttempt(attempts, flashcardId, confidence, now);

  if (duplicate) {
    return {
      attempt: duplicate,
      summary: buildPracticeSummary({ ...kit, practice: { attempts } }),
      idempotent: true,
    };
  }

  const attempt = {
    flashcardId,
    confidence,
    practicedAt: new Date(now),
  };

  const updated = await persistPracticeAttempt(kitId, attempt);

  return {
    attempt,
    summary: buildPracticeSummary(updated),
    idempotent: false,
  };
}

async function getPracticeSummary(kitId) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) {
    throw httpError(404, 'Kit not found');
  }

  if (kit.status !== 'ready') {
    throw httpError(409, 'Kit is not ready for practice yet');
  }

  return buildPracticeSummary(kit);
}

module.exports = {
  recordPracticeAttempt,
  getPracticeSummary,
  buildPracticeSummary,
  buildRequirementAnalytics,
  latestAttemptByFlashcard,
  CONFIDENCE_LEVELS,
  CONFIDENCE_WEIGHTS,
  IDEMPOTENCY_WINDOW_MS,
};
