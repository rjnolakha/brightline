const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

const storage = new AsyncLocalStorage();
const validId = /^[A-Za-z0-9._:-]{1,128}$/;

function safeHeader(value) {
  return typeof value === 'string' && validId.test(value) ? value : undefined;
}

/** Isolates request identifiers across concurrent async request lifecycles. */
function correlationContext(req, res, next) {
  const requestId = safeHeader(req.get('x-request-id')) || randomUUID();
  const correlationId = safeHeader(req.get('x-correlation-id')) || requestId;
  const conversationId = safeHeader(req.get('x-conversation-id'));
  const context = { requestId, correlationId, conversationId };
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Correlation-ID', correlationId);
  storage.run(context, next);
}

function getContext() {
  return storage.getStore() || {};
}

module.exports = { correlationContext, getContext, safeHeader };
