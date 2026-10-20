const { all, get } = require('../helpers/DBUtils');
const healthDao = require('./healthDao');

/** Coordinates list retrieval with the health DAO, which owns metric computation. */
function listIntegrations(options = {}) {
  const summary = healthDao.getSummary(options);
  return summary.integrations;
}

function getIntegration(id, options = {}) {
  const integration = get('SELECT id FROM integrations WHERE id = ? AND active = 1', [id]);
  return integration ? healthDao.getIntegrationHealth(id, options) : null;
}

function getRecentLogs(id, { limit = 50, offset = 0 } = {}) {
  const exists = get('SELECT id FROM integrations WHERE id = ? AND active = 1', [id]);
  if (!exists) return null;
  const rows = all(
    `SELECT id, occurred_at AS timestamp, method, endpoint, status_code AS statusCode,
      duration_ms AS durationMs, outcome, error_category AS errorCategory,
      error_code AS errorCode, correlation_id AS correlationId
     FROM request_logs WHERE integration_id = ? ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
    [id, limit, offset]
  );
  return { logs: rows, limit, offset };
}

module.exports = { listIntegrations, getIntegration, getRecentLogs };
