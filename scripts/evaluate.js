#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('path');

require('../src/config/env');

const connectDB = require('../src/config/db');
const { verifyRedisConnection } = require('../src/config/redis');
const { parseEvaluateArgs } = require('../src/evaluate/parseArgs');
const { loadCases } = require('../src/evaluate/loadCases');
const { runBatch } = require('../src/evaluate/batchEvaluator');

async function main() {
  const args = parseEvaluateArgs();
  if (!args.isValid) {
    console.error('[evaluate] ' + args.errors.join('; '));
    console.error('[evaluate] Usage: npm run evaluate -- --input <cases.json> --output <kits.json>');
    process.exit(1);
  }

  let cases;
  try {
    cases = await loadCases(path.resolve(args.input));
  } catch (err) {
    console.error(`[evaluate] ${err.message}`);
    process.exit(1);
  }

  try {
    await connectDB();
    await verifyRedisConnection();
  } catch (err) {
    console.error(`[evaluate] Startup failed: ${err.message}`);
    process.exit(1);
  }

  // Start the same BullMQ worker used by the HTTP application.
  require('../src/queue/worker');

  const results = await runBatch(cases);

  await fs.writeFile(path.resolve(args.output), JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(`[evaluate] Fatal error: ${err.message}`);
  process.exit(1);
});
