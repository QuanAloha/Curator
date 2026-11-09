---
title: PR description covers behavior and privacy
description: Every PR explains what users will see and any privacy or data-retention impact.
type: check
when: A pull request is opened, or its title or description changes.
actions: If the description is missing either section, add the label "needs-description" and post one comment listing what is missing. Remove the label once both are present.
---

# PR description covers behavior and privacy

The PR description should include:

1. **User-visible behavior**: what attendees, speakers, or organizers will notice. Write "None" for internal-only changes.
2. **Privacy and data retention**: whether the change stores, logs, sends, or deletes any attendee, speaker, transcript, or media data. Write "None" if it does not.

Exceptions: PRs that only change documentation, or only the automated `deploy: <sha> [skip ci]` image-tag commits, do not need these sections.
