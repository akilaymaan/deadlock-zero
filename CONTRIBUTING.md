# Contributing to DeadlockZero

Thank you for contributing to **DeadlockZero**! This guide covers local development setup, running the offline verification suite, and the `LockEvent` trace ingestion schema.

---

## Local Development Setup

### Prerequisites
- **Node.js**: `22.19.0` (pinned in `.nvmrc`; `package.json` enforces `"node": ">=22.0.0"`)
- **npm**: v10+

### Install & Run

```bash
cp .env.example .env
npm ci
npm run build
npm start
```

For hot-reload development across the React frontend and Express API:

```bash
# Terminal 1: Express API server on port 3000
npm run dev:server

# Terminal 2: Vite frontend dev server on port 5173 (proxies /api -> localhost:3000)
npm run dev
```

---

## Running Tests

All unit, graph, detector, simulator, API integration, and repository hygiene tests run 100% offline with a single command:

```bash
npm test
```

TypeScript typechecking and production bundle verification:

```bash
npm run build
```

---

## `LockEvent` Ingestion Schema

DeadlockZero ingests arrays of `LockEvent` objects (via `.json` / `.jsonl` file upload, the UI Trace Editor, or `POST /api/analyze` and `POST /api/benchmark`):

```ts
export type LockAction = 'ACQUIRE' | 'WAIT' | 'RELEASE' | 'READ' | 'WRITE';

export interface LockEvent {
  id: string;
  workerId: string;
  resourceId: string;
  action: LockAction;
  timestamp: number;
  vectorClock: Record<string, number>;
  file: string;
  line: number;
  codeSnippet: string;
}
```

### Pull Request Checklist
1. Ensure `npm test` and `npm run build` pass with zero errors.
2. Add or update unit/API tests in `tests/` for new detection or remediation capabilities.
3. Never commit secrets, API tokens, or hardcoded host filesystem paths.
