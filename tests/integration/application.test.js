const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const request = require('supertest');

const databasePath = path.join(os.tmpdir(), `brightline-${randomUUID()}.sqlite`);
process.env.DATABASE_PATH = databasePath;
process.env.NODE_ENV = 'test';

const { app } = require('../../app');
const { run, get, transaction, closeDatabase } = require('../../src/helpers/DBUtils');
const healthDao = require('../../src/dao/healthDao');
const { sanitizeEndpoint } = require('../../src/helpers/commonUtils');
const { importLogs } = require('../../src/dao/logsDao');
const { createHealthScheduler } = require('../../src/helpers/healthScheduler');
const { normalize } = require('../../scripts/importLogs');

beforeEach(() => {
  run('DELETE FROM request_logs');
  run('DELETE FROM health_snapshots');
  run('DELETE FROM health_evaluations');
  run("UPDATE health_state SET consecutive_critical=0, last_status='UNKNOWN', last_evaluated_at=NULL");
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(databasePath + suffix); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
});

function fixtureLogs({ integrationId = 'payroll', count = 20, failures = 0, durationMs = 100, timestamp = new Date().toISOString() } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    sourceId: `${randomUUID()}-${index}`, integrationId, timestamp, method: 'GET',
    endpoint: '/v1/payments?token=private', statusCode: index < failures ? 500 : 200,
    durationMs, outcome: index < failures ? 'failure' : 'success'
  }));
}

