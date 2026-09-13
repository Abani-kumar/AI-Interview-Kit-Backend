const { getStageContext } = require('../queue/stageContext');

const STAGE_LABELS = {
  'extract-requirements': 'Requirements extraction',
  'research-company': 'Company research',
  'generate-brief': 'Company brief',
  'generate-questions': 'Question generation',
  'check-coverage': 'Coverage check',
  'generate-flashcards': 'Flashcard generation',
  'build-schedule': 'Schedule build',
  'validate-and-finalize': 'Validate & finalize',
};

const MAX_LOG_ENTRIES = 200;
const MAX_DATA_CHARS = 8000;

function truncateData(data) {
  if (data === undefined || data === null) return data;

  let serialized;
  try {
    serialized = typeof data === 'string' ? data : JSON.stringify(data);
  } catch {
    serialized = String(data);
  }

  if (serialized.length <= MAX_DATA_CHARS) {
    return typeof data === 'string' ? data : JSON.parse(serialized);
  }

  return {
    _truncated: true,
    preview: `${serialized.slice(0, MAX_DATA_CHARS)}…`,
    originalLength: serialized.length,
  };
}

function createStageLogger({ kitId, stageName, passNumber = 0 }) {
  const entries = [];
  const label = STAGE_LABELS[stageName] || stageName;
  const prefix = `[${stageName}] kit=${kitId}${passNumber ? ` pass=${passNumber}` : ''}`;

  function append(level, event, message, data) {
    const entry = {
      at: new Date().toISOString(),
      level,
      event,
      ...(message ? { message } : {}),
      ...(data !== undefined ? { data: truncateData(data) } : {}),
    };

    entries.push(entry);
    if (entries.length > MAX_LOG_ENTRIES) {
      entries.shift();
    }

    const line = message ? `${prefix} ${message}` : `${prefix} ${event}`;
    if (level === 'error') {
      console.error(line, data !== undefined ? entry.data : '');
    } else if (level === 'warn') {
      console.warn(line, data !== undefined ? entry.data : '');
    } else {
      console.log(line, data !== undefined ? entry.data : '');
    }

    return entry;
  }

  return {
    getEntries: () => entries.slice(),
    info: (event, message, data) => append('info', event, message, data),
    warn: (event, message, data) => append('warn', event, message, data),
    error: (event, message, data) => append('error', event, message, data),
    debug: (event, message, data) => append('debug', event, message, data),
    // Reserved for LLM / API payloads — wire up when you specify what to capture.
    response: (source, payload, meta = {}) =>
      append('debug', 'response', `${source} response`, { ...meta, payload }),
    label,
    prefix,
  };
}

function getStageLogger() {
  const context = getStageContext();
  return context?.logger || null;
}

const noopLogger = {
  getEntries: () => [],
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  response: () => {},
};

function getStageLoggerOrNoop() {
  return getStageLogger() || noopLogger;
}

module.exports = {
  STAGE_LABELS,
  createStageLogger,
  getStageLogger,
  getStageLoggerOrNoop,
  truncateData,
};
