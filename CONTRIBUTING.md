# Contributing to DeadlockZero

Thanks for helping. This guide covers setup, conventions, and what a pull request needs to be merged. By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Setup

- Node.js 22 (`.nvmrc` pins `22.19.0`; `nvm use` picks it up) and npm.

```bash
npm ci
npm run dev:server   # API on http://localhost:3000 (reloads on change)
npm run dev          # UI on http://localhost:5173 (proxies /api)
```

No database, API keys, or external services are needed.

## Project layout

| Path | Contents |
| --- | --- |
| `src/shared/` | Types and trace validation used by both the browser and the server |
| `src/engine/` | Pure analysis: graph, detectors, remediation, simulator. No I/O. |
| `src/server/` | Express app, configuration, logging, entry point |
| `src/client/` | React UI; `lib/` holds DOM-free logic that is unit tested |
| `tests/` | Vitest suites; `tests/fixtures/traces.ts` holds test-only traces |

Keep `src/engine` free of Node- or browser-specific APIs; it runs in both.

## Workflow

1. Open an issue first for anything beyond a small fix, so the approach can be agreed.
2. Branch from `main` using a descriptive name: `fix/<short-description>`, `feat/<short-description>`, `docs/<short-description>`.
3. Write commits in [Conventional Commits](https://www.conventionalcommits.org/) style (`feat(engine): ...`, `fix(server): ...`, `docs: ...`), as the existing history does.
4. Before pushing, run:

```bash
npm run typecheck
npm test
npm run build
```

CI runs the same commands plus a production dependency audit on every push and pull request.

## Coding standards

- TypeScript `strict` with no unused locals or parameters. Avoid `any`; validate untrusted input at the boundary (`src/shared/traceValidation.ts`).
- No demo data, mock fallbacks, or fabricated metrics in `src/`. If something cannot be computed, return an explicit error. The repository hygiene test enforces part of this.
- Results must be deterministic for a given input; seed any randomness.
- Never log request bodies or trace contents.
- Add or update tests for every behavior change. Engine changes need unit tests; API changes need integration tests in `tests/api.test.ts`.
- Update `README.md` when you change the trace format, API, configuration, or commands, and add an entry under `[Unreleased]` in `CHANGELOG.md`.

## Pull requests

Fill in the pull request template. A PR is ready to merge when CI is green, it has tests, docs are updated, and a maintainer has approved it.

## Reporting bugs and security issues

Use the bug report template for bugs, and include a minimal trace that reproduces the problem (remove anything sensitive first). Report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md), not in public issues.
