---
title: Respect the speaker's publishing opt-out
description: Unpublished sessions must not expose media, transcript text, or search results to attendees.
type: check
when: The PR changes an endpoint, query, or UI path that serves session media, transcripts, translations, search results, or session Q&A to attendees — for example the /api/sessions/{id}/media, /transcript, /ask and /api/search handlers in backend/app/main.py, the Elasticsearch index, or the attendee view in frontend/src/App.tsx.
actions: Fail the check and post an inline comment showing the path that can leak unpublished content. Add the label "privacy".
---

# Respect the speaker's publishing opt-out

A speaker can uncheck "Publish this talk" (`publish_content = false`). The recording must still be kept for authorized processing, but attendees must not reach it.

Check that every attendee-facing path:

- Checks `publish_content` on the server before it returns media, transcript segments, translations, search hits, or AI answers. Hiding something in the frontend is not enough.
- Does not index unpublished transcript text in Elasticsearch, or filters it out at query time.
- Still lets the worker and speaker or organizer roles process and view the recording.

Flag the PR if a new or changed attendee path skips the check, or if it removes or weakens an existing check.
