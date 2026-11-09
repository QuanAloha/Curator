---
title: Original-language transcript survives translation failures
description: A failed or slow translation must never hide or block the original-language captions.
type: check
when: The PR changes live captioning, translation, or transcript storage — the /translate and /segments handlers, the worker's translation step, the WhisperLive socket handling, or the transcript feed in frontend/src/App.tsx.
actions: Fail the check and post an inline comment describing the failure path that loses or blocks the original captions.
---

# Original-language transcript survives translation failures

Live captions in the talk's own language come first. Translation is extra.

Flag the PR if:

- The original-language segment is saved only after translation succeeds, or is skipped when translation throws.
- A translation timeout or error stops the live caption socket, the processing job, or the feed.
- A translation failure is swallowed with no signal to the attendee. The feed should show an outage line, and the original language should stay one tap away.
- The enhanced processing job is marked failed as a whole when only one target language failed.
