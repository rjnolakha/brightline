const logger = require('./logger');
const { getContext } = require('./correlationContext');
const config = require('../../config/appConfig');

/** Emits exactly one structured completion event per inbound response. */
function requestLogger(req, res, next) {
  const requestTime = new Date().toISOString();
  const started = process.hrtime.bigint();
  res.once('finish', () => {
    const responseTime = new Date().toISOString();
    const context = getContext();
    const statusCode = res.statusCode;
    const outcome = statusCode >= 500 ? 'failure' : statusCode >= 400 ? 'client_error' : 'success';
    try {
      logger.info({
        timestamp: requestTime, event: 'http.request.completed', direction: 'inbound',
        service: 'brightline-integration-health', environment: config.environment,
        method: req.method, path: req.path, integrationId: req.params?.id,
        conversationId: context.conversationId, correlationId: context.correlationId,
        requestId: context.requestId, requestTime, responseTime,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        statusCode, outcome,
        errorName: res.locals?.error?.errorName,
        errorCode: res.locals?.error?.errorCode,
        errorMessage: res.locals?.error?.errorMessage
      });
    } catch {
      // Logging is best-effort and must not interfere with completed responses.
    }
  });
  next();
}

module.exports = requestLogger;
