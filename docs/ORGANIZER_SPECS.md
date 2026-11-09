# Organizer specifications

## Purpose

Organizers configure the event, coordinate speakers and attendees, and make sure the conference experience works during the event. They need useful planning information before the conference, operational visibility while it is running, and feedback afterward.

## Organizer goals

- Configure the event schedule, sessions, speakers, rooms, participation options, and content policies.
- Understand what attendees hope to learn and plan for likely demand.
- Enable and monitor live transcription, translation, and audience participation.
- Identify service problems quickly and choose a practical response.
- Review aggregate feedback and engagement signals to improve future events.

## Before the conference

### Event and session setup

Organizers can create and update an event with its name, dates, location, time zone, registration link, schedule, rooms, tracks, speakers, and sessions. They can mark whether a session is in person, remote, or hybrid and specify the languages offered for live captions or translation.

For each session, organizers can configure:

- title, description, topic tags, speakers, track, room, and scheduled time;
- expected audience size or room capacity;
- whether live transcription, translation, polls, and post-event materials are enabled;
- who can view the live session and any archived recording or transcript; and
- the speaker and organizer responsible for session operations.

Changes to the schedule should be visible to affected speakers and attendees. The system should identify schedule conflicts, such as a speaker assigned to overlapping sessions or a room over capacity, when the required data is available.

### Registration interests and audience planning

Organizers may collect an attendee's response to a question such as “What would you like to learn from this conference?” The organizer can review aggregate themes and counts, then share an approved summary with speakers. These responses can inform session descriptions, room assignments, and capacity planning.

Interest is not a reliable attendance forecast by itself. Organizers should be able to distinguish sign-ups, stated interests, and actual attendance. Individual registration responses and contact details should not be shared with speakers by default.

### Venue and exhibitor planning — candidate follow-up

Organizers may create a floor map containing rooms, services, exhibitors, and activities. They could use topic-interest patterns to choose whether related exhibitors should be grouped or distributed to encourage discovery. This requires venue-map and exhibitor data and is not a prerequisite for the initial release.

## During the conference

### Session operations dashboard

Organizers need a desktop-oriented view of active and upcoming sessions. It should show:

- session, room or remote link, scheduled time, speaker, and current state;
- whether transcription and each configured translation are enabled and healthy;
- live connection or stream count, where available;
- transcription delay and translation delay, including a recent trend or high-percentile view;
- queue depth or backlog age, when the processing architecture uses a queue;
- error, timeout, retry, and service-unavailable indicators; and
- a clear alert when a session is degraded and a suggested next action or support contact.

The dashboard should help an organizer answer “Which sessions need attention now?” and “Is the issue limited to one session or affecting the whole event?” It should separate user-visible service status from infrastructure detail. Organizers can notify affected speakers or attendees about an outage and share a fallback plan.

### Audience participation

Organizers can enable a speaker's poll or survey for a session, choose whether results appear live, and view aggregate responses. Polls must not be required to access the session. The event policy should define whether polls are anonymous, whether individual answers are retained, and who can export results.

### In-person attendee support — candidate follow-up

The organizer experience may provide a venue map and service locations. Organizers should be able to publish updates when rooms, times, or services change. Attendees use their own device for the live transcript, translation, schedule, and participation views; see the [attendee specifications](ATTENDEE_SPECS.md).

### Remote attendance — candidate follow-up

Remote attendance may include a live stream, watch parties, and moderated chat. These features require video delivery, moderation tools, and additional capacity planning. They should be scoped separately from live transcription and translation.

## After the conference

### Session and event insights

Organizers can review aggregate event and session information such as registration, attendance or participation counts, poll responses, optional ratings, and searches within published transcripts. If search analytics are offered, show aggregate topics and counts rather than a named attendee's search history. Suppress or combine low-volume results when individuals could otherwise be inferred.

These signals describe engagement; they do not, by themselves, measure learning, knowledge retention, or presentation quality. The product should avoid reducing a session to a single “success” score unless the team defines and validates what that score means.

### Speaker feedback and follow-up

Organizers can collect attendee feedback for speakers and feedback from speakers about the event. Speakers may submit links and resources for attendees. If organizers send follow-up email or text messages, recipients must have opted in and organizers must follow the event's communication preferences.

### Session archive and personalized digest — candidate follow-up

With the required permissions, organizers may publish transcripts, summaries, recordings, or RSS feeds. A future personalized digest could connect an attendee's stated interests with relevant sessions and timestamped transcript passages. Recording, review, access, retention, and deletion rules must be established before this feature is released.

## Dash0: resource use and capacity

