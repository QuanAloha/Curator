---
title: Speaker transcript edits are reviewed and attributed
description: Speaker corrections are applied only after the review step and stay marked as speaker edits.
type: check
when: The PR changes the speaker-edit flow — the /api/segments/{id}/speaker-edit handler, the edited_by_speaker or edit_review_status columns, or the transcript correction UI in frontend/src/App.tsx.
actions: Fail the check and post an inline comment explaining which guarantee is broken.
---

# Speaker transcript edits are reviewed and attributed

Speaker corrections change what attendees read, so they need a clear history.

Flag the PR if it:

- Writes corrected text to a transcript segment before the configured review step approves it.
- Drops or stops setting `edited_by_speaker` or `edit_review_status` on a corrected segment.
- Removes the "edited by speaker" marker from the attendee feed.
- Overwrites the original text so that the edit can no longer be traced.
