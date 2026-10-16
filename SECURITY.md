# Security Policy

## Supported versions

DeadlockZero is pre-1.0. Security fixes are made on the `main` branch and included in the next release.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately using GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Include:

- the affected version or commit;
- steps or a request/trace that reproduces the issue;
- the impact you observed or expect.

You should receive an acknowledgement within 7 days. We will keep you informed while we investigate, agree on a disclosure date with you, and credit you in the release notes unless you prefer otherwise.

## Scope and deployment notes

- The server has **no authentication**. Exposing it publicly without an authenticating proxy is a deployment decision, not a vulnerability, but denial-of-service paths that bypass the documented limits (`MAX_TRACE_EVENTS`, `BODY_LIMIT_BYTES`, simulation budgets, rate limiting) are in scope.
- Traces may contain sensitive identifiers. The server does not store or log them, and the web UI analyzes them in the browser except for the stress test.
- Never put real secrets in `.env.example` or commit a `.env` file.
