const { all, get, run, transaction } = require('../helpers/DBUtils');
const { policy } = require('./configDao');

function percentile95(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil(0.95 * ordered.length) - 1];
}

function classify(log) {
  if (log.error_category) return log.error_category;
  if (log.status_code === 429) return 'rate_limit';
  if (log.status_code === 401 || log.status_code === 403) return 'authentication';
  if (log.status_code >= 500) return 'service_error';
  if (log.status_code === 400) return 'input_error';
  if (log.status_code >= 400) return 'client_error';
  if (log.outcome === 'timeout') return 'timeout';
  if (log.outcome === 'network_error') return 'connection';
  return 'other';
}

function getIntegrationMetrics(integration, windowMinutes = policy.windowMinutes, evaluatedAt = new Date()) {
  const start = new Date(evaluatedAt.getTime() - windowMinutes * 60_000).toISOString();
  const logs = all(
    `SELECT occurred_at, status_code, duration_ms, outcome, error_category
     FROM request_logs WHERE integration_id = ? AND occurred_at >= ? ORDER BY occurred_at ASC`,
    [integration.id, start]
  );
  const successful = logs.filter((row) => row.outcome === 'success' && (row.status_code === null || row.status_code < 400)).length;
  const failed = logs.length - successful;
  const latencies = logs.map((row) => row.duration_ms).filter((value) => Number.isFinite(value) && value >= 0);
  const failureBreakdown = { byStatus: {}, byCategory: {} };
  for (const log of logs.filter((row) => !(logSuccess(row)))) {
    const status = log.status_code === null ? 'no_status' : String(log.status_code);
    failureBreakdown.byStatus[status] = (failureBreakdown.byStatus[status] || 0) + 1;
    const category = classify(log);
    failureBreakdown.byCategory[category] = (failureBreakdown.byCategory[category] || 0) + 1;
  }
  const lastRequest = get('SELECT MAX(occurred_at) AS timestamp FROM request_logs WHERE integration_id = ?', [integration.id])?.timestamp || null;
  const lastSuccess = get(
    `SELECT MAX(occurred_at) AS timestamp FROM request_logs
     WHERE integration_id = ? AND outcome = 'success' AND (status_code IS NULL OR status_code < 400)`,
    [integration.id]
  )?.timestamp || null;
  const staleAfter = policy.staleAfterSeconds * 1000;
  const freshness = !lastRequest ? 'no_data' : evaluatedAt.getTime() - Date.parse(lastRequest) > staleAfter ? 'stale' : 'fresh';
  const lastEvaluation = get('SELECT MAX(evaluated_at) AS timestamp FROM health_evaluations WHERE succeeded = 1')?.timestamp || null;
  return {
    totalRequests: logs.length,
    successfulRequests: successful,
    failedRequests: failed,
    errorRatePercent: logs.length ? failed / logs.length * 100 : null,
    averageLatencyMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
    p95LatencyMs: percentile95(latencies),
    maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
    lastRequestAt: lastRequest,
    lastSuccessfulRequestAt: lastSuccess,
    lastEvaluatedAt: lastEvaluation,
    freshness,
    failureBreakdown,
    windowMinutes
  };
}

function logSuccess(log) {
  return log.outcome === 'success' && (log.status_code === null || log.status_code < 400);
}

