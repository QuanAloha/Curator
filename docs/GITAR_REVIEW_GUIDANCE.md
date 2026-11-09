# Gitar review guidance

Connect Gitar to the GitHub repository after installing its GitHub App. The repository CI workflow builds the React frontend and checks that the FastAPI application compiles. Gitar can review pull requests and validate requested fixes against that workflow. Maintainers remain responsible for approving changes.

Use these repository conventions as review guidance:

## Product and privacy

- Never persist individual poll choices, attendee ratings, raw interest answers, or identifiable search text. Keep aggregate counts or sanitized topic terms only.
- Do not log raw audio, transcript text, emails, phone numbers, OpenAI prompts, or API tokens.
- A speaker can opt out of publishing a session. Keep the source recording available to authorized processing, but do not expose unpublished media or transcript content to the attendee view.
- Keep transcript corrections attributed as speaker edits and apply them only after the configured review step.

## Correctness

- Store and display schedule values with time-zone-aware timestamps. Do not treat a local wall-clock time as UTC without an explicit zone.
- Keep the original-language transcript available if a translation fails or falls behind.
- Preserve recording-processing jobs across API/worker restarts; do not acknowledge a recording as queued before the job is committed to PostgreSQL.
- Order queued session work by engagement priority, then FIFO within equal priority.
- Keep poll response data aggregate-only; do not add a voter table or attendee identifier to a vote.
- Preserve API/frontend compatibility and handle missing optional integrations such as Dash0, OpenAI, or Elasticsearch gracefully.

## Pull request expectations

- Include the user-visible behavior and any privacy or data-retention implications in the PR description.
- Keep secrets in environment variables or a secret manager, never in Compose defaults, manifests, or source.
- Prefer focused changes that preserve local Docker Compose as the default development path.
