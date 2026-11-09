# Conference Companion project notes

Conference Companion is a conference-management platform concept focused on helping attendees follow sessions and helping organizers understand event operations and outcomes.

## User specifications

- [Organizer specifications](ORGANIZER_SPECS.md): event setup, session operations, post-event insights, and capacity monitoring.
- [Speaker specifications](SPEAKER_SPECS.md): audience context, session delivery, service status, and follow-up.
- [Attendee specifications](ATTENDEE_SPECS.md): session discovery, live access, participation, and post-event use.

These documents describe candidate behavior and open questions. They are not yet a committed implementation scope. Features marked as later scope or candidate features need prioritization before development.

## Product direction to validate

The current leading direction is to make sessions easier to follow and revisit through live transcription and translation, then use attendee preferences and optional feedback to make the experience more relevant. The first release should validate a small end-to-end session workflow before adding conference-wide analytics, remote events, or personalized content feeds.

## Dash0 and operational capacity

Dash0 is intended for observability of the platform's own services. Technical operators can use it to see resource pressure and service behavior during an event. Organizers should receive a concise capacity/readiness view in the conference product when that helps them make event decisions; they do not automatically need direct access to Dash0.

Candidate measurements include CPU and memory (plus GPU where available), active streams, request rates, queue depth, transcription/translation latency, errors, and capacity headroom. These measurements can point to a bottleneck, but load balancing or scaling requires separate application and hosting behavior.

Keep personal and session content out of telemetry: do not send attendee names, registration responses, raw audio, transcript text, or identifiable searches. Decide what event-level aggregation is safe before using it in dashboards.

Dash0 references: [dashboards](https://www.dash0.com/docs/dash0/dashboards/about-dashboards), [metrics](https://www.dash0.com/docs/dash0/telemetry/metrics/about-metrics), and [Kubernetes metrics](https://www.dash0.com/docs/dash0/monitoring/kubernetes/kubernetes-metrics) when running on Kubernetes.

## Decisions needed before implementation scope is finalized

1. Which user journey must work in the hackathon prototype?
2. Is the first transcript generated live, from an uploaded recording, or both?
3. Which languages and number of concurrent sessions should the prototype support?
4. Who is the technical operator during an event, and which operational decisions should organizers be able to make?
5. What consent, publication, retention, and deletion rules apply to audio and transcripts?
6. Which post-event outcomes can be measured responsibly? Searches, attendance, and survey responses are engagement signals; they do not by themselves prove learning or retention.

## Candidate later features

- Floor maps and exhibitor placement informed by attendee interests.
- Remote watch parties, group chat, and richer streaming.
- Transcript search, session Q&A, personalized RSS/newsletter digests, and note-app exports.
- Speaker resources, attendee feedback, and opt-in speaker follow-up.
- Predictive room assignment and capacity planning.