function evaluateIntegration(integration, windowMinutes, evaluatedAt, persist) {
  const metrics = getIntegrationMetrics(integration, windowMinutes, evaluatedAt);
  const reasons = [];
  const integrationPolicy = { ...policy, ...policy.integrations[integration.id] };
  const criticality = integrationPolicy.critical ?? Boolean(integration.critical);
  let status = 'HEALTHY';
  let ordinaryCritical = false;
  const minimum = integrationPolicy.minimumRequestCount;
  const severeFailureCount = Object.entries(metrics.failureBreakdown.byCategory)
    .filter(([category]) => ['service_error', 'timeout', 'connection', 'authentication'].includes(category))
    .reduce((sum, [, count]) => sum + count, 0);

  if (metrics.totalRequests === 0) {
    status = 'UNKNOWN';
    reasons.push(metrics.freshness === 'stale' ? 'No requests in the evaluation window; latest observed request is stale.' : 'No request data is available in the evaluation window.');
  } else if (metrics.freshness === 'stale') {
    status = 'UNKNOWN';
    reasons.push('Latest request data is stale.');
  } else if (metrics.totalRequests < minimum) {
    status = 'UNKNOWN';
    reasons.push(`Insufficient volume: ${metrics.totalRequests} requests; at least ${minimum} are needed for threshold-based health.`);
  } else {
    if (metrics.errorRatePercent >= integrationPolicy.errorRateWarningPercent) {
      status = 'DEGRADED';
      reasons.push(`Error rate ${metrics.errorRatePercent.toFixed(2)}% is at or above the ${integrationPolicy.errorRateWarningPercent}% warning threshold.`);
    }
    if (metrics.errorRatePercent >= integrationPolicy.errorRateCriticalPercent) {
      ordinaryCritical = true;
      reasons.push(`Error rate ${metrics.errorRatePercent.toFixed(2)}% is at or above the ${integrationPolicy.errorRateCriticalPercent}% critical threshold.`);
    }
    if (metrics.p95LatencyMs !== null && metrics.p95LatencyMs >= integrationPolicy.p95WarningMs) {
      status = 'DEGRADED';
      reasons.push(`P95 latency ${Math.round(metrics.p95LatencyMs)} ms is at or above the ${integrationPolicy.p95WarningMs} ms warning threshold.`);
    }
    if (metrics.p95LatencyMs !== null && metrics.p95LatencyMs >= integrationPolicy.p95CriticalMs) {
      ordinaryCritical = true;
      reasons.push(`P95 latency ${Math.round(metrics.p95LatencyMs)} ms is at or above the ${integrationPolicy.p95CriticalMs} ms critical threshold.`);
    }
    if (severeFailureCount >= 5 && severeFailureCount / metrics.totalRequests >= 0.5) {
      status = 'UNHEALTHY';
      reasons.push(`${severeFailureCount} severe transport, authentication, or service failures indicate an immediate outage.`);
    } else if (ordinaryCritical) {
      const state = get('SELECT consecutive_critical, last_status FROM health_state WHERE integration_id = ?', [integration.id]);
      const count = (state?.consecutive_critical || 0) + (persist ? 1 : 0);
      if (count >= integrationPolicy.criticalPersistenceEvaluations) status = 'UNHEALTHY';
      else status = 'DEGRADED';
    }
    if (status === 'HEALTHY') {
      const state = get('SELECT last_status, consecutive_recovery FROM health_state WHERE integration_id = ?', [integration.id]);
      const recovering = state?.last_status === 'UNHEALTHY' || (state?.consecutive_recovery || 0) > 0;
      const recoveryCount = (state?.consecutive_recovery || 0) + (persist ? 1 : 0);
      if (recovering && recoveryCount < integrationPolicy.recoveryEvaluations) {
        status = 'DEGRADED';
        reasons.push(`Thresholds have recovered; confirming recovery across ${integrationPolicy.recoveryEvaluations} consecutive evaluations.`);
      }
    }
    if (!reasons.length) reasons.push('Request volume and measured thresholds are within policy.');
  }

  if (status === 'UNKNOWN' && !reasons.length) reasons.push('Health cannot be determined from available data.');
  return { integration: { id: integration.id, name: integration.name, category: integration.category, critical: criticality }, status, reasons, metrics };
}

