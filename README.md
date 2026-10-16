# DeadlockZero

DeadlockZero is a full-stack TypeScript/Node.js + React Distributed Concurrency & Incident Forensics Workbench. It transforms lock traces, wait-for graphs, memory accesses, and connection-pool telemetry into explainable deadlock and race findings, automated canonical lock-ordering patches, 3 a.m. outage runbooks, and deterministic 500-worker before/after chaos replay benchmarks.

---

## Key Capabilities

- **Wait-For Graph (WFG) Engine (`src/engine/graph.ts`)**: Immutable-friendly, strongly typed graph model tracking execution nodes (threads/services), resource nodes (mutexes, row locks, connection pools), active acquisitions, and directed wait-for edges with timestamps and source-code references.
- **Tarjan's Strongly Connected Components (SCC) & Johnson's Elementary Cycle Deadlock Detector (`src/engine/deadlockDetector.ts`)**: Exact cycle decomposition and canonicalized hold-and-wait chain reconstruction with full source line attribution.
- **Lamport Vector Clock Race & Pool Starvation Verifier (`src/engine/raceDetector.ts`)**: Happens-before partial-order comparison across concurrent memory accesses (with lock-set intersection suppression) plus sustained connection-pool starvation episode analysis.
- **500-Worker Chaos Replay Simulator (`src/engine/simulator.ts`)**: Deterministic virtual-time simulation engine (`DEFAULT_WORKER_COUNT = 500`) that benchmarks throughput (req/s), latency percentiles (`p50`, `p95`, `p99`), deadlock counts, and dropped requests before and after applying the remediation patch.
- **Automated Lock-Ordering Patch & 3 a.m. Incident Runbook Generator (`src/engine/remediator.ts`)**: Emits unified git diffs enforcing canonical lock ordering or bounded resource controls alongside an actionable SRE incident response checklist.
- **Interactive Dark-Mode SRE War-Room Dashboard (`src/App.tsx`, `src/components/`)**: High-contrast React 19 + Tailwind CSS v4 operator interface with an interactive SVG lock-graph canvas, forensic evidence inspector, before/after replay bar, and custom JSON/log trace analyzer.

---

## System Architecture

```text
Browser (React 19 + Tailwind v4 SRE War-Room UI)
        │
        ├── GET  /api/health ────────┐
        ├── GET  /api/scenarios ─────┤
        ├── POST /api/analyze ───────┤
        └── POST /api/benchmark ─────┤
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
       5 Incident Presets → 500-Worker Simulator → Remediator & Runbook
                                     │
                                     ▼
                  JSON Forensic Payload + Static `dist/` Bundle
```

### Repository Structure

| Path | Responsibility |
| :--- | :--- |
| `src/engine/graph.ts` | Validated Wait-For Graph (WFG) data structures, acquisitions, wait edges, and JSON serialization |
| `src/engine/deadlockDetector.ts` | Tarjan's SCC decomposition, Johnson's elementary cycle enumeration, and hold-and-wait forensic chains |
| `src/engine/raceDetector.ts` | Lamport Vector Clock happens-before engine, data race detection, and connection-pool starvation detector |
| `src/engine/simulator.ts` | Deterministic 500-worker virtual-time chaos replay simulator (`before` vs. `after` patch) |
| `src/engine/remediator.ts` | Canonical lock-ordering patch generator, unified git diff builder, and 3 a.m. outage runbook generator |
| `src/scenarios/presets.ts` | Five deterministic production incident scenarios (AB-BA lock deadlock, distributed RPC cycle, inventory race, pool starvation, multi-lock cascade) |
| `src/server/app.ts` | Import-safe Express 5 application factory, custom trace/log parser, REST endpoints, and static bundle serving |
| `src/App.tsx` & `src/components/` | Interactive dark-mode SRE War-Room UI (`LockGraphCanvas`, `IncidentForensicsPanel`, `ReplayControlBar`, `CustomTraceModal`) |
| `tests/` | Offline Vitest unit, simulator, HTTP API integration, and clean-room Linux rebuild audit suites |

---

## How Detection Works

### 1. Tarjan's Strongly Connected Components (SCC) & Cycle Detection

DeadlockZero models lock contention by projecting every blocked acquisition into a directed wait-for edge `waiter -> holder` labeled with the contested resource and source location:

1. **Graph Normalization**: The detector snapshots and lexicographically sorts execution nodes, resource nodes, acquisitions, and wait-for edges so analysis is deterministic and free of caller-state mutation.
2. **Tarjan's SCC Pass (`O(V + E)`)**: A single depth-first search assigns discovery `index` and `lowLink` values to each execution vertex while maintaining an explicit DFS stack. Whenever `lowLink[v] === index[v]`, the subtree rooted at `v` is popped as a Strongly Connected Component. Any SCC with `|V| > 1` (or `|V| === 1` with a self-loop) is isolated as a deadlock region; acyclic wait chains are pruned immediately.
3. **Johnson's Elementary Cycle Extraction**: Within each cyclic SCC, Johnson's algorithm with blocked-vertex sets (`blocked` and `blockedMap`) enumerates every distinct elementary cycle without duplicate rotations. Each cycle is rotated to its lexicographically smallest vertex ID to produce a canonical signature.
4. **Forensic Attribution**: Every cycle hop is enriched with the waiting thread/service, holding thread/service, resource ID, acquisition timestamp, wait timestamp, and exact `file:line:column` source references.

### 2. Lamport Vector Clock Race & Pool Starvation Detection

Data race analysis tracks causality across threads using **Lamport Vector Clocks** (`VectorClock` in `src/engine/raceDetector.ts`):

