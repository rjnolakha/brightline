const logger = require('./logger');
const config = require('../../config/appConfig');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.statusCode || (error.status >= 400 && error.status < 500 ? error.status : 500);
  res.locals.error = {
    errorName: error.name || 'Error',
    errorCode: error.code || 'REQUEST_ERROR',
    errorMessage: 'Request failed'
  };
  logger.error({
    event: 'http.request.error', method: req.method, path: req.path,
    errorName: error.name, errorCode: error.code, statusCode: status
  });
  res.status(status).json({
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: status >= 500 && config.environment === 'production' ? 'Internal server error' : error.message
    }
  });
}

module.exports = { notFoundHandler, errorHandler };