/** Calculates current metrics and optionally persists one atomic evaluation snapshot. */
function evaluateAll({ windowMinutes = policy.windowMinutes, persist = false, now = new Date() } = {}) {
  const integrations = all('SELECT id, name, category, critical FROM integrations WHERE active = 1 ORDER BY name');
  const results = integrations.map((integration) => evaluateIntegration(integration, windowMinutes, now, persist));
  const statusCounts = { HEALTHY: 0, DEGRADED: 0, UNHEALTHY: 0, UNKNOWN: 0 };
  for (const item of results) statusCounts[item.status] += 1;
  const attention = results.filter((item) => item.status !== 'HEALTHY');
  let overallStatus = 'HEALTHY';
  if (results.some((item) => item.status === 'UNHEALTHY' && item.integration.critical)) overallStatus = 'UNHEALTHY';
  else if (results.length === 0 || results.some((item) => item.status === 'UNKNOWN')) overallStatus = 'UNKNOWN';
  else if (results.some((item) => item.status !== 'HEALTHY')) overallStatus = 'DEGRADED';
  const reasons = [];
  if (overallStatus === 'UNKNOWN') reasons.push('One or more integrations have missing, insufficient, or stale health evidence.');
  if (results.some((item) => item.status === 'UNHEALTHY' && item.integration.critical)) reasons.push('At least one critical integration is unhealthy.');
  else if (overallStatus === 'DEGRADED') reasons.push('One or more integrations require attention.');
  else if (overallStatus === 'HEALTHY') reasons.push('All integrations have sufficient fresh evidence and meet policy.');

  const evaluatedAt = now.toISOString();
  if (persist) {
    transaction(() => {
      run('INSERT INTO health_evaluations (evaluated_at, succeeded) VALUES (?, 1)', [evaluatedAt]);
      for (const item of results) {
        item.metrics.lastEvaluatedAt = evaluatedAt;
        const prior = get('SELECT consecutive_critical, consecutive_recovery FROM health_state WHERE integration_id = ?', [item.integration.id]);
        const critical = item.reasons.some((reason) => reason.includes('critical threshold'));
        const consecutive = critical ? (prior?.consecutive_critical || 0) + 1 : 0;
        const recovering = item.status === 'DEGRADED' && item.reasons.some((reason) => reason.includes('confirming recovery'));
        const recovery = recovering ? (prior?.consecutive_recovery || 0) + 1 : 0;
        run(
          `INSERT INTO health_state (integration_id, consecutive_critical, consecutive_recovery, last_status, last_evaluated_at)
           VALUES (?, ?, ?, ?, ?) ON CONFLICT(integration_id) DO UPDATE SET
           consecutive_critical=excluded.consecutive_critical, consecutive_recovery=excluded.consecutive_recovery,
           last_status=excluded.last_status, last_evaluated_at=excluded.last_evaluated_at`,
          [item.integration.id, consecutive, recovery, item.status, evaluatedAt]
        );
        run(
          `INSERT INTO health_snapshots (integration_id, evaluated_at, window_start, status, metrics_json, reasons_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [item.integration.id, evaluatedAt, new Date(now.getTime() - windowMinutes * 60_000).toISOString(), item.status, JSON.stringify(item.metrics), JSON.stringify(item.reasons)]
        );
      }
    });
  }
  const lastSuccessAt = get('SELECT MAX(evaluated_at) AS timestamp FROM health_evaluations WHERE succeeded = 1')?.timestamp || null;
  const lastFailureAt = get('SELECT MAX(evaluated_at) AS timestamp FROM health_evaluations WHERE succeeded = 0')?.timestamp || null;
  return {
    overallStatus, statusCounts, totalIntegrations: results.length, attention,
    integrations: results, reasons, evaluatedAt: lastSuccessAt, computedAt: evaluatedAt,
    evaluationStatus: lastFailureAt && (!lastSuccessAt || lastFailureAt > lastSuccessAt) ? 'degraded' : 'current',
    windowMinutes
  };
}

function getSummary(options) {
  return evaluateAll({ ...options, persist: false });
}

function getIntegrationHealth(id, options = {}) {
  const integration = get('SELECT id, name, category, critical FROM integrations WHERE id = ? AND active = 1', [id]);
  if (!integration) return null;
  return evaluateIntegration(integration, options.windowMinutes || policy.windowMinutes, options.now || new Date(), false);
}

function getHistory(id, limit = 50) {
  return all(
    'SELECT evaluated_at AS evaluatedAt, status, metrics_json AS metricsJson, reasons_json AS reasonsJson FROM health_snapshots WHERE integration_id = ? ORDER BY evaluated_at DESC LIMIT ?',
    [id, limit]
  ).map((row) => ({ ...row, metrics: JSON.parse(row.metricsJson), reasons: JSON.parse(row.reasonsJson) }));
}

function recordEvaluationFailure(error, now = new Date()) {
  const safeError = [error?.name, error?.code].filter(Boolean).join(':').slice(0, 160) || 'EvaluationError';
  run('INSERT INTO health_evaluations (evaluated_at, succeeded, error_message) VALUES (?, 0, ?)', [now.toISOString(), safeError]);
}

module.exports = { percentile95, classify, getIntegrationMetrics, evaluateAll, getSummary, getIntegrationHealth, getHistory, recordEvaluationFailure };
