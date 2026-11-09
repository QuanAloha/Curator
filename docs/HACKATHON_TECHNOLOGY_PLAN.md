# Hackathon technology plan

This document maps the technologies featured by the [Cloud Native Hackathon](https://www.wemakedevs.org/hackathons/cnh) to Conference Companion. It is a technology-fit proposal, not a final product scope.

The event page describes tracks for Sonar/Gitar, Dash0, Radar, and Elasticsearch, and OpenAI credits for participants. It emphasizes using a tool as part of the product or development workflow, rather than adding it only for a demo.

## Project context

The current local starter uses Docker Compose with:

- React frontend served by Nginx;
- FastAPI backend;
- PostgreSQL;
- WhisperLive for speech transcription; and
- LibreTranslate for translation.

The starter does not yet include Dash0 instrumentation, Gitar's GitHub App, Radar/Kubernetes, Elasticsearch, or OpenAI calls. Add those when their corresponding workflows are designed. Keep PostgreSQL as the transactional source of truth unless a later design decision changes that role.

## Technology fit by project role

### Organizers

**Dash0 — primary operational tool.** Give authorized technical operators a live view of service health, capacity, and performance during an event and of background processing after it. Organizers should receive concise, session-level readiness and capacity guidance in Conference Companion. Direct access to Dash0 is optional and should be restricted to trained users with an appropriate role.

Useful operational questions include:

- Are transcription and translation running for each active session?
- How long does speech take to become a displayed transcript, and how much additional time does translation add?
- Are connections dropping, errors increasing, or processing queues growing?
- Which service or deployment is consuming CPU, memory, GPU, or network capacity?
- After the event, how quickly are summaries, indexing, and other queued jobs completing?

**Elasticsearch — event and session discovery.** Use keyword, semantic, or hybrid search to help organizers find sessions by title, abstract, speaker, topic, or approved transcript content. Search analytics can summarize popular topics for planning, subject to privacy thresholds and event permissions.

**OpenAI — optional synthesis.** Summarize opt-in attendee learning interests into themes for organizers. Keep source responses access-controlled, label generated summaries as AI-generated, and let organizers review them before sharing with speakers.

**Radar — conditional operations UI.** If the service is deployed to Kubernetes, Radar can help technical operators inspect workloads and investigate cluster failures. It does not apply to the current Docker Compose-only development setup and is not required for an organizer-facing event dashboard.

### Speakers

**OpenAI — optional preparation and follow-up.** Generate a draft, aggregate summary of attendee learning goals for a speaker's assigned session. The speaker can use it to tune examples and emphasis. Do not expose individual registration responses by default; allow organizer review and corrections before the summary is shared.

**Elasticsearch — session lookup.** Help speakers find approved sessions, resources, and published transcript passages by topic or phrase. Restrict results to the speaker's access rights and to content the event permits them to see.

**Dash0 — behind-the-scenes reliability.** Dash0 helps the operations team diagnose delays affecting a speaker's session. The speaker should see a simple status and next step in the app, not raw infrastructure graphs or other sessions' data.

**Gitar — development workflow.** Gitar can review pull requests that change speaker/session APIs, time-zone handling, permissions, or poll behavior. It is a repository-level code review tool, not a feature inside the speaker experience.

### Attendees

**Elasticsearch — transcript and talk search.** Index published talk metadata and permitted transcript text so attendees can find sessions and jump to matching transcript passages. Search results should include conference/session context and timestamps. Enforce event access controls at query time; do not make private or unpublished session content searchable.

**OpenAI — optional summaries and grounded Q&A.** Create session summaries or answer attendee questions using only content the attendee is allowed to access. Answers should link to the supporting session and transcript timestamps, indicate when the source does not contain an answer, and avoid inventing details. Keep live transcription/translation available if AI summaries or Q&A are delayed.

**Dash0 — real-user and service performance monitoring.** Monitor page loading, joining a session, live transcript update delay, translation delay, reconnects, and client errors across supported device/browser classes. Use this to find attendee-impacting problems; show only a plain-language status in the attendee app. Do not send audio, transcript text, names, contact details, registration responses, or identifiable search queries to telemetry.

**Gitar — development workflow.** Require PR review for attendee-facing changes, including accessibility, privacy, and API compatibility. Gitar should provide review and CI remediation; maintainers remain responsible for approving changes.

### Engineering and operations

**Gitar / Sonar — code quality and CI repair.** Connect the GitHub App to the repository and use project-specific review instructions for important rules, such as time-zone-safe schedules, event-level authorization, migrations, and matching frontend/API contracts. Add a real CI workflow first so proposed fixes can be checked by build, lint, and automated checks. Gitar is not a runtime dependency.

**Radar — Kubernetes operations, if Kubernetes is selected.** Use it to inspect deployed services, workloads, restarts, resource limits, and cluster-level failures; its AI investigation or MCP interface can help diagnose a real issue. Docker Compose remains suitable for local development. Do not add Kubernetes just to use Radar unless the team also needs and can operate a cluster.

**OpenAI — bounded application capabilities.** Potential uses include attendee-interest theme extraction, session summaries, and transcript-grounded Q&A. Keep model calls behind the backend, set timeouts and usage limits, record model/version and token/cost metadata, and provide a graceful fallback. Never make AI availability a prerequisite for receiving live captions.

## Dash0 observability and responsiveness plan

### Instrument the full session path

Create correlated OpenTelemetry spans for the stages that make a transcript or translation visible:

1. audio or stream received;
2. audio queued or accepted for processing;
3. transcription segment produced;
4. translation completed for the configured language; and
5. update delivered to the attendee client.

Measure the duration of each stage and the end-to-end time from speech input to displayed transcript/translation. Include service health, retries, timeouts, active work, queue depth, queue age, and resource utilization. Use the same trace context across the backend and processing services where possible so operators can identify which stage caused a delay.

### Build dashboards for distinct jobs

1. **Live event operations:** active sessions, service availability, connected clients, current delay, queue/backlog, errors, and the sessions needing attention.
2. **Capacity and infrastructure:** CPU, memory, GPU if used, network, container/pod restarts, limits, and utilization by service/deployment.
3. **Post-event processing:** remaining jobs, job age, processing throughput, failures/retries, and estimated time to drain the backlog.
4. **Attendee experience:** browser-side page/session errors, connection stability, transcript update delay, and translation delay by coarse device/browser dimensions.
5. **AI usage, if OpenAI features are built:** request count, latency, failures, token usage, and cost by feature/model, without recording prompt or transcript content.

Dash0 supports dashboards that combine observability signals. Resource detail depends on the hosting environment: Kubernetes metrics can be collected in a Kubernetes deployment; the current Compose setup needs suitable host/container telemetry collection and application instrumentation. See [Dash0 dashboards](https://www.dash0.com/docs/dash0/dashboards/about-dashboards), [metrics](https://www.dash0.com/docs/dash0/telemetry/metrics/about-metrics), and [Kubernetes metrics](https://www.dash0.com/docs/dash0/monitoring/kubernetes/kubernetes-metrics).

### Define objectives before alerts

Define an availability and latency objective for each user-visible flow, especially time from speech to visible transcript and from speech to visible translation. Set numeric targets only after the team has chosen languages, model sizes, expected concurrent sessions, target hardware, and acceptable delay. Then alert on sustained objective violations, growing backlog, high error rates, dropped connections, and exhausted resource headroom. Avoid paging for a brief spike that does not affect attendees.

### Turn observations into capacity actions

Dash0 exposes symptoms and evidence; it does not itself schedule or balance jobs. The application and hosting platform must implement responses. Candidate controls include:

- bounded queues with visible backlog and rejection behavior;
- prioritize live session work over post-event summaries and indexing;
- apply per-session concurrency limits and backpressure;
- degrade gracefully, for example keeping the original-language transcript available when translation is behind;
- scale transcription or translation workers based on queue and resource signals when the platform supports autoscaling; and
- pause or throttle non-urgent post-event jobs during live sessions, then resume them when capacity is available.

Use load tests that resemble the expected number of simultaneous sessions and attendees to learn the capacity limit. A controlled latency/error injection can be useful for a hackathon demonstration, but only in an isolated test environment—not against a live conference.

### Protect attendee and session data

Telemetry should describe system behavior, not carry session content. Do not include raw audio, transcript text, prompts, attendee contact details, registration answers, or identifiable searches in spans, logs, or metric labels. Use service names, environment, and carefully reviewed event/session identifiers only as needed. Keep metric dimensions low-cardinality; do not label each measurement with an attendee ID or transcript phrase.

## Search and AI data design

- PostgreSQL remains the source of truth for event, session, user, and permission records.
- Elasticsearch is a search index for approved content, not the authority for access permissions. Re-check access against current event/session permissions when returning results.
- Store transcript segments with session ID, timestamps, language, publication status, and speaker attribution where authorized. Index only content allowed by the event's publication policy.
- Use the OpenAI API for bounded derived tasks such as theme summaries, summaries, or grounded Q&A. Keep generated output linked to source sessions/segments and allow correction or deletion when source content changes.
- Use background jobs for indexing and summaries so a slow model or search update does not block live transcription and translation.

## Suggested implementation order

1. **Reliability baseline:** add end-to-end OpenTelemetry traces and service metrics to the current FastAPI and processing flow; define what “transcript delay” and “translation delay” mean.
2. **Dash0:** connect telemetry, create live-operations and capacity dashboards, and set initial alerts after establishing baseline behavior.
3. **Load behavior:** add bounded queues, live-work prioritization, and a fallback when translation or downstream processing is behind; validate with a load test.
4. **Gitar:** add CI checks and repository review instructions, then authorize the Gitar GitHub App for the repository.
5. **Elasticsearch:** add it when transcript/session search is part of the selected user workflow; establish indexing, permissions, and deletion behavior.
6. **OpenAI:** add one narrowly defined feature, such as organizer-reviewed interest themes or timestamp-grounded session Q&A, with latency, cost, and privacy controls.
7. **Radar:** adopt only if the team chooses Kubernetes as a deployment target and has a real cluster operations need.

## Hackathon demonstration path

A cohesive demo can show one session moving through the system: deliver a short audio stream, display transcript and translation, search a timestamped passage, then show Dash0 traces and metrics for the same workflow. Demonstrate an injected delay in an isolated environment, use Dash0 evidence to identify the slow stage, and show the app's fallback or queue behavior. If time permits, show Gitar reviewing a meaningful pull request and Elasticsearch powering transcript search. Add OpenAI Q&A only if it can cite the relevant transcript passage reliably.

## Out of scope for this technology mapping

This plan does not decide the final release scope, select a production cloud/Kubernetes environment, set SLO numbers, or authorize sending event data to third-party services. Those decisions require expected concurrency, budget, consent, retention, and deployment requirements from the project team.
