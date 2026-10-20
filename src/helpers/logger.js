const pino = require('pino');
const config = require('../../config/appConfig');

const logger = pino({
  level: config.logLevel,
  base: { service: 'brightline-integration-health', environment: config.environment },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie',
      'body', 'requestBody', 'responseBody', '*.password', '*.token', '*.apiKey', '*.payroll', '*.employee'],
    censor: '[REDACTED]'
  },
  serializers: {
    err(error) {
      return { name: error?.name, code: error?.code };
    }
  }
});

module.exports = logger;
