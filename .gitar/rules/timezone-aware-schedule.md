---
title: Time-zone-aware schedule times
description: Session times are stored and compared with an explicit time zone.
type: check
when: The PR touches session start times or other schedule values — starts_at, datetime parsing or formatting in backend/app, timestamp columns in the database schema, or time formatting in frontend/src.
actions: Post an inline comment on each naive datetime and suggest the time-zone-aware equivalent. Fail the check if a naive value is written to the database.
---

# Time-zone-aware schedule times

Flag:

- `datetime.now()` or `datetime.utcnow()` without a time zone, and `datetime` values created without `tzinfo`, wherever they are stored or compared with stored times.
- Database columns for schedule times declared as `timestamp` instead of `timestamptz`.
- Code that treats a local wall-clock string as UTC without an explicit offset or zone.

Not in scope: media positions measured in seconds (`start_seconds` and `end_seconds` on transcript segments). Those are offsets into a recording, not clock times.
