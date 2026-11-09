# Attendee specifications

## Purpose

Attendees use Conference Companion to prepare for a conference, follow sessions in person or remotely, take part in optional activities, and revisit useful material afterward. The experience should be mobile-first, accessible, and clear about how personal information and session content are used.

## Attendee goals

- Find sessions relevant to their interests and plan their schedule.
- Follow a talk using live captions and, when available, translation.
- Search or revisit session material after a talk or event.
- Participate in optional polls and provide feedback.
- Choose whether to share personal information or receive follow-up content.

## Before the conference

### Register and share interests

An attendee can open an event registration link and submit the information required by that event. Candidate fields include name, email address, and optionally a phone number. The event should explain which fields are required and why; phone number should not be mandatory unless the event has a clear need for it.

Registration may include a short-answer question such as “What would you like to learn from this conference?” The attendee should be told that their answer may be summarized for organizers and speakers. Individual responses should not be shared with speakers by default. The attendee can review the event's privacy and communication choices before submitting.

### Browse and save sessions

Attendees can browse the published schedule and view a session's title, description, speaker, time, room or remote availability, and supported caption/translation languages. They may save sessions to a personal list. Personalized recommendations based on stated interests are a possible enhancement; the initial experience can provide basic browsing and saved sessions.

## During the conference

### Follow a live session

For a session with live transcription enabled, an attendee can open the session on a phone or computer and view the transcript as it arrives. If one or more translation languages are available, the attendee can select a language. The interface should identify the session and selected language and show a clear status if captions or translations are delayed or unavailable.

Transcript text should remain readable as new lines arrive, and the attendee should be able to scroll through recent text without being forced back to the latest line. If the event permits saving session content, the attendee can keep the transcript for later access. “Saved on the device” versus “saved to the attendee's account” is a product decision; communicate the chosen behavior and avoid silently storing sensitive content.

Automated transcription and translation can contain errors. The interface should not present them as authoritative, and the product should preserve timestamps or other context that helps an attendee locate a point in the talk.

### Search a session transcript

Where transcript search is enabled, the attendee can search for a word or phrase in the current or saved session. Results should identify the matching passage and timestamp, highlight the query in context, and let the attendee jump to the relevant point in the transcript. Search should handle multiple matches and provide a clear no-results state.

Whether search runs locally on a device or through the service depends on where transcript data is stored. The product should not expose a named attendee's search history to organizers or speakers by default.

### Participate in a poll

If a speaker launches a poll, an attendee may answer on their device using the formats supported for that session, such as multiple choice or true/false. Poll participation is optional. The attendee should see whether the response was submitted and whether results will be displayed live. The interface should work without blocking the transcript or other session content.

## After the conference

### Review attended sessions

The attendee can open a conference library containing the sessions they attended or saved, subject to the event's access policy. For sessions with approved content, the library may provide a transcript, available translations, transcript search, timestamps, and speaker-provided links. The attendee should be able to tell which material is unavailable, still processing, or removed by the event organizer.

Attendees can optionally give feedback about a session or the event. Before submitting, they should be told whether the feedback is anonymous, who can see it, and how it may be summarized.

### Personalized content and external integrations — later scope

Potential follow-up features include:

- a personalized digest or RSS feed for talks related to the attendee's chosen interests;
- browsing approved talks from conferences the attendee did not attend;
- exporting saved notes or session materials to services such as Notion or Obsidian; and
- opt-in email or text follow-up from speakers or organizers.

These features require decisions about account linking, content rights, attendee consent, and retention. Email or text delivery must be opt-in.

## Remote attendance — later scope

Remote attendees may eventually watch a live stream, view the live transcript and translation, and join a watch party or moderated chat. A browse page could let them find and save talks from other events. These features add live video delivery, moderation, access control, and significant capacity requirements; they are not assumed to be part of the initial release.

## Dash0: attendee privacy and service quality

Dash0 is an operational observability platform for the service team, not an attendee-facing product. Operators may use it to monitor service availability, transcription and translation delay, queue backlog, and compute-resource pressure. Dash0 dashboards can combine metrics, traces, logs, and resource information ([Dash0 dashboards](https://www.dash0.com/docs/dash0/dashboards/about-dashboards)).

Attendees should see only useful service status in the conference app, such as “translation is available” or “captions are delayed.” Do not send attendee names, contact details, registration answers, raw audio, transcript text, or identifiable search activity to Dash0. Keep operational telemetry aggregated and limited to the attributes needed to diagnose service behavior.

## Accessibility and privacy

- The primary attendee experience must work on a phone and adapt to larger screens.
- Transcript text must support readable type sizes, sufficient contrast, keyboard navigation, and screen readers.
- Live updates must not unexpectedly move focus or interrupt a user's reading position.
- Registration should collect only information needed for the event and explain how it will be used.
- Attendees should be able to understand whether content is public, event-only, or personal.
- Recording, transcript retention, search, and follow-up must follow the event's disclosed consent and access rules.

## Decisions to resolve

- Which registration fields are required, and who can see each one?
    > Name, Email, (Optional) Phone #, Open Answer General Interests (to be turned into transcription searches), also speaker interests. Speakers can see the aggregate answers from perticipant interests. Organizers can have access to anonymized agregate everything else. Particiapants can see the name and email that they have submitted and also can also see what specific inofmraiton they submitted that the organizers and speakers can see. 
- Can attendees edit or delete their learning-interest response?
    > Attenees can append their learning interests thorughout the conference, but not delete. At the end of the confrence, it will all be deleted anyways. 
- Which languages are supported at launch, and how does an attendee select one?
    > Fot the simplicity of this project lets just go with english, spanish, tagalog.
- Are transcripts saved on-device, in an account, or both? For how long?
    > Transcripts can be accessed by the accounts of all the attendees, speakers, and organizers. They will have access to the infomration through any of the communcation channels they chose rpeconference liek email, text, or rss. 
- Which sessions can attendees search, and is search local or server-side?
    > Server side. THis is a web app anyways. THey can search for other things via their email. 
- Are attendee poll answers anonymous, and who can see individual responses?
    > Poll anwers are all anonymous. 
- What minimum service experience should remain available on poor Wi-Fi or a low-end phone?
    > All text based information should be priority. then live captions can be available for streaming to devices.  images or other highbandwith media can follow last. 
- Which, if any, remote-attendance features belong in the first release?
    > On first release, lets have the a page skeleton like a youube video page with the video being the main event on the page. On the righ tof the video, insted of recommended next videos we will have th elive transcript with the option of live translation. Beneath the vide just make it a simple event title with a "back" button to go back to the events page. 
