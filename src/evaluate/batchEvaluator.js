const { createAndEnqueueKit } = require('../kits/createAndEnqueueKit');
const { validateKitStructure } = require('../kits/kit.validator');
const { validateCase } = require('./caseValidator');
const { waitForKit } = require('./waitForKit');
const { resolveBatchUserId } = require('./resolveBatchUserId');
const { ERROR_CODES, buildError } = require('./errors');

function log(message) {
  console.log(`[evaluate] ${message}`);
}

function buildFailureResult(caseId, error) {
  if (error?.code && error?.message) {
    return { id: caseId, status: 'failed', error };
  }

  const code =
    error?.code === 'TIMEOUT'
      ? ERROR_CODES.TIMEOUT
      : error?.code === 'ENQUEUE_FAILED'
        ? ERROR_CODES.ENQUEUE_FAILED
        : ERROR_CODES.GENERATION_FAILED;

  return {
    id: caseId,
    status: 'failed',
    error: buildError(code, error?.message || 'Generation failed'),
  };
}

async function runBatch(cases, options = {}) {
  if (!Array.isArray(cases)) {
    throw new Error('Cases must be an array');
  }

  log(`${cases.length} cases`);

  const results = [];
  const pending = [];

  for (let index = 0; index < cases.length; index += 1) {
    const caseInput = cases[index];
    const validation = validateCase(caseInput, index);

    if (!validation.isValid) {
      const caseId = caseInput?.id || `case-${index}`;
      log(`${caseId} failed`);
      results.push(buildFailureResult(caseId, validation.error));
      continue;
    }

    const { id, jd, companyUrl, days } = validation.normalized;
    const userId = options.userId || resolveBatchUserId();

    log(`${id} started`);

    let kit;
    try {
      kit = await createAndEnqueueKit({ userId, jd, companyUrl, days });
    } catch (err) {
      log(`${id} failed`);
      results.push(buildFailureResult(id, buildError(ERROR_CODES.ENQUEUE_FAILED, err.message)));
      continue;
    }

    pending.push({ id, kitId: kit._id });
  }

  const waitOptions = options.waitOptions || {};
  const completed = await Promise.all(
    pending.map(async ({ id, kitId }) => {
      try {
        const finalized = await waitForKit(kitId, waitOptions);

        if (finalized.status === 'failed' || finalized.status === 'stalled') {
          log(`${id} failed`);
          return buildFailureResult(
            id,
            buildError(ERROR_CODES.GENERATION_FAILED, finalized.error || `Kit status: ${finalized.status}`)
          );
        }

        if (!finalized.data) {
          log(`${id} failed`);
          return buildFailureResult(
            id,
            buildError(ERROR_CODES.VALIDATION_FAILED, 'Kit reached ready status without finalized data')
          );
        }

        try {
          validateKitStructure(finalized.data);
        } catch (validationErr) {
          log(`${id} failed`);
          return buildFailureResult(id, buildError(ERROR_CODES.VALIDATION_FAILED, validationErr.message));
        }

        log(`${id} completed`);
        return {
          id,
          status: 'success',
          kit: finalized.data,
        };
      } catch (err) {
        log(`${id} failed`);
        return buildFailureResult(id, err);
      }
    })
  );

  const orderedResults = [...results, ...completed];
  const successCount = orderedResults.filter((item) => item.status === 'success').length;
  log(`completed: ${successCount}/${cases.length} successful`);

  return orderedResults;
}

module.exports = { runBatch, buildFailureResult, log };
