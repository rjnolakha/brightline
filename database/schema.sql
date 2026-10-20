PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  critical INTEGER NOT NULL DEFAULT 0 CHECK (critical IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL UNIQUE,
  integration_id TEXT NOT NULL REFERENCES integrations(id),
  occurred_at TEXT NOT NULL,
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status_code INTEGER,
  duration_ms REAL,
  outcome TEXT NOT NULL,
  error_category TEXT,
  error_code TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_integration_time ON request_logs(integration_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_time ON request_logs(occurred_at DESC);

CREATE TABLE IF NOT EXISTS health_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT NOT NULL REFERENCES integrations(id),
  evaluated_at TEXT NOT NULL,
  window_start TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN')),
  metrics_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_integration_time ON health_snapshots(integration_id, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS health_state (
  integration_id TEXT PRIMARY KEY REFERENCES integrations(id),
  consecutive_critical INTEGER NOT NULL DEFAULT 0,
  consecutive_recovery INTEGER NOT NULL DEFAULT 0,
  last_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  last_evaluated_at TEXT
);

CREATE TABLE IF NOT EXISTS health_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluated_at TEXT NOT NULL,
  succeeded INTEGER NOT NULL CHECK (succeeded IN (0, 1)),
  error_message TEXT
);
