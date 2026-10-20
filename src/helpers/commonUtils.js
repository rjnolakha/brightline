const { getContext } = require('./correlationContext');
const logger = require('./logger');

const DEFAULT_TIMEOUT_MS = 10000;
const safeEndpointSegments = new Set([
  'api', 'v1', 'v2', 'payroll', 'payrun', 'payruns', 'employees', 'employee', 'people', 'person',
  'esign', 'signature', 'signatures', 'candidates', 'candidate', 'ats', 'directory', 'sync',
  'notifications', 'webhooks', 'status', 'health', 'users', 'user', 'accounts', 'jobs',
  'applications', 'departments', 'benefits', 'timesheets', 'transactions', 'payments', 'payment',
  'create', 'update', 'submit', 'process', 'list', 'search', 'events', 'documents', 'templates'
]);

/** Preserves known route labels while replacing dynamic/unknown path components. */
function sanitizePath(pathname) {
  return pathname.split('/').map((segment) => {
    if (!segment) return '';
    return safeEndpointSegments.has(segment.toLowerCase()) ? segment : ':id';
  }).join('/');
}

function sanitizeEndpoint(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${sanitizePath(url.pathname)}`;
  } catch {
    return '[invalid-url]';
  }
}

/** Shared outbound HTTP implementation with bounded timeouts and safe telemetry. */
async function request(method, url, options = {}) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const context = getContext();
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (context.correlationId && !headers.has('x-correlation-id')) {
    headers.set('x-correlation-id', context.correlationId);
  }
  if (context.requestId && !headers.has('x-request-id')) headers.set('x-request-id', context.requestId);
  const controller = new AbortController();
  const timeout = Math.max(1, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeout);
  const abort = () => controller.abort(options.signal.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener('abort', abort, { once: true });
  const endpoint = sanitizeEndpoint(url);
  let response;
  try {
    const target = new URL(url);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
    }
    response = await fetch(target, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    const result = {
      ok: response.ok, status: response.status, data,
      headers: response.headers, durationMs: Date.now() - started
    };
    if (!response.ok) {
      const error = new Error(`HTTP request failed with status ${response.status}`);
      error.name = 'HttpError';
      error.code = response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR';
      error.status = response.status;
      error.response = result;
      throw error;
    }
    logOutbound({ method, endpoint, startedAt, context, options, response, durationMs: result.durationMs, outcome: 'success' });
    return result;
  } catch (error) {
    const timeoutFailure = controller.signal.aborted && !options.signal?.aborted;
    const normalized = error.name === 'HttpError' ? error : Object.assign(new Error(timeoutFailure ? 'Request timed out' : 'Network request failed'), {
      name: timeoutFailure ? 'TimeoutError' : (error.name || 'NetworkError'),
      code: timeoutFailure ? 'ETIMEDOUT' : (error.code || 'NETWORK_ERROR')
    });
    logOutbound({
      method, endpoint, startedAt, context, options, response,
      durationMs: Date.now() - started, outcome: 'failure', error: normalized
    });
    throw normalized;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

function logOutbound({ method, endpoint, startedAt, context, options, response, durationMs, outcome, error }) {
  try {
    logger.info({
      timestamp: startedAt, event: 'http.request.completed', direction: 'outbound',
      method, path: endpoint, integrationId: options.integrationId,
      conversationId: context.conversationId, correlationId: context.correlationId,
      requestId: context.requestId, requestTime: startedAt,
      responseTime: response ? new Date().toISOString() : undefined, durationMs,
      statusCode: response?.status, outcome, retryAttempt: options.retryAttempt,
      errorName: error?.name, errorCode: error?.code,
      errorMessage: error ? 'Outbound request failed' : undefined
    });
  } catch {
    // Diagnostic failures must not replace the HTTP result.
  }
}

const get = (url, options) => request('GET', url, options);
const post = (url, body, options = {}) => request('POST', url, { ...options, body });
const put = (url, body, options = {}) => request('PUT', url, { ...options, body });
const patch = (url, body, options = {}) => request('PATCH', url, { ...options, body });
const del = (url, options) => request('DELETE', url, options);

module.exports = { request, get, post, put, patch, delete: del, sanitizeEndpoint, sanitizePath };
