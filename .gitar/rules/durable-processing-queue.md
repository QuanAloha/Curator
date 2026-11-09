---
title: Durable, priority-ordered processing queue
description: Recording jobs are committed before they are acknowledged, survive restarts, and run by engagement priority then FIFO.
type: check
when: The PR changes how recording-processing jobs are created, claimed, ordered, or completed — the /api/sessions/{id}/jobs handler and processing_jobs queries in backend/app/main.py, or job handling in backend/app/worker.py.
actions: Fail the check and post an inline comment on the line that breaks durability or ordering.
---

# Durable, priority-ordered processing queue

Flag the PR if:

- The API returns "queued" (or the UI says it is) before the job row is committed to PostgreSQL.
- Job state lives only in memory, so an API or worker restart loses queued or in-progress jobs.
- A job a crashed worker claimed can never be picked up again.
- Claiming jobs does not order by priority (highest engagement first) and then `created_at` (oldest first) within the same priority.
- Two workers can claim the same job. Look for missing `FOR UPDATE SKIP LOCKED` or an equivalent.