describe('health metrics and policy', () => {
  test('computes nearest-rank P95 correctly and leaves empty latency undefined', () => {
    expect(healthDao.percentile95([10, 20, 30, 40, 50])).toBe(50);
    expect(healthDao.percentile95([])).toBeNull();
  });

  test('reports zero-volume integrations as UNKNOWN, never HEALTHY', async () => {
    const response = await request(app).get('/api/health/summary');
    expect(response.status).toBe(200);
    expect(response.body.data.overallStatus).toBe('UNKNOWN');
    expect(response.body.data.statusCounts.UNKNOWN).toBe(5);
    expect(response.body.data.integrations[0].metrics.errorRatePercent).toBeNull();
  });

  test('uses inclusive warning boundary and critical threshold persistence', () => {
    const now = new Date();
    importLogs(fixtureLogs({ failures: 1 }));
    const first = healthDao.evaluateAll({ now, persist: true });
    const payroll = first.integrations.find((item) => item.integration.id === 'payroll');
    expect(payroll.metrics.errorRatePercent).toBe(5);
    expect(payroll.status).toBe('DEGRADED');
    const second = healthDao.evaluateAll({ now: new Date(now.getTime() + 1000), persist: true });
    expect(second.integrations.find((item) => item.integration.id === 'payroll').status).toBe('UNHEALTHY');
    expect(second.overallStatus).toBe('UNHEALTHY');
  });

  test('applies inclusive error-rate and latency warning thresholds', () => {
    importLogs(fixtureLogs({ count: 50, failures: 1 }));
    const errorBoundary = healthDao.getIntegrationHealth('payroll');
    expect(errorBoundary.metrics.errorRatePercent).toBe(2);
    expect(errorBoundary.status).toBe('DEGRADED');

    run('DELETE FROM request_logs');
    importLogs(fixtureLogs({ count: 20, durationMs: 1000 }));
    const latencyBoundary = healthDao.getIntegrationHealth('payroll');
    expect(latencyBoundary.metrics.p95LatencyMs).toBe(1000);
    expect(latencyBoundary.status).toBe('DEGRADED');
  });

  test('marks out-of-window old observations stale and UNKNOWN', () => {
    importLogs(fixtureLogs({ count: 1, timestamp: new Date(Date.now() - 10 * 60_000).toISOString() }));
    const payroll = healthDao.getIntegrationHealth('payroll');
    expect(payroll.metrics.freshness).toBe('stale');
    expect(payroll.status).toBe('UNKNOWN');
  });

  test('requires consecutive healthy evaluations before recovering from unhealthy', () => {
    importLogs(fixtureLogs({ failures: 20 }));
    healthDao.evaluateAll({ persist: true });
    expect(healthDao.evaluateAll({ now: new Date(Date.now() + 1000), persist: true })
      .integrations.find((item) => item.integration.id === 'payroll').status).toBe('UNHEALTHY');
    run('DELETE FROM request_logs WHERE integration_id = ?', ['payroll']);
    importLogs(fixtureLogs({ failures: 0 }));
    expect(healthDao.evaluateAll({ persist: true })
      .integrations.find((item) => item.integration.id === 'payroll').status).toBe('DEGRADED');
    expect(healthDao.evaluateAll({ persist: true })
      .integrations.find((item) => item.integration.id === 'payroll').status).toBe('HEALTHY');
  });

  test('classifies HTTP, rate limit, auth, timeout, and network failures', () => {
    const classify = healthDao.classify;
    expect(classify({ status_code: 503 })).toBe('service_error');
    expect(classify({ status_code: 429 })).toBe('rate_limit');
    expect(classify({ status_code: 401 })).toBe('authentication');
    expect(classify({ status_code: 400 })).toBe('input_error');
    expect(classify({ status_code: 404 })).toBe('client_error');
    expect(classify({ status_code: null, outcome: 'timeout' })).toBe('timeout');
    expect(classify({ status_code: null, outcome: 'network_error' })).toBe('connection');
  });

  test('non-critical unhealthy integrations degrade the platform when all evidence is fresh', () => {
    for (const integrationId of ['payroll', 'e-signature', 'ats', 'directory-sync']) {
      importLogs(fixtureLogs({ integrationId, count: 20 }));
    }
    importLogs(fixtureLogs({ integrationId: 'notifications', count: 20, failures: 20 }));
    const result = healthDao.evaluateAll({ persist: true });
    expect(result.integrations.find((item) => item.integration.id === 'notifications').status).toBe('UNHEALTHY');
    expect(result.overallStatus).toBe('DEGRADED');
  });

  test('rejects invalid import records and deduplicates source IDs', () => {
    const records = [
      ...fixtureLogs({ count: 1 }),
      ...fixtureLogs({ count: 1, timestamp: 'not-a-date' }),
      { sourceId: 'missing-integration', integrationId: 'missing', timestamp: new Date().toISOString(), method: 'GET', endpoint: '/' }
    ];
    const first = importLogs(records);
    expect(first.inserted).toBe(1);
    expect(first.rejected).toBe(2);
    expect(first.rejectionReasons).toHaveLength(2);
    expect(importLogs(records.slice(0, 1)).duplicates).toBe(1);
    expect(get('SELECT endpoint FROM request_logs WHERE source_id = ?', [records[0].sourceId]).endpoint).toBe('/v1/payments');
    expect(sanitizeEndpoint('https://vendor.example/v1/employees/Rahul-Jain?token=secret')).toBe('https://vendor.example/v1/employees/:id');
    expect(normalize({ integration_id: 'ats', occurred_at: '2026-01-01T00:00:00Z', method: 'GET', path: '/x' }, 4).integrationId).toBe('ats');
  });

  test('uses parameterized values and rolls back failed transaction work', () => {
    const injection = "'); DROP TABLE integrations; --";
    expect(() => transaction(() => {
      run('INSERT INTO health_evaluations (evaluated_at, succeeded) VALUES (?, 1)', [injection]);
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(get('SELECT COUNT(*) AS count FROM integrations').count).toBe(5);
    expect(get('SELECT COUNT(*) AS count FROM health_evaluations WHERE evaluated_at = ?', [injection]).count).toBe(0);
  });
});

describe('HTTP API', () => {
  test('returns correlation IDs and validates pagination', async () => {
    const valid = await request(app).get('/api/integrations').set('X-Correlation-ID', 'trace-123');
    expect(valid.headers['x-correlation-id']).toBe('trace-123');
    expect(valid.headers['x-request-id']).toBeTruthy();
    const invalid = await request(app).get('/api/integrations/payroll/logs?limit=500');
    expect(invalid.status).toBe(400);
    const missing = await request(app).get('/api/integrations/no-such/health');
    expect(missing.status).toBe(404);
    expect((await request(app).get('/api/health/live')).body.data.status).toBe('LIVE');
    expect((await request(app).get('/api/health/ready')).status).toBe(200);
    expect((await request(app).get('/api/config/health-rules')).body.data.windowMinutes).toBe(15);
  });
});

test('scheduler prevents overlapping evaluations and can stop', async () => {
  let complete;
  let calls = 0;
  const scheduler = createHealthScheduler({ intervalMs: 100000, evaluate: () => { calls += 1; return new Promise((resolve) => { complete = resolve; }); } });
  const first = scheduler.tick();
  expect(scheduler.isRunning()).toBe(true);
  expect(await scheduler.tick()).toBe(false);
  expect(calls).toBe(1);
  complete();
  await first;
  await scheduler.stop();
  expect(scheduler.isRunning()).toBe(false);
});

test('scheduler records failed evaluations without crashing', async () => {
  const scheduler = createHealthScheduler({ evaluate: () => { throw Object.assign(new Error('not persisted'), { code: 'TEST_FAILURE' }); } });
  await scheduler.tick();
  await scheduler.stop();
  expect(get('SELECT succeeded, error_message FROM health_evaluations ORDER BY id DESC LIMIT 1'))
    .toMatchObject({ succeeded: 0, error_message: 'Error:TEST_FAILURE' });
});
