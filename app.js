const path = require('node:path');
const express = require('express');
const cors = require('cors');
const config = require('./config/appConfig');
const { initializeDatabase } = require('./src/helpers/DBUtils');
const { seed } = require('./database/seed');
const { correlationContext } = require('./src/helpers/correlationContext');
const requestLogger = require('./src/helpers/requestLogger');
const { notFoundHandler, errorHandler } = require('./src/helpers/errorHandler');
const healthRouter = require('./src/routers/healthRouter');
const integrationsRouter = require('./src/routers/integrationsRouter');
const logsRouter = require('./src/routers/logsRouter');
const configRouter = require('./src/routers/configRouter');
const { createHealthScheduler } = require('./src/helpers/healthScheduler');

initializeDatabase();
seed();

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: config.corsOrigin }));
app.use(correlationContext);
app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));
app.use('/api/health', healthRouter);
app.use('/api/integrations/:id/logs', logsRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/config', configRouter);

if (config.environment === 'production') {
  const frontend = path.join(__dirname, 'frontend', 'dist');
  app.use(express.static(frontend));
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(frontend, 'index.html')));
}

app.use(notFoundHandler);
app.use(errorHandler);

const scheduler = createHealthScheduler();
module.exports = { app, scheduler };
