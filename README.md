# BRIGHTLINE HR Integration Health

A local operations dashboard and REST API that evaluates imported request records for five BRIGHTLINE HR service integrations. It uses Express, SQLite, React, and Vite; it does not call live vendors or require credentials. With definitions but no request records, health remains `UNKNOWN`.

## Architecture

The request path is `app.js → router → validator → DAO`. Routes handle HTTP concerns, Zod validators check request shape, and API-specific DAO modules own data access and health calculations. `src/helpers/DBUtils.js` owns reusable SQLite operations; `src/helpers/commonUtils.js` provides reusable outbound HTTP methods with timeouts, cancellation, correlation propagation, and safe telemetry. Inbound correlation context uses `AsyncLocalStorage` to isolate concurrent requests.

```text
app.js / server.js
  routers/ → validators/ → dao/
  helpers/ (SQLite, logging, correlation, HTTP, scheduler, errors)
database/schema.sql + database/seed.js
frontend/ (React + Vite)
scripts/importLogs.js
tests/{unit,integration}
```

## Requirements and setup

- Node.js 22.13 or later (Node.js LTS recommended), npm. The database adapter uses Node's built-in `node:sqlite` driver.
- No vendor service, database server, or API credentials are required.

Install both backend and frontend dependencies:

```sh
npm install
npm install --prefix frontend
```

Copy `.env.example` to `.env` to customize the port, local database path, log level, CORS origin, or window. Defaults work without an `.env` file. SQLite creates `data/health.sqlite` and the five integration definitions automatically when the backend starts; initialize/seeding can also be run explicitly:

```sh
npm run db:init
```

## Run

Development starts the API and Vite dashboard together:

```sh
npm run dev
```

Vite is served at `http://localhost:5173` and proxies `/api` to the Express API on port 3000. For the API alone:

```sh
npm start
```

Build the static dashboard and then run the API in production mode to serve it from Express:

```sh
npm run build
```

Set `NODE_ENV=production` before `npm start` to serve `frontend/dist`. Stop with Ctrl+C; the server stops the scheduler and closes SQLite cleanly.

## Import request logs

Input is a JSON array. Accepted field spellings include camelCase and common snake_case aliases (`integration_id`, `occurred_at`, `status_code`, `duration_ms`, `error_category`). Required fields are integration ID, parseable timestamp, method, endpoint, and source ID (or `id`; when absent, a deterministic key is formed from the event fields and array index). Optional fields include status, duration, outcome, error category/code, and correlation ID.

```sh
npm run import-logs -- --file ./path/to/request-logs.json
```

Example:

```json
[
  {
    "id": "payroll-request-0001",
    "integrationId": "payroll",
    "timestamp": "2026-10-19T12:00:00.000Z",
    "method": "POST",
    "endpoint": "/v1/payruns",
    "statusCode": 200,
    "durationMs": 184,
    "outcome": "success"
  }
]
```

Integration identifiers are `payroll`, `e-signature`, `ats`, `directory-sync`, and `notifications`. Import output reports processed, inserted, duplicate, and rejected record counts with rejection reasons. Re-imports with the same stable ID are ignored. Endpoint query strings are stripped and dynamic/unknown path segments are replaced with `:id` before persistence, preventing tokens or employee names from appearing in displayed endpoints. The importer never stores request bodies. Keep source files outside the public web root and avoid including employee/payroll data in fields.

### Generate synthetic traffic for a local demo

To populate the dashboard without actual vendor request logs, run the synthetic simulator in a second terminal while `npm run dev` is running:

```sh
npm run simulate-logs
```

It inserts one clearly marked synthetic health-check record per active integration each second, with randomized response times and a 97% success / 3% failure mix. It writes directly to the configured local SQLite database using the same validation and persistence path as imported logs. The first traffic batch appears immediately; each integration reaches the default 20-request sample size in about 20 seconds. Refresh the dashboard (or wait for its 30-second automatic refresh). Stop the simulator with Ctrl+C.

Adjust its pace, or insert just one batch:

```sh
npm run simulate-logs -- --interval-ms 3000
npm run simulate-logs -- --once
```

This simulator is for local demonstration and development only, refuses to run when `NODE_ENV=production`, and does not represent real customer/vendor traffic. For realistic operational health, import actual sanitized integration request logs instead. Synthetic samples remain in the same database and can affect its health results until that local database's logs are cleared.

## Health policy

