const fs = require('node:fs/promises');
const path = require('node:path');
const { parseCasesJson } = require('./parseCasesJson');

async function resolveJdFile(caseInput, baseDir) {
  const jdFile = caseInput.jd_file || caseInput.jdFile;
  if (!jdFile) {
    return caseInput;
  }

  const jdPath = path.resolve(baseDir, jdFile);
  let jd;
  try {
    jd = await fs.readFile(jdPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`JD file not found for case "${caseInput.id}": ${jdPath}`);
    }
    throw new Error(`Could not read JD file for case "${caseInput.id}": ${err.message}`);
  }

  return {
    ...caseInput,
    jd,
  };
}

async function loadCases(inputPath) {
  const resolvedInputPath = path.resolve(inputPath);
  const baseDir = path.dirname(resolvedInputPath);

  let raw;
  try {
    raw = await fs.readFile(resolvedInputPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Input file not found: ${resolvedInputPath}`);
    }
    throw new Error(`Could not read input file: ${err.message}`);
  }

  let parsed;
  try {
    parsed = parseCasesJson(raw);
  } catch (err) {
    throw new Error(err.message);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Input JSON must be an array of cases');
  }

  const cases = [];
  for (const caseInput of parsed) {
    cases.push(await resolveJdFile(caseInput, baseDir));
  }

  return cases;
}

module.exports = { loadCases, resolveJdFile };
