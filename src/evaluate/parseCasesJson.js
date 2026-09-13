/**
 * Parse evaluator case JSON with a small repair pass for a common authoring mistake:
 * pasting multi-line JD text directly inside JSON strings without escaping newlines.
 */
function escapeNewlinesInJsonStrings(raw) {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString && ch === '\r') {
      if (raw[i + 1] === '\n') {
        result += '\\n';
        i += 1;
      } else {
        result += '\\n';
      }
      continue;
    }

    if (inString && ch === '\n') {
      result += '\\n';
      continue;
    }

    if (inString && ch === '\t') {
      result += '\\t';
      continue;
    }

    result += ch;
  }

  return result;
}

function parseCasesJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (firstErr) {
    try {
      return JSON.parse(escapeNewlinesInJsonStrings(raw));
    } catch {
      const hint =
        'Input file is not valid JSON. For multi-line job descriptions, either paste the JD ' +
        'directly inside the JSON string (newlines are auto-fixed), use escaped newlines like ' +
        '"line1\\n\\nline2", or provide a "jd_file" path to a separate text file.';
      throw new Error(hint);
    }
  }
}

module.exports = { parseCasesJson, escapeNewlinesInJsonStrings };
