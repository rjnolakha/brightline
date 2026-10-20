# BRIGHTLINE HR Integration Health
## Customer demo and technical implementation walkthrough

**Purpose:** Explain the problem, the implemented solution, how the major parts work together, the health rules and assumptions, and how to demonstrate the application locally.

> **Demo-data notice:** The local traffic simulator creates synthetic observations. Those records are for demonstrating the software and are not measurements of BRIGHTLINE HR production systems or customer activity.

## 1. Problem statement

BRIGHTLINE HR depends on five external-service categories: payroll, e-signature, applicant tracking (ATS), directory synchronization, and notifications. Without centralized visibility into requests to those services, support teams may discover problems only after customers report them.

The monitoring application answers operational questions from stored request observations:

- What is the current platform status?
- Which integrations need attention, and why?
- How many recent requests failed?
- Are response times elevated?
- When was the last request and successful request?
- Is the request data recent enough to trust?
- When was health last evaluated, and did the latest evaluation succeed?

The application measures the request records it receives. It does not connect to external providers or infer service health in the absence of evidence.

## 2. Solution overview

The project contains a local Express API, a persistent SQLite database, a periodic health evaluator, a JSON request-log importer, an optional synthetic traffic generator for demonstrations, and a React/Vite operations dashboard.

```text
Request-log JSON ──> importer ─────┐
                                   ├──> validation ──> SQLite request_logs
Synthetic demo traffic ───────────┘                         │
                                                           ├──> health DAO / policy
                                                           │        ├──> REST API
60-second scheduler ──> health evaluation ──> snapshots ──┘          │
                                                                      v
                                                               React dashboard
```

It runs locally without paid cloud products, vendor credentials, or live calls to integration providers. Data is persisted in the configured SQLite file.

## 3. Project structure

```text
api-integration-health/
├── app.js                         # Express setup; imports and mounts middleware/routes
├── server.js                      # Network listener, scheduler start, graceful shutdown
├── package.json                   # Root scripts and backend/test dependencies
├── .env.example                   # Documented local runtime settings
├── README.md                      # Setup and operator reference
├── TECHNICAL-WALKTHROUGH.md       # This customer/demo-oriented guide
├── config/
│   ├── appConfig.js               # Validated environment configuration
│   └── healthPolicy.json          # Initial thresholds, freshness and criticality
├── database/
│   ├── schema.sql                 # Tables, constraints and indexes
│   └── seed.js                    # Five integration definitions
├── scripts/
│   ├── importLogs.js              # JSON file import command
│   └── simulateLogs.js            # Development-only synthetic traffic generator
├── src/
│   ├── routers/                   # HTTP routes and response mapping
│   ├── validators/                # Zod input-shape validation
│   ├── dao/                       # Data access and all health/business calculations
│   └── helpers/                   # SQLite, HTTP, logs, request context, scheduler, errors
├── frontend/
│   ├── package.json               # Dashboard dependencies and Vite scripts
│   └── src/
│       ├── App.jsx                # Dashboard state, refresh and selection
│       ├── api/apiClient.js       # Browser calls to the backend
│       ├── components/            # Overview, table, details and metric components
│       └── styles/styles.css      # Responsive, accessible visual styling
└── tests/
    ├── unit/                      # HTTP utility, logger, simulator tests
    └── integration/               # API, health engine, SQLite and scheduler tests
```

## 4. Architecture and request lifecycle

### Backend responsibilities

The API follows the project requirement `app.js → router → validator → DAO`:

1. **`app.js`** initializes the database and integration definitions, configures Express and middleware, mounts API routers, and (in production mode) serves the built dashboard. Importing it for tests does not open a network listener.
2. **Routers** translate HTTP requests into endpoint-specific DAO calls and consistent JSON responses.
3. **Validators** use Zod to validate query parameters, integration IDs, pagination, and normalized imported records. They check input shape; they do not decide service health.
4. **DAOs** execute parameterized SQL and own the business logic, including metric calculation, status decisions, aggregation, and import orchestration.
5. **`server.js`** binds the port, starts the periodic evaluator once the server is listening, and handles shutdown signals.

### Database

`src/helpers/DBUtils.js` wraps Node.js's built-in `node:sqlite` synchronous SQLite driver. It owns connection initialization, schema setup, parameterized `run`/`get`/`all` operations, transactions, readiness checks, and connection closure. Database writes that form one logical operation use a transaction; errors roll back and propagate.

Tables:

| Table | Role |
| --- | --- |
| `integrations` | The five configured services and criticality definitions |
| `request_logs` | Sanitized request observations used for metrics |
| `health_snapshots` | Persisted per-integration results from scheduled evaluations |
| `health_state` | Consecutive critical and recovery evaluation counters |
| `health_evaluations` | Latest successful evaluations and recorded evaluation failures |

Indexes support time-window queries, history retrieval, and the integration/time lookup path. Foreign keys ensure a request cannot refer to an undefined integration.

### Request IDs and logs

