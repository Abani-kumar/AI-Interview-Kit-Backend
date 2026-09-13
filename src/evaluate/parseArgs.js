function parseEvaluateArgs(argv = process.argv.slice(2)) {
  const valueFor = (flag) => {
    const index = argv.indexOf(flag);
    if (index === -1) return null;
    return argv[index + 1] ?? null;
  };

  const input = valueFor('--input');
  const output = valueFor('--output');

  const errors = [];
  if (!input) errors.push('Missing required flag: --input <path>');
  if (!output) errors.push('Missing required flag: --output <path>');

  return {
    input,
    output,
    errors,
    isValid: errors.length === 0,
  };
}

module.exports = { parseEvaluateArgs };
