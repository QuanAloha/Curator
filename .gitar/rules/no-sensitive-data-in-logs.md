---
title: No sensitive data in logs or telemetry
description: Logs, traces, metrics and error messages must not carry audio, transcript text, personal data, prompts or tokens.
type: check
when: The PR adds or changes logging, print statements, exception messages, OpenTelemetry spans, span attributes, metric labels, or Dash0 instrumentation — especially in backend/app/observability.py, backend/app/worker.py, backend/app/main.py, or console logging in frontend/src.
actions: Fail the check and post an inline comment on each line that could emit sensitive data, suggesting a safe alternative (an id, a count, a length, or a redacted value). Add the label "privacy".
---

# No sensitive data in logs or telemetry

Telemetry should describe how the system behaves, not what people said. Flag any new log line, span attribute, metric label, or error message that can contain:

- Raw audio bytes or audio chunks.
- Transcript or translation text, or speaker correction text.
- Attendee emails, phone numbers, names, or interest answers.
- Search query text.
- OpenAI prompts or completions.
- API keys, bearer tokens, OTLP headers, database URLs with passwords, or any other credential.

Also flag metric labels with high cardinality, such as attendee ids, viewer tokens, or transcript phrases.

Allowed: service names, environment, session and event ids, job ids, durations, sizes, counts, status codes, and model names.
