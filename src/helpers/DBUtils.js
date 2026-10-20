const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../../config/appConfig');
const logger = require('./logger');

let database;

/** Opens the shared SQLite connection, applies the schema, and enables FK checks. */
function initializeDatabase(databasePath = config.databasePath) {
  if (database) return database;
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  database = new DatabaseSync(databasePath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const schema = fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8');
  database.exec(schema);
  const healthStateColumns = database.prepare('PRAGMA table_info(health_state)').all();
  if (!healthStateColumns.some((column) => column.name === 'consecutive_recovery')) {
    database.exec('ALTER TABLE health_state ADD COLUMN consecutive_recovery INTEGER NOT NULL DEFAULT 0');
  }
  return database;
}

function getDatabase() {
  if (!database) return initializeDatabase();
  return database;
}

/** Executes a parameterized statement and returns SQLite's change metadata. */
function run(sql, params = []) {
  try {
    return getDatabase().prepare(sql).run(...params);
  } catch (error) {
    logger.error({ event: 'database.operation.failed', errorName: error.name, errorCode: error.code });
    throw error;
  }
}

/** Returns the first matching row, or undefined. */
function get(sql, params = []) {
  try {
    return getDatabase().prepare(sql).get(...params);
  } catch (error) {
    logger.error({ event: 'database.operation.failed', errorName: error.name, errorCode: error.code });
    throw error;
  }
}

/** Returns all matching rows. SQL must be static; values belong in params. */
function all(sql, params = []) {
  try {
    return getDatabase().prepare(sql).all(...params);
  } catch (error) {
    logger.error({ event: 'database.operation.failed', errorName: error.name, errorCode: error.code });
    throw error;
  }
}

/**
 * Runs synchronous related writes atomically. The callback owns the work boundary;
 * this utility commits on success and rolls back then rethrows on failure.
 */
function transaction(callback) {
  const db = getDatabase();
  db.exec('BEGIN');
  try {
    const result = callback();
    if (result && typeof result.then === 'function') throw new TypeError('SQLite transaction callbacks must be synchronous');
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function isReady() {
  try {
    return Boolean(get('SELECT 1 AS ready')?.ready);
  } catch {
    return false;
  }
}

function closeDatabase() {
  if (database) {
    database.close();
    database = undefined;
  }
}

module.exports = { initializeDatabase, getDatabase, run, get, all, transaction, isReady, closeDatabase };
