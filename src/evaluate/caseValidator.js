const { ERROR_CODES, buildError } = require('./errors');

function validateCase(caseInput, index) {
  if (!caseInput || typeof caseInput !== 'object' || Array.isArray(caseInput)) {
    return {
      isValid: false,
      error: buildError(ERROR_CODES.INVALID_INPUT, `Case at index ${index} must be an object`),
    };
  }

  const { id, jd, company_url, companyUrl, days } = caseInput;

  if (!id || typeof id !== 'string' || !id.trim()) {
    return {
      isValid: false,
      error: buildError(ERROR_CODES.INVALID_INPUT, `Case at index ${index} is missing a non-empty "id"`),
    };
  }

  if (!jd || typeof jd !== 'string' || !jd.trim()) {
    return {
      isValid: false,
      error: buildError(
        ERROR_CODES.INVALID_INPUT,
        `Case "${id}" is missing a non-empty "jd" (or "jd_file" pointing to a text file)`
      ),
    };
  }

  const resolvedCompanyUrl = companyUrl || company_url;
  if (!resolvedCompanyUrl || typeof resolvedCompanyUrl !== 'string' || !resolvedCompanyUrl.trim()) {
    return {
      isValid: false,
      error: buildError(
        ERROR_CODES.INVALID_INPUT,
        `Case "${id}" is missing "company_url" or "companyUrl"`
      ),
    };
  }

  const parsedDays = Number(days);
  if (!Number.isInteger(parsedDays) || parsedDays < 1) {
    return {
      isValid: false,
      error: buildError(
        ERROR_CODES.INVALID_INPUT,
        `Case "${id}" must include a positive integer "days"`
      ),
    };
  }

  return {
    isValid: true,
    normalized: {
      id: id.trim(),
      jd: jd.trim(),
      companyUrl: resolvedCompanyUrl.trim(),
      days: parsedDays,
    },
  };
}

module.exports = { validateCase };