`correlationContext.js` uses `AsyncLocalStorage` so concurrent inbound requests do not share request context. It accepts validated `X-Request-ID`, `X-Correlation-ID`, and `X-Conversation-ID` headers, creates identifiers when needed, and returns request/correlation IDs to the caller. Conversation IDs remain separate from correlation IDs.

Pino emits structured JSON for completed inbound requests, outbound HTTP requests, and database/evaluation failures. Request and response times, duration, method, path, status, outcome, and safe IDs are captured. Request and response bodies, authorization/cookie headers, and sensitive fields are excluded or redacted. Stored request endpoints have their query string removed and unknown/dynamic path segments reduced to `:id`.

`commonUtils.js` provides reusable `get`, `post`, `put`, `patch`, `delete`, and `request` functions for future provider integrations. It propagates correlation IDs, supports JSON bodies and query parameters, implements abortable timeouts, returns consistent responses, classifies HTTP/network/timeout errors, and logs sanitized outbound telemetry. It does not make vendor calls by default.

## 5. Data and health calculations

### What counts as an observation

Each request record has an integration ID, timestamp, HTTP method, and endpoint, with optional status code, elapsed milliseconds, outcome, error classification/code, correlation ID, and stable source ID. Import validation checks record shape and rejects invalid records with a reason. Duplicate source IDs are ignored. The importer reports processed, inserted, duplicate, and rejected counts.

### Per-integration metrics

The health DAO considers records in a configurable rolling time window (15 minutes by default). It calculates:

- Total, successful, and failed requests.
- Error rate: `failed requests / total requests × 100`.
- Average, P95, and maximum latency from valid, present latency observations.
- Last observed request and last successful request timestamps.
- Last successful evaluation timestamp and freshness classification.
- Failure counts by HTTP status and error category.

P95 uses the **nearest-rank percentile**: sort the observations and select the value at one-based index `ceil(0.95 × n)`. Missing latency is omitted—not treated as zero. If there are no requests, error rate and latency metrics are `null`.

Errors are grouped deliberately:

| Observation | Category |
| --- | --- |
| HTTP 5xx | `service_error` |
| HTTP 429 | `rate_limit` |
| HTTP 401/403 | `authentication` |
| HTTP 400 | `input_error` |
| Other HTTP 4xx | `client_error` |
| Timed-out outbound call | `timeout` |
| Connection/network failure | `connection` |

An explicitly imported error category takes precedence over category inference from the response code.

### Status rules

The four service statuses are `HEALTHY`, `DEGRADED`, `UNHEALTHY`, and `UNKNOWN`.

- `UNKNOWN`: no recent records, stale observations, or fewer than the configured minimum number of requests. These cases do not claim the integration is healthy or unhealthy.
- `HEALTHY`: there is enough fresh evidence and measured thresholds are below their warning boundaries.
- `DEGRADED`: warning boundaries are met/exceeded, an ordinary critical threshold is seen for only one persisted evaluation, or a recovery is still being confirmed.
- `UNHEALTHY`: an ordinary critical threshold persists for the required consecutive evaluations, or a sufficiently sampled severe-failure condition triggers the immediate escalation rule.

Threshold comparisons are inclusive. The default minimum is 20 requests; the default error-rate warning/critical thresholds are 2%/5%; the default P95 latency warning/critical thresholds are 1,000/2,000 ms. Ordinary critical breaches require two consecutive persisted scheduler evaluations before escalation. Recovery from an unhealthy status requires two consecutive evaluations below warning thresholds to reduce status flapping.

The immediate severe-failure path requires at least five `service_error`, `timeout`, `connection`, or `authentication` failures and at least half of the observations to be such failures. As with other threshold rules, it is evaluated after minimum sample-volume and freshness checks.

Thresholds and integration criticality are held in `config/healthPolicy.json`. The health evaluator combines the top-level defaults with a per-integration policy override. The default critical integrations are payroll, e-signature, and directory sync.

### Platform aggregation

The overall platform status is policy-based; it is not an average or numerical score:

1. A critical integration that is `UNHEALTHY` makes the platform `UNHEALTHY`.
2. If there is uncertainty (`UNKNOWN`) and no critical unhealthy integration, overall status is `UNKNOWN`.
3. Otherwise, any non-healthy integration, including a non-critical unhealthy one, makes the platform `DEGRADED`.
4. It is `HEALTHY` only if every active integration is sufficiently evidenced, fresh, and healthy.

The summary includes counts for each status, an attention list with per-integration reasons, the latest successful evaluation timestamp, and an evaluation indicator. The periodic evaluator stores per-integration snapshots and records evaluation failures. Health history is available through the API.

## 6. Scheduler and dashboard

The scheduler starts with the server and evaluates health every 60 seconds by default. It persists snapshots, avoids overlapping scheduled runs, records failures without terminating the process, and is stopped during graceful shutdown. The same evaluation code is directly callable by tests without waiting for a timer.

