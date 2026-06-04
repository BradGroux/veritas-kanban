# Load Tests

Performance and load tests for the Veritas Kanban API using [k6](https://k6.io/).

## Prerequisites

### Install k6

**macOS (Homebrew):**

```bash
brew install k6
```

**Other platforms:**
See [k6 installation docs](https://grafana.com/docs/k6/latest/set-up/install-k6/).

### Verify installation

```bash
k6 version
```

### Start the server

```bash
# From repo root
pnpm dev
```

Server should be running at `http://localhost:3001`.

## Test Scenarios

| Script          | VUs  | Duration    | Description                                   |
| --------------- | ---- | ----------- | --------------------------------------------- |
| `smoke.js`      | 1    | 1 iteration | CRUD lifecycle — create, read, update, delete |
| `read-load.js`  | 50   | 30s         | Read-heavy: list + detail endpoints           |
| `write-load.js` | 20   | 30s         | Write-heavy: create, update, delete           |
| `mixed-load.js` | 0→30 | 60s         | 70% reads / 30% writes with ramp-up           |
| `ws-stress.js`  | 25   | 30s         | WebSocket connection stress                   |

## Running Tests

### Quick smoke test

```bash
pnpm test:load:smoke
# or directly:
k6 run load-tests/k6/smoke.js
```

### Run all load tests

```bash
pnpm test:load
```

Scheduled CI runs the k6 smoke profile weekly and can run the full profile by
manual dispatch. See
[`docs/testing/scheduled-qa-gates.md`](../docs/testing/scheduled-qa-gates.md)
for the scheduled/manual gate, artifact, and threshold contract.

### Run a specific scenario

```bash
k6 run load-tests/k6/read-load.js
k6 run load-tests/k6/write-load.js
k6 run load-tests/k6/mixed-load.js
k6 run load-tests/k6/ws-stress.js
```

### Override configuration via environment variables

```bash
# Custom server URL
k6 run -e BASE_URL=http://localhost:4000 load-tests/k6/smoke.js

# Custom API key
k6 run -e API_KEY=my-secret-key load-tests/k6/read-load.js

# Custom WebSocket URL
k6 run -e WS_URL=ws://localhost:4000/ws load-tests/k6/ws-stress.js
```

### Adjust VUs / duration on the fly

```bash
# Override VU count and duration
k6 run --vus 100 --duration 60s load-tests/k6/read-load.js
```

## Interpreting Results

After a run, k6 prints a summary like:

```
     ✓ list → 200
     ✓ detail → 200

     checks.....................: 100.00% ✓ 4820  ✗ 0
     http_req_duration..........: avg=12.3ms  min=2.1ms  med=10.5ms  max=95.2ms  p(90)=22.1ms  p(95)=31.4ms
     http_reqs..................: 4820    160.6/s
     errors.....................: 0.00%   ✓ 0     ✗ 4820
```

### Key metrics

| Metric                    | What it means                        | Target                        |
| ------------------------- | ------------------------------------ | ----------------------------- |
| `http_req_duration p(95)` | 95th percentile response time        | <200ms reads, <500ms writes   |
| `errors`                  | Percentage of failed checks          | <1%                           |
| `http_reqs`               | Total requests / requests per second | Higher = better throughput    |
| `checks`                  | Assertion pass rate                  | 100% for smoke, >99% for load |
| `ws_errors`               | WebSocket connection failure rate    | <5%                           |
| `ws_messages_received`    | Total WS messages received           | >0 per connection             |

### Thresholds

Tests define built-in thresholds. If a threshold is breached, k6 exits with code `99`:

- **Read-heavy:** p95 < 200ms, errors < 1%
- **Write-heavy:** p95 < 500ms, errors < 1%
- **Mixed:** p95 < 500ms, errors < 1%
- **WebSocket:** connection errors < 5%

### Export results (optional)

```bash
# JSON output
k6 run --out json=results.json load-tests/k6/read-load.js

# CSV output
k6 run --out csv=results.csv load-tests/k6/read-load.js
```

## File Structure

```
load-tests/
├── README.md          # This file
├── config.js          # Shared config (base URL, headers, helpers)
└── k6/
    ├── smoke.js       # Scenario 1: CRUD smoke test
    ├── read-load.js   # Scenario 2: Read-heavy load
    ├── write-load.js  # Scenario 3: Write-heavy load
    ├── mixed-load.js  # Scenario 4: Mixed workload
    └── ws-stress.js   # Scenario 5: WebSocket stress
```
