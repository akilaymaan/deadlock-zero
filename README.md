# DeadlockZero

DeadlockZero is a full-stack TypeScript/Node.js + React (Vite) workbench for
distributed concurrency analysis and incident forensics.

## Requirements

- Node.js `22.19.0`
- npm

## Development

```bash
npm install
npm run dev
```

Run the Express API and production frontend server separately:

```bash
npm run dev:server
```

The server listens on `http://localhost:3000` by default, or on `process.env.PORT`.
After `npm run build`, it serves the Vite production build at `/` and exposes:

- `GET /api/health` — engine status and detector metrics.
- `GET /api/scenarios` — the five built-in outage scenarios.
- `POST /api/analyze` — analyze a preset ID or custom lock-event JSON/log trace.
- `POST /api/benchmark` — compare the 500-worker before/after replay.

The API app factory is exported from `src/server/` for integration tests and other
Node.js consumers.

## Checks

```bash
npm test
npm run build
```
