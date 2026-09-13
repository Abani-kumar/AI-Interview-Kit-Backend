const extractRequirements = require('../kits/stages/extractRequirements/extractRequirements');
const researchCompany = require('../kits/stages/researchCompany');
const generateBrief = require('../kits/stages/generateBrief');
const generateQuestions = require('../kits/stages/generateQuestions');
const checkCoverage = require('../kits/stages/checkCoverage');
const generateFlashcards = require('../kits/stages/generateFlashcards');
const buildSchedule = require('../kits/stages/buildSchedule');
const validateAndFinalize = require('../kits/stages/validateAndFinalize');

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
};

const stageRegistry = {
  'extract-requirements': {
    next: 'research-company',
    jobOptions: DEFAULT_JOB_OPTIONS,
    handler: extractRequirements,
  },
  'research-company': {
    next: 'generate-brief',
    jobOptions: DEFAULT_JOB_OPTIONS,
    handler: researchCompany,
  },
  'generate-brief': {
    next: 'generate-questions',
    jobOptions: DEFAULT_JOB_OPTIONS,
    handler: generateBrief,
  },
  'generate-questions': {
    next: 'check-coverage',
    jobOptions: DEFAULT_JOB_OPTIONS,
    handler: generateQuestions,
  },
  'check-coverage': {
    next: 'generate-flashcards',
    jobOptions: DEFAULT_JOB_OPTIONS,
    handler: checkCoverage,
  },
  'generate-flashcards': {
    next: 'build-schedule',
    jobOptions: DEFAULT_JOB_OPTIONS,
    handler: generateFlashcards,
  },
  'build-schedule': {
    next: 'validate-and-finalize',
    jobOptions: DEFAULT_JOB_OPTIONS,
    handler: buildSchedule,
  },
  'validate-and-finalize': {
    next: null,
    jobOptions: DEFAULT_JOB_OPTIONS,
    handler: validateAndFinalize,
  },
};

module.exports = { stageRegistry };
