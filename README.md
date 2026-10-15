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

Run the minimal Node.js health endpoint separately:

```bash
npm run dev:server
```

The health endpoint is available at `http://localhost:3000/health`.

## Checks

```bash
npm test
npm run build
```
