---
title: Aggregate-only engagement data
description: Poll votes, ratings, interest answers and search queries must never be stored per attendee.
type: check
when: The PR changes how poll votes, session ratings/feedback, attendee interest answers, or transcript search queries are stored or processed — typically in backend/app/main.py, backend/app/db.py, database schema or migration SQL, or the vote/feedback/interest/search handlers in frontend/src/App.tsx.
actions: Fail the check and post an inline comment on each offending line explaining which data is now identifiable and how to keep it aggregate. Add the label "privacy".
---

# Aggregate-only engagement data

Curator promises attendees that their engagement is anonymous. Review the diff for any change that would let a vote, rating, interest answer, or search be traced back to a person.

Flag the PR if it:

- Adds a voter, respondent, or rater table, or any column that links a poll choice, rating, or interest to an attendee (user id, viewer token, session cookie, IP address, email, device id).
- Persists the raw text of an interest answer instead of the sanitized topic terms and their counts.
- Persists or logs identifiable search query text.
- Stores individual poll choices instead of incrementing a per-option counter.

Exceptions:

- The anonymous viewer heartbeat token (`viewer_token`) may be stored short-term for live viewer counts, as long as it is never joined to votes, ratings, interests, or searches and it expires.
- Aggregate counters, per-option totals, and per-topic counts are fine.
