const { run, transaction, get } = require('../helpers/DBUtils');
const { validateImportedLog } = require('../validators/logsValidator');
const { sanitizePath } = require('../helpers/commonUtils');

/** Validates, deduplicates, sanitizes, and inserts normalized import records atomically. */
function importLogs(records) {
  const stats = { processed: records.length, inserted: 0, duplicates: 0, rejected: 0, rejectionReasons: [] };
  transaction(() => {
    for (const [index, record] of records.entries()) {
      const validated = validateImportedLog(record);
      if (!validated.success) {
        stats.rejected += 1;
        stats.rejectionReasons.push({ index, reason: 'invalid_record' });
        continue;
      }
      const normalized = validated.data;
      const integration = get('SELECT id FROM integrations WHERE id = ?', [normalized.integrationId]);
      const timestamp = new Date(normalized.timestamp);
      if (!integration || Number.isNaN(timestamp.getTime()) || !record.method || !record.endpoint || !record.sourceId) {
        stats.rejected += 1;
        stats.rejectionReasons.push({ index, reason: !integration ? 'unknown_integration' : 'invalid_timestamp' });
        continue;
      }
      const outcome = normalized.outcome || ((normalized.statusCode ?? 0) >= 400 ? 'failure' : 'success');
      let endpoint;
      try {
        endpoint = sanitizePath(new URL(normalized.endpoint, 'http://local.invalid').pathname);
      } catch {
        stats.rejected += 1;
        stats.rejectionReasons.push({ index, reason: 'invalid_endpoint' });
        continue;
      }
      const result = run(
        `INSERT OR IGNORE INTO request_logs
         (source_id, integration_id, occurred_at, method, endpoint, status_code, duration_ms,
          outcome, error_category, error_code, correlation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [normalized.sourceId, normalized.integrationId, timestamp.toISOString(), normalized.method.toUpperCase(),
          endpoint.slice(0, 500), normalized.statusCode ?? null, normalized.durationMs ?? null,
          outcome, normalized.errorCategory || null, normalized.errorCode || null, normalized.correlationId || null, new Date().toISOString()]
      );
      if (result.changes) stats.inserted += 1;
      else stats.duplicates += 1;
    }
  });
  return stats;
}

module.exports = { importLogs };