Initial policy is in `config/healthPolicy.json`: 15-minute rolling window; 60-second scheduled reevaluation; warning/critical error rates of 2%/5%; warning/critical P95 latency of 1,000/2,000 ms; minimum sample size 20; two evaluations for ordinary critical threshold escalation and recovery; and a 5-minute request-data freshness limit. Payroll, e-signature, and directory sync are marked critical by default. These are initial assumptions, not universal service SLOs. The policy supports per-integration threshold and criticality overrides.

Error rate is failed requests divided by total requests. P95 uses the nearest-rank method (`ceil(0.95 × n)`, one-indexed) over present, non-negative latency observations; absent latency is not coerced to zero. Warning/critical boundaries are inclusive. `HTTP 5xx`, `429`, `401/403`, other `4xx`, timeout, and connection errors are separately categorized. A severe condition (at least five severe service/transport/auth failures and at least half of observations failing) can immediately mark a sufficiently sampled integration `UNHEALTHY`; ordinary critical rate/latency conditions require consecutive scheduler evaluations. Recovery from an unhealthy state requires two consecutive evaluations below warning thresholds to avoid status flapping.

No requests, stale observations, or insufficient volume produce `UNKNOWN`, not a green status. In a data-sparse state, a known critical unhealthy integration takes overall precedence, then uncertainty yields overall `UNKNOWN`, then any degraded/non-critical unhealthy integration yields `DEGRADED`. Overall status is a policy aggregation, never an average of labels. Historical snapshots are persisted during scheduled evaluations. The summary's `evaluatedAt` is the latest successful persisted evaluation; `evaluationStatus` indicates whether a newer failure record exists.

## API

Responses use `{ "data": ... }` on success and `{ "error": { "code", "message" } }` on failure. IDs and pagination are bounded and validated. The API returns safe, sanitized request-log metadata only.

| Method and path | Purpose |
| --- | --- |
| `GET /api/health/summary?windowMinutes=15` | Overall status, counts, attention list, integration metrics/reasons |
| `GET /api/health/live` | Process liveness |
| `GET /api/health/ready` | SQLite readiness |
| `GET /api/integrations` | Health and metrics for all active integrations |
| `GET /api/integrations/:id/health` | Health metrics and applicable thresholds for one integration |
| `GET /api/integrations/:id/logs?limit=50&offset=0` | Recent sanitized request records (maximum page size 200) |
| `GET /api/integrations/:id/history` | Persisted scheduled health snapshots |
| `GET /api/config/health-rules` | Current health policy |

All requests receive `X-Request-ID` and `X-Correlation-ID` response headers. Valid incoming `X-Request-ID`, `X-Correlation-ID`, and `X-Conversation-ID` values are accepted; invalid IDs are replaced or omitted. Correlation and conversation identifiers remain distinct. Use the outbound client methods `get`, `post`, `put`, `patch`, and `delete` from `src/helpers/commonUtils.js`; request bodies and auth headers are deliberately excluded from logs.

## Logging and security notes

Pino emits structured JSON containing timestamps, service/environment, direction, route/method, status, duration, request/correlation/conversation IDs, and outcome. Sensitive header/body fields are redacted; errors are logged with safe names/codes rather than raw messages. Logs are diagnostic and never contain imported HR payloads. Express responses do not expose stack traces in production. CORS defaults to the local Vite origin; configure `CORS_ORIGIN` for another trusted UI origin.

## Tests

```sh
npm test
npm run test:coverage
```

The suite uses an isolated temporary SQLite database and a controlled local HTTP server; no external vendor endpoint is called. `npm run build` validates the production frontend bundle.

## Troubleshooting

- **Dashboard cannot load API:** run the API on port 3000 or change the Vite proxy in `frontend/vite.config.js`.
- **SQLite cannot open its file:** make sure the configured database parent directory is writable.
- **Everything is `UNKNOWN`:** import recent request records for the known integration IDs; threshold evaluation requires the configured minimum volume.
- **No logs appear in the dashboard:** verify each imported endpoint record and inspect the import statistics. Records rejected by validation are reported and not inserted.
- **Port already in use:** set `PORT` in `.env`.

## Assumptions and limitations

The first implementation imports JSON arrays only; CSV and vendor-specific log formats are not inferred. Integration identity mappings are the five documented IDs. Source IDs provide reliable deduplication; generated IDs depend on source ordering and fields. Health snapshots are retained without a retention job. Policy is file-based and read-only at runtime. The scheduler persists evaluation snapshots and error state but does not include distributed locking or multi-process coordination; run one backend process per local database. An outbound utility is provided for future integrations, but no external service is polled or configured by default.