The React dashboard calls the backend APIs; it does not hardcode health metrics. It displays:

- Overall platform status and the last successful evaluation time.
- Counts for healthy, degraded, unhealthy, and unknown integrations.
- Per-integration request count, error rate, P95, most recent request, freshness, and main reason.
- A detail panel with more metrics, current thresholds, failure categories, recent sanitized logs, and available health snapshots.
- Manual refresh, 30-second auto-refresh, loading, API error, and stale/evaluation-failure indications.

Status text accompanies visual indicators so colour is not the only status cue. Layout adapts for smaller screens.

## 7. API endpoints

| Endpoint | Use |
| --- | --- |
| `GET /api/health/summary?windowMinutes=15` | Platform status, status counts, attention list, metrics and reasons |
| `GET /api/health/live` | Process liveness check |
| `GET /api/health/ready` | SQLite readiness check |
| `GET /api/integrations` | Current status/metrics for active integrations |
| `GET /api/integrations/:id/health` | Current detail and the integration's applicable policy |
| `GET /api/integrations/:id/logs?limit=50&offset=0` | Bounded page of sanitized request logs; maximum page size 200 |
| `GET /api/integrations/:id/history` | Stored health snapshots |
| `GET /api/config/health-rules` | Current read-only policy document |

Successful responses use `{ "data": ... }`; errors use `{ "error": { "code": "...", "message": "..." } }`. API inputs are validated and SQL values are parameterized.

## 8. Assumptions and limitations

These defaults make a runnable initial implementation; they should be reviewed with service owners before use as production SLOs or customer commitments.

1. **Policy values are starting assumptions.** The 15-minute window, two-minute latency boundaries, 2%/5% error-rate boundaries, 20-request minimum, five-minute freshness limit, criticality assignments, and recovery/escalation counts are not universal thresholds.
2. **There is no vendor polling.** The application only analyzes logs it is given. Production integration teams would need to emit/import sanitized request records or wire the outbound client into real provider calls.
3. **The first importer accepts JSON arrays.** CSV parsing and vendor-specific formats are not included.
4. **Identity mapping is explicit.** Input integration IDs must match `payroll`, `e-signature`, `ats`, `directory-sync`, or `notifications`.
5. **A local database is assumed.** The default is one SQLite file and one backend process. The scheduler has no distributed lock for multi-process operation.
6. **Policy is file-based and read-only at runtime.** There is no policy editor or authentication/authorization layer for administration.
7. **Snapshot retention is not automated.** A production deployment should define retention, backup, access control, and operational procedures.
8. **Synthetic traffic is not evidence of actual health.** Do not mix demo traffic into production or customer reporting; it remains in the local request table until that local dataset is cleaned.
9. **Inbound application logs are in the process log stream.** The database stores imported/outbound service request observations and health snapshots, not a general durable inbound HTTP log archive.

## 9. Customer demo walkthrough

### Prepare the environment

Install backend and frontend dependencies once:

```bash
npm install
npm install --prefix frontend
```

Start the API and dashboard in terminal one:

```bash
npm run dev
```

Open `http://localhost:5173`. Initially, integrations show `UNKNOWN`, because the seeded database contains definitions but no request evidence. This is intentional.

### Populate clearly labeled demo observations

In terminal two, from the project directory:

```bash
npm run simulate-logs
```

The simulator creates five synthetic observations immediately and five more each second, one for every active integration. Wait roughly 20 seconds for the minimum request volume; the dashboard itself refreshes every 30 seconds, or use the manual refresh control. Stop generation with Ctrl+C.

The simulator produces a nominal 97% success / 3% failure distribution and randomized response times. A short demonstration may or may not happen to include a failure because samples are randomized. The generated failures are marked with synthetic error codes and should be described to the customer as demo data, not live service incidents.

Alternatively, use one batch only:

```bash
npm run simulate-logs -- --once
```

This still yields fewer than 20 records per integration, so status remains `UNKNOWN` until more recent demo requests are produced.

### Demonstrate importing actual sanitized data

For an integration team log sample:

```bash
npm run import-logs -- --file ./path/to/request-logs.json
```

Check importer output for rejected/duplicate counts, then refresh the dashboard. Use only approved, sanitized logs and keep any employee/payroll payload out of the input. The endpoint path is sanitized before storage; request bodies are not imported.

### Demonstrate the API and tests

```bash
curl http://localhost:3000/api/health/summary
curl http://localhost:3000/api/health/ready
npm test
npm run build
```

The test suite uses temporary databases and a controlled local HTTP server rather than external APIs.

## 10. Production-readiness discussion

The application is a runnable local monitoring prototype and a basis for a production design discussion, not a complete production deployment. A production rollout should additionally decide authentication/authorization, secrets and vendor credential management, deployment topology, durable ingestion/queueing, database scaling and backups, retention, monitoring of the monitoring service, per-integration SLOs, incident workflow, and traffic-volume expectations. Synthetic traffic generation is explicitly blocked when `NODE_ENV=production`.
