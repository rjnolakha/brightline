const { createBatch, createRecord, parseOptions, main } = require('../../scripts/simulateLogs');

const integrationIds = ['payroll', 'e-signature', 'ats', 'directory-sync', 'notifications'];

test('creates distinct, clearly synthetic records for each integration', () => {
  const now = new Date('2026-10-19T12:00:00.000Z');
  const batch = createBatch(integrationIds, { runId: 'demo-run', sequence: 3, now, random: () => 0.5 });
  expect(batch).toHaveLength(5);
  expect(batch.map((record) => record.integrationId)).toEqual(integrationIds);
  expect(new Set(batch.map((record) => record.sourceId)).size).toBe(5);
  expect(batch.every((record) => record.sourceId.startsWith('synthetic:'))).toBe(true);
  expect(batch.every((record) => record.endpoint === '/synthetic/health-check')).toBe(true);
  expect(batch.every((record) => record.outcome === 'success')).toBe(true);
  expect(batch.every((record) => record.timestamp === now.toISOString())).toBe(true);
});

test.each([
  [0.01, 503, 'failure', 'service_error'],
  [0.02, null, 'timeout', 'timeout'],
  [0.029, 429, 'failure', 'rate_limit'],
  [0.5, 200, 'success', undefined]
])('maps synthetic sample %s to %s/%s', (sample, statusCode, outcome, category) => {
  const sequence = [sample, 0.5, 0.5];
  const record = createRecord('payroll', {
    runId: 'demo-run',
    sequence: 1,
    now: new Date('2026-10-19T12:00:00.000Z'),
    random: () => sequence.shift() ?? 0.5
  });
  expect(record.statusCode).toBe(statusCode);
  expect(record.outcome).toBe(outcome);
  expect(record.errorCategory).toBe(category);
});

test('validates simulator interval and one-shot options', () => {
  expect(parseOptions([])).toEqual({ intervalMs: 1000, once: false });
  expect(parseOptions(['--interval-ms', '250', '--once'])).toEqual({ intervalMs: 250, once: true });
  expect(() => parseOptions(['--interval-ms', '10'])).toThrow('--interval-ms must be an integer');
  expect(() => parseOptions(['--unknown'])).toThrow('Unknown option');
});

test('does not initialize a database or write logs in production mode', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    expect(() => main(['--once'])).toThrow('disabled when NODE_ENV=production');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