Dash0 is the observability platform for authorized technical operators. It can bring metrics, traces, logs, and resource information together in dashboards. Its Kubernetes resource metrics apply when the services run on Kubernetes; other hosting environments need their own supported resource instrumentation. See [Dash0 dashboards](https://www.dash0.com/docs/dash0/dashboards/about-dashboards) and the [Kubernetes metrics reference](https://www.dash0.com/docs/dash0/monitoring/kubernetes/kubernetes-metrics).

### Signals for operators

Monitor the following, separated by service and deployment where useful:

- CPU, memory, and GPU utilization, if GPU processing is used;
- number of active sessions, streams, connections, and concurrent jobs;
- request rate, queue depth, and oldest queued-job age;
- speech-to-text and translation latency, including typical and high-percentile delay;
- error, timeout, retry, and dropped-connection rates; and
- available capacity and duration of sustained saturation.

These signals help operators locate bottlenecks and choose whether to queue work, reduce processing load, move workloads, or scale infrastructure. Dash0 provides observability and alerting; workload balancing and autoscaling must be implemented separately in the application and hosting platform.

### Organizer-facing capacity guidance

Organizers should receive concise, event-specific status in the conference product, for example, “translation is delayed for two sessions” or “service capacity is nearing its limit.” Raw CPU charts and unrelated service details belong in the technical operations view. Direct access to the Dash0 account is not assumed; provide it only if organizer roles, permissions, and the displayed data are deliberately designed for that access.

Do not send raw audio, transcript text, attendee names, registration answers, or identifiable search terms to Dash0. Use only the minimum operational attributes needed to find a problem. Avoid attendee-level identifiers in telemetry and review the privacy and cardinality impact of event or session dimensions.

## Initial release candidate

The following is a proposed first organizer workflow, not a final commitment:

1. Create an event, add a session and speaker, and configure session languages.
2. Collect attendee learning interests and review an aggregate summary.
3. Enable live transcription and translation for a session.
4. Monitor service readiness, delay, and errors for the active session.
5. Review optional post-session feedback in aggregate.

Floor-plan optimization, remote watch parties, newsletters, personalized RSS, advanced search analytics, predictive room assignment, and automated scaling are follow-up candidates.

## Decisions to resolve

- Who operates the platform during an event: an organizer, a separate technical operator, or both?
    > It should be simple enough for any organizer to use, but also have an advanced section for a technical operator to view and change. 
- Which hosting environment will be used, and what resource telemetry can it provide to Dash0?
    > For now, just localhost. We are just making this as a demo concept.
- What actions should follow a capacity warning: queue, reduce quality, move a session, or scale?
    > A queue is best. Prioritize computational resources for the sessions that are getting hte most engagement if yo have to choose. If resources go down, then keep capturing what ever talk needs to be transcrobed and process it later. Let attendees know when a talk has finished processing so that they can go and ready it right away. 
- Which metrics are visible to organizers, speakers, and attendees, respectively?
    > For the technical operators, I owould wnat to know how much of our computational load is being used. For an organizer, I would want to track metrics of how many people are actually watching a particular event and be notified if translations or other services go down. As a speaker I would want to know if my event is being transcribed what resources are still available to me as I am presenting. And I also as a speaker I would want to know when my presentation is going through deeper transcription and other computeational processing. As an attendee, I might want the option to just view the overall metrics of a confereces coputaitonal load just for fun, but I would also want to know when my presentations that I am interested in are also starting ot be processed, what order in the queus thare are in for processing, and what languages are currently available from proecessing. I would also be interested in knowing when my search values are getting updated thorughout the conference. For instance if i searched for Spanish artifcial intellegnece references, I would want to know how often that search if being updated through the conference. Maybe when the computational load from transcribing is down or maybe just at the end of every talk session. I would just wnat to know when the computer is searching for that. 
- What consent and access rules govern registration answers, polls, feedback, recordings, and transcripts?
    > Don't record any PII for answers and polls and feedback, all of that data should be aggregated. For spreading out recordings and trancripts, if there is a way to share these without collecting user data ahead of time go for that. It is nessecary to track emails or contact information for the differnt peopple wanting to access event recording and transcripts. However, we need to stay completely transparent with each user what their emial is being used for. At the end of an event after all the transcription and everything is processed, the user should get an email saying that their contact information is no longer needed to send them correspondence form the event and will be deleted from the system to protect their privacy. If they want to participate in post conference engagement from speackers and booths, they will need to visit the conference site or app. Speakers and conference organizers will only have a week after a conference concludes to "bother" attendees about follow up engagemtn questions. 
- How should “session success” be defined without overstating what engagement data proves?
    > Session suggess is defined by how well the conference met the needs of all the people attending. To attempt to quantify this, while the cmputer is processing how many pre-cpnference search results were mentioned during talks we an count that as success criteria. Other metrics could views, visits, and even post0conference engagement responses. 
