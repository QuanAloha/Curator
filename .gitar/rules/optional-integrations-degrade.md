---
title: Optional integrations degrade gracefully
description: The app keeps working when Dash0, OpenAI, or Elasticsearch is not configured or is down.
type: check
when: The PR adds or changes code that calls OpenAI, Elasticsearch, Dash0/OTLP, or WhisperLive, or reads their environment variables (OPENAI_API_KEY, ELASTICSEARCH_URL, OTEL_*), in backend/app or frontend/src.
actions: Post an inline comment on each call that can crash or hang without the integration, and suggest a timeout and fallback. Fail the check if a core path (captions, transcript, polls, recording upload) depends on an optional integration.
---

# Optional integrations degrade gracefully

Dash0, OpenAI, and Elasticsearch are optional. Live captions and the transcript must work without them.

Check that each new or changed call:

- Has a timeout.
- Catches the integration's errors and falls back. Search falls back to PostgreSQL, AI features return a clear "not configured" or "unavailable" message, and telemetry becomes a no-op.
- Does not run at import or startup in a way that stops the API or worker from starting when the integration is missing.
- Keeps the API response shape the frontend expects, so frontend/src/App.tsx does not break.
