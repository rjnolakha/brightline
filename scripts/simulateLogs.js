const { randomUUID } = require('node:crypto');
const { initializeDatabase, closeDatabase, all } = require('../src/helpers/DBUtils');
const { seed } = require('../database/seed');
const { importLogs } = require('../src/dao/logsDao');

const DEFAULT_INTERVAL_MS = 1000;
let stopping = false;

/** Creates one clearly synthetic request observation for a configured integration. */
function createRecord(integrationId, { runId, sequence, now, random = Math.random }) {
  const sample = random();
  let statusCode = 200;
  let outcome = 'success';
  let errorCategory;
  let errorCode;
  let durationMs = Math.round(80 + random() * 520);

  if (sample < 0.015) {
    statusCode = 503;
    outcome = 'failure';
    errorCategory = 'service_error';
    errorCode = 'SYNTHETIC_HTTP_503';
    durationMs = Math.round(150 + random() * 350);
  } else if (sample < 0.025) {
    statusCode = null;
    outcome = 'timeout';
    errorCategory = 'timeout';
    errorCode = 'SYNTHETIC_TIMEOUT';
    durationMs = 10000;
  } else if (sample < 0.03) {
    statusCode = 429;
    outcome = 'failure';
    errorCategory = 'rate_limit';
    errorCode = 'SYNTHETIC_HTTP_429';
    durationMs = Math.round(50 + random() * 150);
  }

  return {
    sourceId: `synthetic:${runId}:${integrationId}:${sequence}`,
    integrationId,
    timestamp: now.toISOString(),
    method: 'GET',
    endpoint: '/synthetic/health-check',
    statusCode,
    durationMs,
    outcome,
    errorCategory,
    errorCode,
    correlationId: randomUUID()
  };
}

/** Creates a synthetic traffic batch; default distribution is 97% success, 3% failures. */
function createBatch(integrationIds, { runId = randomUUID(), sequence = 1, now = new Date(), random = Math.random } = {}) {
  return integrationIds.map((integrationId, index) =>
    createRecord(integrationId, { runId, sequence: `${sequence}-${index}`, now, random })
  );
}

function parseOptions(args) {
  let intervalMs = DEFAULT_INTERVAL_MS;
  let once = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--once') {
      once = true;
    } else if (args[index] === '--interval-ms') {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 100 || value > 3_600_000) {
        throw new Error('--interval-ms must be an integer between 100 and 3600000.');
      }
      intervalMs = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${args[index]}`);
    }
  }
  return { intervalMs, once };
}

function runBatch(integrationIds, options = {}) {
  const batch = createBatch(integrationIds, options);
  const stats = importLogs(batch);
  console.log(JSON.stringify({
    event: 'synthetic.logs.inserted',
    timestamp: new Date().toISOString(),
    synthetic: true,
    ...stats
  }));
  return stats;
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  closeDatabase();
}

function main(args = process.argv.slice(2)) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Synthetic log generation is disabled when NODE_ENV=production.');
  }
  const { intervalMs, once } = parseOptions(args);
  initializeDatabase();
  seed();
  const integrationIds = all('SELECT id FROM integrations WHERE active = 1 ORDER BY id').map((row) => row.id);
  if (integrationIds.length === 0) throw new Error('No active integrations are configured.');

  const runId = randomUUID();
  let sequence = 0;
  const tick = () => {
    sequence += 1;
    runBatch(integrationIds, { runId, sequence });
    return sequence;
  };

  tick();
  if (once) {
    shutdown();
    return undefined;
  }

  const timer = setInterval(() => {
    if (!stopping) tick();
  }, intervalMs);
  const stop = () => {
    clearInterval(timer);
    shutdown();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return timer;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Synthetic log generator failed: ${error.message}`);
    shutdown();
    process.exitCode = 1;
  }
}

module.exports = { DEFAULT_INTERVAL_MS, createRecord, createBatch, parseOptions, runBatch, main };
