const http = require('node:http');
const { get, post, put, patch, delete: del } = require('../../src/helpers/commonUtils');
const { correlationContext, getContext } = require('../../src/helpers/correlationContext');

let server;
let baseUrl;
let received = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ method: req.method, body, correlationId: req.headers['x-correlation-id'] });
      if (req.url === '/slow') return setTimeout(() => { res.writeHead(200); res.end('{}'); }, 100);
      if (req.url === '/limited') { res.writeHead(429, { 'content-type': 'application/json' }); return res.end('{"error":"limit"}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, body: body ? JSON.parse(body) : null }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
beforeEach(() => { received = []; });

test.each([
  ['GET', () => get(`${baseUrl}/get`)],
  ['POST', () => post(`${baseUrl}/post`, { value: 1 })],
  ['PUT', () => put(`${baseUrl}/put`, { value: 2 })],
  ['PATCH', () => patch(`${baseUrl}/patch`, { value: 3 })],
  ['DELETE', () => del(`${baseUrl}/delete`)]
])('supports %s', async (method, call) => {
  const result = await call();
  expect(result.ok).toBe(true);
  expect(result.data.method).toBe(method);
  expect(received[0].method).toBe(method);
});

test('propagates request correlation context', async () => {
  const req = { get: (name) => name === 'x-correlation-id' ? 'trace-abc' : undefined };
  const res = { setHeader: () => {} };
  const result = await new Promise((resolve, reject) => {
    correlationContext(req, res, () => get(`${baseUrl}/trace`).then(resolve, reject));
  });
  expect(result.ok).toBe(true);
  expect(received[0].correlationId).toBe('trace-abc');
});

test('keeps identifiers isolated across concurrent asynchronous requests', async () => {
  const execute = (id, delay) => new Promise((resolve) => {
    const req = { get: (name) => name === 'x-correlation-id' ? id : undefined };
    correlationContext(req, { setHeader: () => {} }, () => {
      setTimeout(() => resolve(getContext().correlationId), delay);
    });
  });
  await expect(Promise.all([execute('request-a', 15), execute('request-b', 5)])).resolves.toEqual(['request-a', 'request-b']);
});

test('classifies non-success, timeout, and network failures', async () => {
  await expect(get(`${baseUrl}/limited`)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  await expect(get(`${baseUrl}/slow`, { timeoutMs: 10 })).rejects.toMatchObject({ name: 'TimeoutError', code: 'ETIMEDOUT' });
  await expect(get('http://127.0.0.1:1/unavailable', { timeoutMs: 100 })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
});

test('honors cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(get(`${baseUrl}/cancel`, { signal: controller.signal })).rejects.toBeTruthy();
});
