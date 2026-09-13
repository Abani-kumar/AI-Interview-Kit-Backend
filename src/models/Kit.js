const mongoose = require('mongoose');

const STAGE_NAMES = [
  'extract-requirements',
  'research-company',
  'generate-brief',
  'generate-questions',
  'check-coverage',
  'generate-flashcards',
  'build-schedule',
  'validate-and-finalize',
];

const stageLogSchema = new mongoose.Schema(
  {
    at: { type: String, required: true },
    level: { type: String, enum: ['info', 'warn', 'error', 'debug'], required: true },
    event: { type: String, required: true },
    message: { type: String, default: null },
    data: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const practiceAttemptSchema = new mongoose.Schema(
  {
    flashcardId: { type: String, required: true },
    confidence: {
      type: String,
      enum: ['low', 'medium', 'high'],
      required: true,
    },
    practicedAt: { type: Date, required: true },
  },
  { _id: false }
);

const stageStateSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['pending', 'running', 'done', 'failed'],
      default: 'pending',
    },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
    logs: { type: [stageLogSchema], default: [] },
  },
  { _id: false }
);

const kitSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    input: {
      jd: { type: String, required: true },
      companyUrl: { type: String, required: true },
      days: { type: Number, required: true },
    },

    status: {
      type: String,
      enum: ['queued', 'generating', 'ready', 'failed', 'stalled'],
      default: 'queued',
    },

    // Incremented on every Kit Builder user mutation for optimistic concurrency.
    contentRevision: { type: Number, default: 0 },

    currentStage: {
      type: String,
      enum: [...STAGE_NAMES, null],
      default: STAGE_NAMES[0],
    },

    stages: {
      type: Map,
      of: stageStateSchema,
      default: () =>
        new Map(STAGE_NAMES.map((name) => [name, { status: 'pending', attempts: 0 }])),
    },

    results: {
      requirements: { type: mongoose.Schema.Types.Mixed, default: null },
      companyData: { type: mongoose.Schema.Types.Mixed, default: null },
      discussionData: { type: mongoose.Schema.Types.Mixed, default: null },
      companyBrief: { type: mongoose.Schema.Types.Mixed, default: null },
      keyEvidence: { type: mongoose.Schema.Types.Mixed, default: null },
      questions: { type: mongoose.Schema.Types.Mixed, default: null },
      flashcards: { type: mongoose.Schema.Types.Mixed, default: null },
      schedule: { type: mongoose.Schema.Types.Mixed, default: null },
      coverage: { type: mongoose.Schema.Types.Mixed, default: null },

      // FIX #3: explicit coverage pass counter, completely separate from
      // BullMQ's own job attempt counter so the two never bleed into each other.
      coveragePass: { type: Number, default: 0 },

      // Active section regeneration metadata (cleared on finalize).
      regeneration: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    data: { type: mongoose.Schema.Types.Mixed, default: null },

    // Practice Mode — confidence attempt history (not Kit Builder edits).
    practice: {
      attempts: { type: [practiceAttemptSchema], default: [] },
    },

    error: { type: String, default: null },
  },
  { timestamps: true }
);

kitSchema.statics.STAGE_NAMES = STAGE_NAMES;
module.exports = mongoose.model('Kit', kitSchema);
