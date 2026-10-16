# DeadlockZero

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](./LICENSE)
[![Node.js >= 22](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-339933.svg)](./.nvmrc)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](./tsconfig.json)
[![Docker Ready](https://img.shields.io/badge/Docker-22.19.0--bookworm--slim-2496ED.svg)](./Dockerfile)

**DeadlockZero** is an open-source, full-stack TypeScript concurrency and outage forensics workbench. It ingests distributed lock traces and Lamport vector-clock telemetry from `.json` / `.jsonl` files or REST API payloads to construct Wait-For Graphs, detect circular lock deadlocks via Tarjan's Strongly Connected Components (SCC) algorithm, identify causal data races, generate canonical lock-ordering unified diffs and SRE triage runbooks, and run deterministic 500-worker before/after chaos simulations.

---

## Core Capabilities & Mathematical Architecture

```text
User Trace Input (.json / .jsonl Upload, Trace Editor, or POST /api/analyze)
                                     │
                                     ▼
                      Express 5 REST API (`src/server/`)
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
  Wait-For Graph           Deadlock Detector            Race & Pool Verifier
  (`graph.ts`)          (Tarjan SCC + Johnson)        (Lamport Vector Clocks)
        │                            │                            │
        └────────────────────────────┼────────────────────────────┘
                                     ▼
            500-Worker Chaos Simulator → Remediator & SRE Runbook
                                     │
                                     ▼
               Interactive SVG War-Room UI (`src/client/`)
```

### 1. Wait-For Graph (WFG) Construction (`src/engine/graph.ts`)
Processes chronological `LockEvent[]` streams into bipartite worker/resource graphs (`GraphNode[]`, `GraphEdge[]`) and projected worker-to-worker Wait-For adjacency lists (`Worker_A -> Worker_B` whenever `Worker_A` waits on a resource actively held by `Worker_B`).

### 2. Tarjan's $O(V + E)$ SCC & Johnson's Elementary Cycle Detection (`src/engine/deadlockDetector.ts`)
- **Tarjan's Algorithm**: Performs a single depth-first traversal assigning discovery `index` and `lowLink` values to isolate every non-trivial Strongly Connected Component (`|V| > 1` or self-loop) in $O(V + E)$ time, pruning acyclic wait chains immediately.
- **Johnson's Algorithm**: Enumerates every distinct elementary cycle within each cyclic SCC using blocked-vertex sets and canonicalizes cycle rotations so each deadlock cycle has a unique deterministic signature (`Worker_1 -> Lock_B -> Worker_2 -> Lock_A -> Worker_1`) mapped to exact `file:line` source locations.

### 3. Lamport Vector Clock Race & Pool Starvation Verifier (`src/engine/raceDetector.ts`)
- **Happens-Before Partial Order**: Compares vector clocks $V(e_1)$ and $V(e_2)$ across accesses to the same `resourceId` by distinct workers. When at least one event is a `WRITE` and neither clock dominates the other ($V(e_1) \not\prec V(e_2) \land V(e_2) \not\prec V(e_1)$) without a common protecting lock, a causal data race is reported.
- **Resource Pool Starvation**: Flags starvation episodes when $>80\%$ of active workers are blocked in `WAIT` on the same resource pool without release.

### 4. Automated Canonical Lock-Ordering Patch & 3 a.m. SRE Runbook (`src/engine/remediator.ts`)
Synthesizes unified git diffs enforcing total lexicographical lock acquisition order (`CANONICAL_LOCK_ORDER`) alongside an interactive Markdown incident triage checklist.

### 5. Deterministic 500-Worker Chaos Simulator (`src/engine/simulator.ts`)
Replays the ingested trace across 500 virtual workers (`runChaosBenchmark`) to compare **Before Patch** vs. **After Canonical Patch** throughput (`req/sec`), tail latency (`p50`, `p95`, `p99`), deadlock/race counts, and worker completion rate.

---

## `LockEvent` JSON Schema Specification

Both the web UI (`.json` / `.jsonl` drag-and-drop upload or Trace Editor) and the HTTP API (`POST /api/analyze`, `POST /api/benchmark`) accept a validated `LockEvent[]` payload:

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | Optional | Unique event identifier (defaults to `evt-{index}`) |
| `workerId` | `string` | **Yes** | Thread, worker, or microservice identifier (e.g. `"Worker_1"`) |
| `resourceId` | `string` | **Yes** | Lock, mutex, database row, or memory key (e.g. `"Account_A"`) |
| `action` | `'ACQUIRE' \| 'WAIT' \| 'RELEASE' \| 'READ' \| 'WRITE'` | **Yes** | Concurrency operation type |
| `timestamp` | `number` | Optional | Monotonic timestamp or logical millisecond offset |
| `vectorClock` | `Record<string, number>` | Optional | Lamport vector clock mapping worker IDs to integer ticks |
| `file` | `string` | Optional | Source file path (e.g. `"src/services/ledger.ts"`) |
| `line` | `number` | Optional | 1-based source line number |
| `codeSnippet` | `string` | Optional | Offending source code statement |

### Example `POST /api/analyze` Request

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "id": "evt-1",
        "workerId": "Worker_1",
        "resourceId": "Lock_A",
        "action": "ACQUIRE",
        "timestamp": 1001,
        "vectorClock": { "Worker_1": 1, "Worker_2": 0 },
        "file": "src/services/ledger.ts",
        "line": 41,
        "codeSnippet": "await tx.acquireRowLock(fromAccountId);"
      },
      {
        "id": "evt-2",
        "workerId": "Worker_2",
        "resourceId": "Lock_B",
        "action": "ACQUIRE",
        "timestamp": 1004,
        "vectorClock": { "Worker_1": 0, "Worker_2": 1 },
        "file": "src/services/ledger.ts",
        "line": 42,
        "codeSnippet": "await tx.acquireRowLock(fromAccountId);"
      },
      {
        "id": "evt-3",
        "workerId": "Worker_1",
        "resourceId": "Lock_B",
        "action": "WAIT",
        "timestamp": 1012,
        "vectorClock": { "Worker_1": 2, "Worker_2": 0 },
        "file": "src/services/ledger.ts",
        "line": 48,
        "codeSnippet": "await tx.acquireRowLock(toAccountId);"
      },
      {
        "id": "evt-4",
        "workerId": "Worker_2",
        "resourceId": "Lock_A",
        "action": "WAIT",
        "timestamp": 1015,
        "vectorClock": { "Worker_1": 0, "Worker_2": 2 },
        "file": "src/services/ledger.ts",
        "line": 49,
        "codeSnippet": "await tx.acquireRowLock(toAccountId);"
      }
    ]
  }'
```

---

## Local Setup & Development

### Requirements
- **Node.js**: `22.19.0` (pinned in `.nvmrc`)
- **npm**: Included with Node.js 22

### Build & Start (Production Mode)

```bash
cp .env.example .env && npm ci && npm run build && npm start
```

The server listens on `http://0.0.0.0:3000` (`http://localhost:3000`) by default.

### Run the Offline Test Suite

```bash
npm test
```

---

## Docker Deployment

Build and run the self-contained Linux container (`node:22.19.0-bookworm-slim`), which executes `npm ci`, `npm test`, and `npm run build` during image construction:

```bash
docker build -t deadlock-zero . && docker run --rm -p 3000:3000 --env-file .env.example deadlock-zero
```

---

## License

Released under the [MIT License](./LICENSE). See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.