1. **Clock Progression & Synchronization**: Each thread `t` maintains a vector `V_t: Map<ThreadId, number>`. Local memory events increment `V_t[t]`. Synchronization primitives (`acquire`/`release`, `fork`/`join`, and explicit `sync` barriers) merge clocks component-wise (`V_receiver[k] = max(V_receiver[k], V_sender[k])`).
2. **Happens-Before Partial Order (`hb`)**: Vector clock `A` happens-before `B` (`A < B`) iff `∀k: A[k] <= B[k]` and `∃k: A[k] < B[k]`. If neither `A < B` nor `B < A` holds (`A || B`), the two events are **concurrent**.
3. **Conflict & Lockset Filtering**: Two accesses to the same memory location form a data race when:
   - They originate from distinct threads (`threadA !== threadB`),
   - Their vector clocks are concurrent (`!(clockA < clockB) && !(clockB < clockA)`),
   - At least one access is a `write`, and
   - Their held lock sets at the moment of access are disjoint (`heldLocksA ∩ heldLocksB = ∅`).
4. **Connection-Pool Starvation**: Telemetry samples are scanned for contiguous windows where `inUse >= capacity` and `queued > 0`, reporting sustained starvation duration, peak queue depth, and offending call sites.

---

## Local Setup (Linux / macOS / Windows)

### Prerequisites

- **Node.js**: `22.19.0` (pinned in `.nvmrc`; `package.json` enforces `"node": ">=22.0.0"`)
- **npm**: Included with Node.js 22

### Exact Local Build & Run Command

From the repository root, copy the default environment file, install locked dependencies, build the backend and frontend, and start the production server:

```bash
cp .env.example .env && npm ci && npm run build && npm start
```

Or without copying `.env` (safe defaults are built in):

```bash
npm ci && npm run build && npm start
```

The server listens on `http://0.0.0.0:3000` (`http://localhost:3000`) by default and serves both the compiled React frontend (`dist/`) and the REST API:

- `GET /api/health` — Engine health status and detector metrics
- `GET /api/scenarios` — All 5 built-in production outage presets
- `POST /api/analyze` — Analyze a `presetId`, Wait-For Graph JSON, or custom lock/vector-clock trace
- `POST /api/benchmark` — Run the deterministic 500-worker before/after chaos simulation

---

## Running Tests (100% Offline)

Run the entire unit, detector, 500-worker simulator, Express API integration, and clean-room rebuild audit test suite with a single offline command:

```bash
npm test
```

---

## Docker Build & Run

The production `Dockerfile` is based on `node:22.19.0-bookworm-slim`. During the image build it copies the repository, installs dependencies via `npm ci`, runs `npm test` for build verification, compiles the backend and frontend (`npm run build`), exposes port `3000`, and starts the server with `npm start`.

Build and run the container with:

```bash
docker build -t deadlock-zero . && docker run --rm -p 3000:3000 --env-file .env.example deadlock-zero
```

Or with default container environment variables:

```bash
docker build -t deadlock-zero . && docker run -p 3000:3000 deadlock-zero
```

---

## Development Architecture Breakdown: 6 Engineering Milestones (OmniRush Sessions)

- **Milestone 1: Core Wait-For Graph (WFG) Data Structures & Runtime Pinning**
  Scaffolded the TypeScript/Node.js + Vite project, pinned Node `22.19.0` in `.nvmrc`, and implemented the `WaitForGraph` engine (`src/engine/graph.ts`) supporting execution nodes, lock/resource nodes, ownership acquisitions, directed wait-for edges, and unit tests (`tests/graph.test.ts`).
- **Milestone 2: Tarjan's SCC Deadlock Detector & Lamport Vector-Clock Race Verifier**
  Implemented Tarjan's Strongly Connected Components (SCC) and Johnson's elementary cycle finder (`src/engine/deadlockDetector.ts`) alongside the Lamport Vector Clock happens-before race detector and connection-pool starvation analyzer (`src/engine/raceDetector.ts`), verified by `tests/detectors.test.ts`.
- **Milestone 3: 500-Worker Chaos Simulator, Canonical Lock-Order Remediator & 5 Outage Scenarios**
  Authored five deterministic production outage presets (`src/scenarios/presets.ts`), built the 500-worker virtual-time chaos replay engine (`src/engine/simulator.ts`), and implemented automated canonical lock-ordering unified diff patches and 3 a.m. incident runbooks (`src/engine/remediator.ts`), verified by `tests/simulator.test.ts`.
- **Milestone 4: Express REST API & Custom Lock-Trace Parser**
  Built the import-safe Express 5 server and custom JSON/log lock-trace parser (`src/server/app.ts`, `src/server/index.ts`, `src/server.ts`) exposing `/api/health`, `/api/scenarios`, `/api/analyze`, and `/api/benchmark` with full HTTP integration coverage (`tests/api.test.ts`).
- **Milestone 5: Interactive Dark-Mode SRE War-Room Dashboard (React + Tailwind + SVG Graph)**
  Built the high-contrast React 19 + Tailwind CSS v4 operator workbench (`src/App.tsx`, `LockGraphCanvas.tsx`, `IncidentForensicsPanel.tsx`, `ReplayControlBar.tsx`, `CustomTraceModal.tsx`) for interactive cycle inspection, before/after throughput & latency comparison, and live custom trace analysis.
- **Milestone 6: Clean-Room Linux Dockerization & Automated Rebuild Audit**
  Packaged the application with a production `node:22.19.0-bookworm-slim` `Dockerfile`, `.dockerignore`, `.gitattributes` (`* text=auto eol=lf`), and `.env.example`, and added the automated offline clean-room rebuild audit suite (`tests/linux-rebuild-audit.test.ts`).
