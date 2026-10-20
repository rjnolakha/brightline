const http = require('node:http');
const { app, scheduler } = require('./app');
const config = require('./config/appConfig');
const { closeDatabase } = require('./src/helpers/DBUtils');
const logger = require('./src/helpers/logger');

const server = http.createServer(app);
server.listen(config.port, () => {
  logger.info({ event: 'server.started', port: config.port, environment: config.environment });
  scheduler.start();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ event: 'server.shutdown', signal });
  server.close(async () => {
    try {
      await scheduler.stop();
      closeDatabase();
      process.exitCode = 0;
    } catch (error) {
      logger.error({ event: 'server.shutdown.failed', errorName: error.name });
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
