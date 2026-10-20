const path = require('node:path');
const { z } = require('zod');
require('dotenv').config();

const environment = z.object({
  NODE_ENV: z.string().min(1).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/health.sqlite'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  HEALTH_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15)
}).parse(process.env);

/** Centralized, validated runtime configuration. */
module.exports = Object.freeze({
  environment: environment.NODE_ENV,
  port: environment.PORT,
  databasePath: path.resolve(environment.DATABASE_PATH),
  logLevel: environment.LOG_LEVEL,
  corsOrigin: environment.CORS_ORIGIN,
  healthWindowMinutes: environment.HEALTH_WINDOW_MINUTES
});
