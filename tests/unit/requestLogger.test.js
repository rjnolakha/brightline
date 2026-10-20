const { EventEmitter } = require('node:events');
const logger = require('../../src/helpers/logger');
const requestLogger = require('../../src/helpers/requestLogger');

test('logs one completed request with timestamps, duration, status, and safe fields', () => {
  const write = vi.spyOn(logger, 'info').mockImplementation(() => {});
  const req = { method: 'POST', path: '/api/example', params: {}, body: { password: 'never-log' } };
  const res = new EventEmitter();
  res.statusCode = 201;
  let continued = false;
  requestLogger(req, res, () => { continued = true; });
  expect(continued).toBe(true);
  res.emit('finish');
  expect(write).toHaveBeenCalledTimes(1);
  const event = write.mock.calls[0][0];
  expect(event.event).toBe('http.request.completed');
  expect(event.requestTime).toBeTruthy();
  expect(event.responseTime).toBeTruthy();
  expect(event.durationMs).toBeGreaterThanOrEqual(0);
  expect(event.statusCode).toBe(201);
  expect(JSON.stringify(event)).not.toContain('never-log');
  write.mockRestore();
});
