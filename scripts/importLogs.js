const fs = require('node:fs');
const path = require('node:path');
const { initializeDatabase, closeDatabase } = require('../src/helpers/DBUtils');
const { seed } = require('../database/seed');
const { importLogs } = require('../src/dao/logsDao');

function parseArgs(args) {
  const fileIndex = args.indexOf('--file');
  return fileIndex >= 0 ? args[fileIndex + 1] : undefined;
}

function normalize(record, index) {
  return {
    sourceId: record.sourceId || record.id || `${record.integrationId || record.integration_id}:${record.timestamp || record.occurredAt}:${record.method}:${record.endpoint}:${record.statusCode ?? record.status_code}:${index}`,
    integrationId: record.integrationId || record.integration_id,
    timestamp: record.timestamp || record.occurredAt || record.occurred_at,
    method: record.method,
    endpoint: record.endpoint || record.path,
    statusCode: record.statusCode ?? record.status_code ?? null,
    durationMs: record.durationMs ?? record.duration_ms ?? null,
    outcome: record.outcome,
    errorCategory: record.errorCategory || record.error_category,
    errorCode: record.errorCode || record.error_code,
    correlationId: record.correlationId || record.correlation_id
  };
}

function main(file) {
  if (!file) throw new Error('Usage: npm run import-logs -- --file ./path/to/request-logs.json');
  const records = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!Array.isArray(records)) throw new Error('Input JSON must be an array of request log objects.');
  initializeDatabase();
  seed();
  const stats = importLogs(records.map(normalize));
  console.log(JSON.stringify(stats, null, 2));
  return stats;
}

if (require.main === module) {
  try {
    main(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`Import failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    closeDatabase();
  }
}

module.exports = { parseArgs, normalize, main };
