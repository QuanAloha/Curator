# Speaker specifications

## Purpose

Speakers prepare and deliver conference sessions. The platform should help them understand audience interests, manage session information, deliver an accessible talk, and learn from attendee feedback without exposing attendee data unnecessarily.

## Speaker goals

- Understand the audience's learning interests before the event.
- Keep session details, links, and materials accurate.
- Know whether live session services are ready and what to do if they fail.
- Engage attendees through optional polls or questions.
- Review feedback and share follow-up material with interested attendees.

## Before the conference

### Review audience interests

For each assigned session, a speaker can review an organizer-approved summary of what attendees said they want to learn. The summary may include aggregated topics and response counts, but should not include attendee names or individual registration responses by default. Speakers can use it to adjust examples, emphasis, and session descriptions; it is guidance, not a guarantee of the audience's knowledge or attendance.

### Manage session details

Speakers can review the session title, abstract, topic tags, track, room, date and time, and any organizer-provided audience summary. The project team must decide which fields speakers may edit and which require organizer approval. Speakers can submit presentation links, handouts, and follow-up resources for organizer review or publication.

### Review recording and accessibility settings

Before the event, speakers can see whether transcription, translation, or recording is enabled for their session, which languages are configured, who can access resulting content, and the planned retention period. The system should make recording and publication expectations clear before the speaker presents.

## During the conference

### Session readiness and service status

Speakers can see a simple status for the services configured for their active session:

- transcription and translation are ready, processing, delayed, or unavailable;
- the selected translation languages; and
- a plain-language fallback action or support contact if a service is degraded.

The speaker view should not require the speaker to interpret CPU charts, infrastructure logs, or unrelated sessions' status. If service quality changes during a talk, the interface should update clearly and avoid claiming that captions or translations are complete or error-free.

### Polls and audience questions — candidate feature

If the organizer enables participation tools, a speaker may launch a poll or question for attendees to answer on their devices. Candidate formats include multiple choice and true/false. Speakers may see aggregated responses and, if enabled, share the results on a room display. Poll participation should be optional and should not block access to the session.

The event must define whether responses are anonymous, whether the speaker can see individual answers, whether results appear live, and how long responses are retained. Live questions or chat need moderation and should be scoped separately if they are not part of the initial release.

## After the conference

### Review feedback

Speakers can review aggregate feedback for their own sessions and submit feedback about the event experience. Any feedback shown to a speaker should follow the event's stated anonymity and moderation rules. Small response groups may need suppression to prevent a person's identity from being inferred.

### Share resources and session materials

Speakers can submit links, slides, or other resources for attendees. If a transcript, summary, or recording is created, speakers should know whether they can review or correct it before publication. Access, approval, retention, and deletion behavior must follow the event's content policy.

## Dash0: session service health and resource use

Dash0 is primarily an observability tool for authorized technical operators. It can help them diagnose service issues by relating session delay to resource use, active streams, queue depth, error rates, and transcription or translation latency. Dash0 dashboards can combine observability signals; available host or Kubernetes resource detail depends on the deployment. See [Dash0 dashboards](https://www.dash0.com/docs/dash0/dashboards/about-dashboards).

Speakers see a simple, session-specific service status and next step in the conference product, not direct Dash0 access by default. Do not expose other sessions' infrastructure data or attendee-level data. Dash0 may reveal that a service is saturated; operators and the hosting system must decide whether to queue, move, or scale work.

## Accessibility and privacy

- Session status, polls, and materials should be usable on phones and assistive technologies.
- Speakers should receive only attendee-interest information approved for their session.
- Speaker access should be limited to sessions assigned to them.
- Recording and transcript publication require clear event and speaker permissions.
- Speaker follow-up should reach only attendees who opted in; speakers should not receive attendee contact details by default.

## Decisions to resolve

- Which session fields can speakers edit directly?
    >   All of them
- Is speaker approval required before a transcript or recording is published?
    > Speakers will be able to opt out of having their talk published. By default it will be published. 
- Can speakers correct automated transcripts, and who approves the corrected version?
    > Yes.....but it must be reviewed by an AI agent. And it also must be transparent to the readers where the speaker opted to make edits. 
- Which poll types are in the initial release, and what response details may the speaker see?
    > No open answer polls. Only true false or multiple choice answers. 
- What feedback is visible to speakers, and how are anonymous or low-volume responses protected?
    > If the responses are all multiple choices, the speaker cannot see who chose what choice, and the system wont even track that. It will track the number of people who chose a choce bu tnot the indiividual peple. 
- What exact fallback should the interface offer when transcription or translation is degraded?
    > Bar none - the recording of a talk needs to be kept. If a transcripton or translation is degraded, useres of the app will be informated about what is going on. They will also be told that the recording of the talk will be run through better models after the talk concludes and the transcription/translation will be available within 30 mintues of talk completion. 
