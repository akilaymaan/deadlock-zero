# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

## [0.2.0] - 2026-10-16

First public release.

### Changed

- **Breaking:** the stress-test simulator is now a real deterministic, virtual-time lock-scheduling simulation of the submitted trace. Earlier development builds returned numbers derived from a hash of the trace within fixed ranges; those results were not measurements and should be disregarded.
- **Breaking:** `POST /api/analyze` and `POST /api/benchmark` accept only `{ events: LockEvent[] }` (plus `sourceCode`, `workers`, `requestsPerWorker`, `seed`). Response shapes were simplified; see the README.
- **Breaking:** built-in demo scenarios and `GET /api/scenarios` were removed. The UI starts empty.
- Remediation is derived from the trace (observed vs. canonical lock order per worker, implicated source lines) and produces a well-formed unified diff. It is labelled as a generated suggestion.
- The server is compiled to `dist/server` and started with `node dist/server/index.js`; the UI builds to `dist/client`.
- Events are processed in timestamp order everywhere.

### Added

- Configuration validation with fail-fast startup errors, `.env` loading, structured JSON logging, request IDs, `/api/ready`, graceful shutdown.
- Security headers (CSP, `X-Frame-Options`, `nosniff`, and others), opt-in CORS allow-list, per-client rate limiting, body/event/worker limits, and a CPU budget per simulation run.
- Multi-stage, non-root Docker image with a health check; GitHub Actions CI.
- Tests for the simulator, API error paths and limits, configuration, client trace parsing, and repository hygiene.
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates.

### Removed

- Legacy demo UI components and stylesheets, unused PostCSS/Autoprefixer/Tailwind config files, and `tsconfig.server.json`.

### Security

- Upgraded Vitest to 4.1.11 to resolve GHSA-82fw-gwwq-j7x9 (moderate) and the Tinypool advisories GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr (critical, development-only).
