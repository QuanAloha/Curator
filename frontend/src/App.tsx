import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

type Role = 'attendee' | 'speaker' | 'organizer';
type Language = 'en' | 'es' | 'tl';
type Session = {
  id: string; event_id: string; title: string; description: string; speaker_name: string;
  track: string; room: string; starts_at: string; source_language: Language;
  publish_content: boolean; transcription_status: string; has_recording: boolean;
  active_viewers: number; max_viewers: number; transcript_segments: number;
  interest_mentions: number; transcript_updated_at?: string | null;
  recent_jobs: Job[];
};
type Segment = {
  id: number; start_seconds: number; end_seconds: number; language: Language;
  text: string; source: string; edited_by_speaker: boolean; edit_review_status: string;
};
type Job = { id: string; status: string; progress: number; priority?: number; message: string; created_at: string; finished_at?: string };
type Poll = { id: string; question: string; kind: string; active: boolean; total_votes: number; options: { id: number; label: string; votes: number }[] };
type Overview = {
  services: Record<string, string>;
  counts: { active_viewers: number; queued_jobs: number; processing_jobs: number; completed_jobs: number };
  sessions: Session[];
  jobs: (Job & { session_id: string })[];
  compute?: {
    backend_cpu_percent: number;
    backend_memory_mb: number;
    whisperlive: { status: string; active_clients: number | null; max_clients: number | null };
  };
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.detail ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

const LANGUAGES: Record<Language, string> = { en: 'English', es: 'Spanish', tl: 'Tagalog' };
const formatTime = (value?: string) => value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Time to be announced';
const formatTimestamp = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

export default function App() {
  const [role, setRole] = useState<Role>('attendee');
  const [event, setEvent] = useState<{ id: string; title: string; description: string } | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [transcript, setTranscript] = useState<Segment[]>([]);
  const [language, setLanguage] = useState<Language>('en');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [interests, setInterests] = useState<{ topic: string; count: number }[]>([]);
  const session = sessions.find((item) => item.id === selectedId) ?? sessions[0];
  const selectedJob = jobs.find((job) => job.status === 'queued' || job.status === 'processing') ?? jobs[0];

  const loadSessions = useCallback(async () => {
    try {
      const events = await api<{ id: string; title: string; description: string }[]>('/api/events');
      const currentEvent = events[0];
      if (!currentEvent) return;
      setEvent(currentEvent);
      const nextSessions = await api<Session[]>(`/api/events/${currentEvent.id}/sessions`);
      setSessions(nextSessions);
      setSelectedId((current) => current || nextSessions[0]?.id || '');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not connect to the conference service.');
    }
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const data = await api<Overview>('/api/operator/overview');
      setOverview(data);
      setSessions(data.sessions);
    } catch { /* keep the last successful dashboard snapshot */ }
  }, []);

  useEffect(() => { void loadSessions(); }, [loadSessions]);
  useEffect(() => {
    const timer = window.setInterval(() => void loadSessions(), 10000);
    return () => window.clearInterval(timer);
  }, [loadSessions]);
  useEffect(() => {
    if (role !== 'organizer') return;
    void loadOverview();
    const timer = window.setInterval(() => void loadOverview(), 5000);
    return () => window.clearInterval(timer);
  }, [role, loadOverview]);
  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    const refresh = async () => {
      try {
        const [segments, nextJobs, nextPolls] = await Promise.all([
          api<Segment[]>(`/api/sessions/${selectedId}/transcript?language=${language}&role=${role}`),
          api<Job[]>(`/api/sessions/${selectedId}/jobs`),
          api<Poll[]>(`/api/sessions/${selectedId}/polls`),
        ]);
        if (alive) { setTranscript(segments); setJobs(nextJobs); setPolls(nextPolls); }
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : 'Could not load session data.');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3500);
    return () => { alive = false; window.clearInterval(timer); };
  }, [selectedId, language, role]);
  useEffect(() => {
    if (!event) return;
    const refresh = () => api<typeof interests>(`/api/events/${event.id}/interests`).then(setInterests).catch(() => {});
    void refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => window.clearInterval(timer);
  }, [event]);
  useEffect(() => {
    if (role !== 'attendee' || !selectedId) return;
    const key = `conference-viewer-${selectedId}`;
    let viewerToken = sessionStorage.getItem(key);
    if (!viewerToken) { viewerToken = crypto.randomUUID(); sessionStorage.setItem(key, viewerToken); }
    const ping = () => api(`/api/sessions/${selectedId}/viewers/heartbeat`, { method: 'POST', body: JSON.stringify({ viewer_token: viewerToken }) }).catch(() => {});
    ping();
    const timer = window.setInterval(ping, 25000);
    return () => { window.clearInterval(timer); void api(`/api/sessions/${selectedId}/viewers/leave`, { method: 'POST', body: JSON.stringify({ viewer_token: viewerToken }) }).catch(() => {}); };
  }, [role, selectedId]);

  const flash = (message: string, isError = false) => {
    setNotice(message); setError(isError ? message : '');
    window.setTimeout(() => setNotice(''), 5000);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home"><span className="brand-icon">C</span><span>Conference<span className="brand-light">Companion</span></span></a>
        <div className="event-pill"><span className="tiny-live" />{event?.title ?? 'Conference Companion'}</div>
        <div className="role-switch" aria-label="Choose prototype view">
          {(['attendee', 'speaker', 'organizer'] as Role[]).map((item) => <button key={item} className={role === item ? 'active' : ''} onClick={() => setRole(item)}>{item}</button>)}
        </div>
      </header>

      {(notice || error) && <div className={`notice ${error ? 'notice-error' : ''}`} role="status">{error || notice}<button onClick={() => { setError(''); setNotice(''); }} aria-label="Dismiss">×</button></div>}
      {error && !sessions.length && <main className="empty-state"><h1>Starting your conference</h1><p>{error}</p><button className="button button-dark" onClick={() => void loadSessions()}>Try again</button></main>}
      {!error || sessions.length > 0 ? <>
        {role === 'attendee' && session && <AttendeeView session={session} sessions={sessions} selectedId={selectedId} setSelectedId={setSelectedId} language={language} setLanguage={setLanguage} transcript={transcript} setTranscript={setTranscript} jobs={jobs} polls={polls} onMessage={flash} />}
        {role === 'speaker' && session && <SpeakerView session={session} sessions={sessions} selectedId={selectedId} setSelectedId={setSelectedId} transcript={transcript} jobs={jobs} polls={polls} onMessage={flash} onRefresh={loadSessions} />}
        {role === 'organizer' && event && <OrganizerView event={event} overview={overview} interests={interests} onRefresh={loadOverview} onMessage={flash} />}
      </> : null}
      <footer className="app-footer"><span>CONFERENCE COMPANION · PROTOTYPE</span><span>Operational signals are estimates for this demo.</span><a href="/api/health" target="_blank" rel="noreferrer">Service health ↗</a></footer>
    </div>
  );
}

function SessionSelect({ sessions, selectedId, onChange }: { sessions: Session[]; selectedId: string; onChange: (id: string) => void }) {
  return <select className="session-select" value={selectedId} onChange={(event) => onChange(event.target.value)} aria-label="Choose a session">
    {sessions.map((session) => <option value={session.id} key={session.id}>{session.title}</option>)}
  </select>;
}

function AttendeeView({ session, sessions, selectedId, setSelectedId, language, setLanguage, transcript, setTranscript, jobs, polls, onMessage }: {
  session: Session; sessions: Session[]; selectedId: string; setSelectedId: (id: string) => void; language: Language;
  setLanguage: (language: Language) => void; transcript: Segment[]; setTranscript: Dispatch<SetStateAction<Segment[]>>;
  jobs: Job[]; polls: Poll[]; onMessage: (message: string, error?: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const languageRef = useRef(language);
  const [live, setLive] = useState(false);
  const [liveReady, setLiveReady] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Segment[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedPoll, setSelectedPoll] = useState<Record<string, number>>({});
  const [voted, setVoted] = useState<Record<string, boolean>>({});
  const [interest, setInterest] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const primaryPoll = polls.find((poll) => poll.active);
  const currentJob = jobs.find((job) => job.status === 'queued' || job.status === 'processing') ?? jobs[0];
  const videoUrl = session.has_recording && session.publish_content ? `/api/sessions/${session.id}/media?role=attendee` : '';
  const displayedTranscript = useMemo(() => transcript, [transcript]);

  useEffect(() => { languageRef.current = language; }, [language]);

  const saveSegment = useCallback(async (start: number, end: number, text: string, lang: Language, source: 'live' | 'enhanced' = 'live') => {
    if (!text.trim()) return;
    try {
      const saved = await api<Segment>(`/api/sessions/${session.id}/segments`, { method: 'POST', body: JSON.stringify({ start_seconds: start, end_seconds: end, text: text.trim(), language: lang, source }) });
      setTranscript((previous) => {
        const next = previous.filter((segment) => !(segment.language === lang && Math.abs(segment.start_seconds - start) < 0.3));
        return [...next, saved].sort((a, b) => a.start_seconds - b.start_seconds);
      });
    } catch { /* keep the live captions visible even if persistence is temporarily unavailable */ }
  }, [session.id, setTranscript]);

  const stopLive = useCallback(async () => {
    const processor = processorRef.current;
    const socket = wsRef.current;
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); processorRef.current = null; }
    try { if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode('END_OF_AUDIO')); } catch { /* closing */ }
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    if (contextRef.current && contextRef.current.state !== 'closed') await contextRef.current.close().catch(() => {});
    contextRef.current = null; wsRef.current = null; setLive(false); setLiveReady(false);
  }, []);

  const startLive = async () => {
    const video = videoRef.current as (HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }) | null;
    const capture = video?.captureStream ?? video?.mozCaptureStream;
    if (!video || !capture) { onMessage('This browser cannot capture audio from the session video. Try a current Chrome or Firefox browser.', true); return; }
    const stream = capture.call(video);
    if (!stream.getAudioTracks().length) { onMessage('The uploaded session video has no audio track.', true); return; }
    const context = new AudioContext({ sampleRate: 16000 });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const gain = context.createGain(); gain.gain.value = 1;
    source.connect(processor); processor.connect(gain); gain.connect(context.destination);
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/whisper`);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => socket.send(JSON.stringify({ uid: crypto.randomUUID(), language: session.source_language, task: 'transcribe', model: 'small', use_vad: true, send_last_n_segments: 1, enable_translation: false }));
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.message === 'SERVER_READY') { setLiveReady(true); return; }
        const segments = Array.isArray(data.segments) ? data.segments : [];
        for (const item of segments) {
          const text = typeof item.text === 'string' ? item.text : '';
          const start = Number(item.start ?? item.start_time ?? 0);
          const end = Number(item.end ?? item.end_time ?? start);
          if (text.trim()) {
            const segmentEnd = Math.max(start, end);
            void saveSegment(start, segmentEnd, text, session.source_language, 'live');
            const targetLanguage = languageRef.current;
            if (targetLanguage !== session.source_language) {
              void api<{ translated_text: string }>(`/api/sessions/${session.id}/translate`, { method: 'POST', body: JSON.stringify({ text: text.trim(), target_language: targetLanguage }) })
                .then((result) => saveSegment(start, segmentEnd, result.translated_text, targetLanguage, 'live'))
                .catch(() => onMessage('Live translation is delayed. The original captions remain available.', true));
            }
          }
        }
      } catch { /* ignore non-transcript control frames */ }
    };
    socket.onerror = () => onMessage('Live captions could not connect. The recording will still be available for enhanced processing.', true);
    socket.onclose = () => { setLive(false); setLiveReady(false); };
    processor.onaudioprocess = (event) => {
      if (!liveReady || socket.readyState !== WebSocket.OPEN) return;
      let samples = event.inputBuffer.getChannelData(0);
      const rate = event.inputBuffer.sampleRate;
      if (rate !== 16000) {
        const stride = rate / 16000;
        const downsampled = new Float32Array(Math.floor(samples.length / stride));
        for (let i = 0; i < downsampled.length; i++) downsampled[i] = samples[Math.floor(i * stride)];
        samples = downsampled;
      }
      socket.send(samples.slice().buffer);
    };
    wsRef.current = socket; processorRef.current = processor; contextRef.current = context; streamRef.current = stream;
    setLive(true);
    await context.resume();
    video.play().catch(() => {});
    onMessage('Live captions started. The saved recording remains available for enhanced processing after the talk.');
  };

  useEffect(() => () => { void stopLive(); }, [stopLive]);

  const searchTranscript = async (event: FormEvent) => {
    event.preventDefault();
    if (!search.trim()) return;
    setLoadingSearch(true); setSearched(true);
    try {
      const found = await api<Segment[]>('/api/search', { method: 'POST', body: JSON.stringify({ session_id: session.id, query: search.trim() }) });
      setResults(found);
    } catch (reason) { onMessage(reason instanceof Error ? reason.message : 'Search failed.', true); }
    finally { setLoadingSearch(false); }
  };

  const requestProcessing = async () => {
    try {
      await api(`/api/sessions/${session.id}/jobs`, { method: 'POST' });
      onMessage('The recording is queued. We will show its progress here and publish the transcript when it is ready.');
    } catch (reason) { onMessage(reason instanceof Error ? reason.message : 'Could not queue recording.', true); }
  };

  const vote = async (event: FormEvent) => {
    event.preventDefault();
    if (!primaryPoll || !selectedPoll[primaryPoll.id]) return;
    try {
      await api(`/api/polls/${primaryPoll.id}/vote`, { method: 'POST', body: JSON.stringify({ option_id: selectedPoll[primaryPoll.id] }) });
      setVoted((value) => ({ ...value, [primaryPoll.id]: true }));
      onMessage('Your anonymous response was counted. The system stores poll totals only.');
    } catch (reason) { onMessage(reason instanceof Error ? reason.message : 'Could not submit poll response.', true); }
  };

  const submitInterest = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api(`/api/events/${session.event_id}/interests`, { method: 'POST', body: JSON.stringify({ text: interest }) });
      setInterest(''); onMessage('Thanks. Only aggregate topic counts are retained; your original response is discarded.');
    } catch (reason) { onMessage(reason instanceof Error ? reason.message : 'Could not save interest.', true); }
  };

  const askAboutTalk = async (event: FormEvent) => {
    event.preventDefault(); if (!question.trim()) return;
    setAsking(true); setAnswer('');
    try {
      const result = await api<{ answer: string }>('/api/sessions/' + session.id + '/ask', { method: 'POST', body: JSON.stringify({ question }) });
      setAnswer(result.answer);
    } catch (reason) { onMessage(reason instanceof Error ? reason.message : 'Session Q&A is unavailable.', true); }
    finally { setAsking(false); }
  };

  return <main className="content attendee-layout">
    <section className="page-heading">
      <div><p className="eyebrow">ATTENDEE VIEW · {eventName(session)}</p><h1>Follow the ideas.<br /><em>Keep what matters.</em></h1><p>Watch a session with live captions, choose a translation, and return to important moments later.</p></div>
      <div className="heading-controls"><span className="control-label">YOUR SESSION</span><SessionSelect sessions={sessions} selectedId={selectedId} onChange={setSelectedId} /><span className="attendee-count"><span className="tiny-live" />{session.active_viewers} watching now <small>estimated</small></span></div>
    </section>

    {!session.publish_content && <div className="inline-alert"><strong>Session not published</strong><span>The speaker has opted out of publishing this session.</span></div>}
    <section className="watch-layout">
      <div className="watch-main">
        <div className="video-frame">
          {videoUrl ? <video ref={videoRef} key={videoUrl} controls playsInline src={videoUrl} onEnded={() => { void stopLive(); void requestProcessing(); }} onError={() => onMessage('The session recording could not be played.', true)} /> : <div className="video-placeholder"><div className="play-mark">▶</div><strong>Session video goes here</strong><span>The speaker can upload a recording in the Speaker view.</span></div>}
          <div className="video-badge"><span className="tiny-live" />{liveReady ? 'LIVE CAPTIONS' : 'SESSION RECORDING'}</div>
        </div>
        <div className="session-meta-row"><div><p className="eyebrow">{session.track || 'CONFERENCE SESSION'} · {session.room || 'ROOM TBD'}</p><h2>{session.title}</h2><p className="muted">With {session.speaker_name || 'Speaker'} · {formatTime(session.starts_at)}</p></div><div className="session-actions">{session.has_recording && !live && <button className="button button-accent" onClick={() => void startLive()}>Start live captions</button>}{live && <button className="button button-outline" onClick={() => void stopLive()}>Stop captions</button>}</div></div>
        {session.has_recording && <div className="reliability-note"><span className="note-icon">↻</span><span><strong>Recording is preserved.</strong> If live captions or translation fall behind, enhanced processing runs after the talk. The prototype shows progress and an estimated completion; the 30-minute target still needs load validation.</span></div>}
        <PollCard poll={primaryPoll} selectedId={selectedPoll[primaryPoll?.id ?? ''] ?? 0} voted={voted[primaryPoll?.id ?? ''] ?? false} onSelect={(id) => primaryPoll && setSelectedPoll((current) => ({ ...current, [primaryPoll.id]: id }))} onSubmit={vote} />
        <form className="interest-box" onSubmit={submitInterest}><label htmlFor="interest">What would you like to learn at this conference?</label><div className="inline-form"><input id="interest" maxLength={500} value={interest} onChange={(event) => setInterest(event.target.value)} placeholder="Share a few topics or ideas…" /><button className="button button-dark" disabled={interest.trim().length < 2}>Add interest</button></div><small>We retain aggregate topic counts, not your original answer or contact details.</small></form>
      </div>

      <aside className="transcript-panel">
        <div className="transcript-header"><div><p className="eyebrow">SESSION TRANSCRIPT</p><h2>Follow along</h2></div><span className={`service-chip ${liveReady ? 'chip-live' : 'chip-neutral'}`}>{liveReady ? 'Live' : session.transcription_status.replaceAll('_', ' ')}</span></div>
        <label className="control-label" htmlFor="language">TRANSCRIPT LANGUAGE</label>
        <select id="language" className="language-select" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>{Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}{code === session.source_language ? ' · original' : ''}</option>)}</select>
        {currentJob && <div className={`job-card job-${currentJob.status}`}><div className="job-row"><strong>{currentJob.status === 'completed' ? 'Enhanced transcript ready' : currentJob.status === 'failed' ? 'Processing needs attention' : 'Enhanced transcript processing'}</strong><span>{currentJob.progress}%</span></div><div className="progress-track"><span style={{ width: `${currentJob.progress}%` }} /></div><p>{currentJob.message}</p>{currentJob.status === 'completed' && <small>Available now in {LANGUAGES[session.source_language]}, English, Spanish, and Tagalog where translation succeeded.</small>}</div>}
        <div className="index-freshness"><span className="tiny-live" />Interest matching updates with each saved transcript segment. {session.transcript_updated_at ? `Latest transcript update ${new Date(session.transcript_updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : 'Waiting for transcript text.'}</div>
        <div className="transcript-scroll" aria-live="polite">
          {displayedTranscript.length ? displayedTranscript.map((segment) => <button className="transcript-line" key={`${segment.id}-${segment.start_seconds}`} onClick={() => { if (videoRef.current) videoRef.current.currentTime = segment.start_seconds; }}><time>{formatTimestamp(segment.start_seconds)}</time><span>{segment.text}{segment.edited_by_speaker && <small className="edited-note"> · speaker edit, AI-reviewed</small>}</span></button>) : <div className="transcript-empty"><span className="empty-wave">≋</span><strong>{session.has_recording ? 'Your transcript will appear here' : 'No transcript yet'}</strong><p>Play the session video and start captions, or ask the speaker to upload the recording.</p></div>}
        </div>
        {currentJob?.status === 'queued' && <div className="queue-note"><span>In processing queue</span><small>Position is based on session engagement; it updates as jobs change.</small></div>}
        <form className="search-form" onSubmit={searchTranscript}><label className="control-label" htmlFor="transcript-search">SEARCH THIS TALK</label><div className="search-input-wrap"><span>⌕</span><input id="transcript-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a topic or phrase" /><button disabled={!search.trim() || loadingSearch} aria-label="Search transcript">{loadingSearch ? '…' : '↗'}</button></div></form>
        {searched && <div className="search-results"><div className="result-heading">{results.length} {results.length === 1 ? 'match' : 'matches'}{results.length ? '' : ' · try another phrase'}</div>{results.map((result) => <button key={`${result.id}-${result.start_seconds}`} className="search-result" onClick={() => { if (videoRef.current) videoRef.current.currentTime = result.start_seconds; }}><time>{formatTimestamp(result.start_seconds)}</time><span>{highlight(result.text, search)}</span></button>)}</div>}
      </aside>
    </section>

    <section className="lower-grid"><article className="info-card"><span className="eyebrow">ASK THIS TALK · OPTIONAL AI</span><h3>Find an answer in the session.</h3><p>Answers are grounded in published transcript passages and should include timestamps. This feature needs an OpenAI API key.</p><form className="inline-form" onSubmit={askAboutTalk}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about an idea from this talk…" /><button className="button button-dark" disabled={asking || question.trim().length < 3}>{asking ? 'Looking…' : 'Ask'}</button></form>{answer && <div className="ai-answer">{answer}</div>}</article><FeedbackCard sessionId={session.id} onMessage={onMessage} /></section>
  </main>;
}

function SpeakerView({ session, sessions, selectedId, setSelectedId, transcript, jobs, polls, onMessage, onRefresh }: {
  session: Session; sessions: Session[]; selectedId: string; setSelectedId: (id: string) => void; transcript: Segment[];
  jobs: Job[]; polls: Poll[]; onMessage: (message: string, error?: boolean) => void; onRefresh: () => Promise<void>;
}) {
  const [form, setForm] = useState({ title: session.title, description: session.description, speaker_name: session.speaker_name, track: session.track, room: session.room, source_language: session.source_language, publish_content: session.publish_content });
  const [uploading, setUploading] = useState(false);
  const [question, setQuestion] = useState('');
  const [kind, setKind] = useState<'multiple_choice' | 'true_false'>('multiple_choice');
  const [choices, setChoices] = useState('Choice A, Choice B');
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [editBusy, setEditBusy] = useState<number | null>(null);
  useEffect(() => setForm({ title: session.title, description: session.description, speaker_name: session.speaker_name, track: session.track, room: session.room, source_language: session.source_language, publish_content: session.publish_content }), [session.id]);
  const saveSession = async (event: FormEvent) => {
    event.preventDefault();
    try { await api(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify(form) }); await onRefresh(); onMessage('Session details saved.'); }
    catch (reason) { onMessage(reason instanceof Error ? reason.message : 'Could not save session.', true); }
  };
  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('recording') as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    const body = new FormData(); body.append('file', file); setUploading(true);
    try { await api(`/api/sessions/${session.id}/media`, { method: 'POST', body }); await onRefresh(); input.value = ''; onMessage('Recording saved. It can now play in the attendee session view and be queued for enhanced processing.'); }
    catch (reason) { onMessage(reason instanceof Error ? reason.message : 'Upload failed.', true); }
    finally { setUploading(false); }
  };
  const queueProcessing = async () => {
    try { await api(`/api/sessions/${session.id}/jobs`, { method: 'POST' }); onMessage('Recording added to the priority processing queue.'); }
    catch (reason) { onMessage(reason instanceof Error ? reason.message : 'Could not queue recording.', true); }
  };
  const createPoll = async (event: FormEvent) => {
    event.preventDefault();
    const options = kind === 'true_false' ? [] : choices.split(',').map((item) => item.trim()).filter(Boolean);
    try { const poll = await api<Poll>(`/api/sessions/${session.id}/polls`, { method: 'POST', body: JSON.stringify({ question, kind, options }) }); await api(`/api/polls/${poll.id}/activate`, { method: 'POST' }); setQuestion(''); onMessage('Anonymous poll created and opened. Only aggregate choice counts are stored.'); }
    catch (reason) { onMessage(reason instanceof Error ? reason.message : 'Could not create poll.', true); }
  };
  const reviewEdit = async (segment: Segment) => {
    const text = edits[segment.id]?.trim(); if (!text) return;
    setEditBusy(segment.id);
    try { const result = await api<{ approved: boolean; note: string }>(`/api/segments/${segment.id}/speaker-edit`, { method: 'POST', body: JSON.stringify({ text }) }); onMessage(result.approved ? `Edit approved: ${result.note}` : `Edit not applied: ${result.note}`, !result.approved); }
    catch (reason) { onMessage(reason instanceof Error ? reason.message : 'AI review is unavailable.', true); }
    finally { setEditBusy(null); }
  };
  const activeJob = jobs.find((job) => job.status === 'queued' || job.status === 'processing');

  return <main className="content">
    <section className="page-heading compact-heading"><div><p className="eyebrow">SPEAKER VIEW · SESSION MANAGEMENT</p><h1>Your talk,<br /><em>your voice.</em></h1><p>Update your session, preserve the recording, and see what attendees will experience.</p></div><div className="heading-controls"><span className="control-label">YOUR SESSION</span><SessionSelect sessions={sessions} selectedId={selectedId} onChange={setSelectedId} /></div></section>
    <div className="speaker-grid">
      <section className="panel-card"><div className="panel-title"><div><p className="eyebrow">SESSION DETAILS</p><h2>Edit your session</h2></div><span className="role-badge">SPEAKER</span></div>
        <form className="field-grid" onSubmit={saveSession}>
          <label className="field full-field">Session title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className="field full-field">Description<textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label className="field">Speaker name<input value={form.speaker_name} onChange={(e) => setForm({ ...form, speaker_name: e.target.value })} /></label>
          <label className="field">Track<input value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value })} /></label>
          <label className="field">Room<input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} /></label>
          <label className="field">Talk language<select value={form.source_language} onChange={(e) => setForm({ ...form, source_language: e.target.value as Language })}>{Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
          <label className="publish-choice full-field"><input type="checkbox" checked={form.publish_content} onChange={(e) => setForm({ ...form, publish_content: e.target.checked })} /><span><strong>Publish this talk and its materials by default</strong><small>Uncheck to opt out. The recording is still retained for processing and is not shown to attendees.</small></span></label>
          <button className="button button-dark" type="submit">Save session details</button>
        </form>
      </section>

      <section className="panel-card"><div className="panel-title"><div><p className="eyebrow">RECORDING & PROCESSING</p><h2>Preserve the whole talk</h2></div><span className={`service-chip ${session.has_recording ? 'chip-ready' : 'chip-neutral'}`}>{session.has_recording ? 'Recording saved' : 'Needs recording'}</span></div>
        <p className="muted">If live captions or translation are delayed, the saved recording can be processed afterward with a stronger model. The project target is availability within 30 minutes; actual timing depends on recording length and compute capacity.</p>
        <form className="upload-form" onSubmit={upload}><label htmlFor="recording-file" className="upload-drop"><span className="upload-icon">↑</span><strong>Upload the session recording</strong><small>MP4, MOV, WebM, MP3, WAV, M4A, AAC, OGG · up to 1 GB in this demo</small><input id="recording-file" name="recording" type="file" accept="video/mp4,video/quicktime,video/webm,audio/*" required /></label><button className="button button-accent" disabled={uploading}>{uploading ? 'Uploading…' : 'Save recording'}</button></form>
        {session.has_recording && <div className="processing-action"><div><strong>Enhanced transcript</strong><small>{activeJob ? activeJob.message : 'Queue transcription, translation, and search indexing.'}</small></div><button className="button button-outline" onClick={() => void queueProcessing()} disabled={Boolean(activeJob)}>{activeJob ? `${activeJob.progress}%` : 'Process recording'}</button></div>}
        {activeJob && <div className="progress-track"><span style={{ width: `${activeJob.progress}%` }} /></div>}
        <div className="language-tags"><span>EN · English</span><span>ES · Spanish</span><span>TL · Tagalog</span></div>
      </section>

      <section className="panel-card"><div className="panel-title"><div><p className="eyebrow">AUDIENCE PARTICIPATION</p><h2>Ask a quick question</h2></div><span className="role-badge">ANONYMOUS</span></div>
        <form className="poll-builder" onSubmit={createPoll}><label className="field">Question<input required value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What should we explore next?" /></label><label className="field">Answer format<select value={kind} onChange={(e) => setKind(e.target.value as 'multiple_choice' | 'true_false')}><option value="multiple_choice">Multiple choice</option><option value="true_false">True or false</option></select></label>{kind === 'multiple_choice' && <label className="field">Choices, separated by commas<input value={choices} onChange={(e) => setChoices(e.target.value)} /></label>}<button className="button button-dark">Create and show poll</button></form>
        <p className="privacy-footnote">The system stores only aggregate counts per choice; it does not retain who selected each answer.</p>
        {polls.map((poll) => <div className="poll-summary" key={poll.id}><div><strong>{poll.question}</strong><small>{poll.total_votes} anonymous responses · {poll.active ? 'live' : 'closed'}</small></div><button className="text-button" onClick={() => void api(`/api/polls/${poll.id}/${poll.active ? 'close' : 'activate'}`, { method: 'POST' }).then(() => onMessage(poll.active ? 'Poll closed.' : 'Poll is live.')).catch((e) => onMessage(e.message, true))}>{poll.active ? 'Close' : 'Open'}</button></div>)}
      </section>

      <section className="panel-card transcript-review"><div className="panel-title"><div><p className="eyebrow">TRANSCRIPT REVIEW</p><h2>Corrections with a clear history</h2></div><span className="service-chip chip-neutral">{transcript.length} lines</span></div><p className="muted">AI reviews each speaker correction before it is applied. Published text marks lines that have been edited by a speaker.</p>{transcript.length ? transcript.slice(0, 6).map((segment) => <div className="edit-row" key={segment.id}><div><span className="time-tag">{formatTimestamp(segment.start_seconds)}</span><p>{segment.text}</p>{segment.edited_by_speaker && <small>Speaker edit · AI reviewed</small>}</div><label className="field">Propose correction<textarea rows={2} value={edits[segment.id] ?? ''} onChange={(e) => setEdits({ ...edits, [segment.id]: e.target.value })} placeholder="Edit this transcript line…" /></label><button className="button button-outline" disabled={!edits[segment.id]?.trim() || editBusy === segment.id} onClick={() => void reviewEdit(segment)}>{editBusy === segment.id ? 'Reviewing…' : 'Submit for AI review'}</button></div>) : <div className="subtle-empty">Transcript lines will appear here after live or enhanced processing.</div>}</section>
    </div>
  </main>;
}

function OrganizerView({ event, overview, interests, onRefresh, onMessage }: { event: { id: string; title: string; description: string }; overview: Overview | null; interests: { topic: string; count: number }[]; onRefresh: () => Promise<void>; onMessage: (message: string, error?: boolean) => void }) {
  const [advanced, setAdvanced] = useState(false);
  const [interestSummary, setInterestSummary] = useState('');
  const [feedback, setFeedback] = useState<Record<string, { rating: number; count: number }[]>>({});
  useEffect(() => {
    const load = async () => {
      if (!overview?.sessions.length) return;
      const entries = await Promise.all(overview.sessions.map(async (session) => [session.id, await api<{ rating: number; count: number }[]>(`/api/sessions/${session.id}/feedback`).catch(() => [])] as const));
      setFeedback(Object.fromEntries(entries));
    };
    void load();
  }, [overview?.sessions]);
  const queue = overview?.jobs ?? [];
  const serviceWarning = Object.entries(overview?.services ?? {}).filter(([, status]) => ['unavailable', 'degraded'].includes(status));
  return <main className="content">
    <section className="page-heading compact-heading"><div><p className="eyebrow">ORGANIZER VIEW · EVENT OPERATIONS</p><h1>Know what’s happening.<br /><em>Act while it matters.</em></h1><p>{event.title} · Live engagement, processing status, and service health in one place.</p></div><div className="heading-controls"><span className="service-chip chip-live">UPDATING LIVE</span><button className="button button-outline" onClick={() => void onRefresh()}>Refresh</button></div></section>
    {serviceWarning.length > 0 && <div className="inline-alert alert-warning"><strong>Service needs attention</strong><span>{serviceWarning.map(([name]) => name).join(', ')} is unavailable or degraded. Recordings remain queued for post-talk processing.</span></div>}
    <section className="metric-grid"><Metric label="Watching now" value={overview?.counts.active_viewers ?? 0} hint="Anonymous, expiring session estimate" icon="◉" /><Metric label="Queued recordings" value={overview?.counts.queued_jobs ?? 0} hint="Higher-engagement sessions are prioritized" icon="↗" /><Metric label="Processing now" value={overview?.counts.processing_jobs ?? 0} hint="Enhanced transcription and translation" icon="◌" /><Metric label="Ready to revisit" value={overview?.counts.completed_jobs ?? 0} hint="Completed post-talk jobs" icon="✓" /></section>

    <div className="organizer-grid"><section className="panel-card"><div className="panel-title"><div><p className="eyebrow">LIVE SESSION BOARD</p><h2>Session readiness</h2></div><span className="muted small">Refreshes every 5 seconds</span></div><div className="table-wrap"><table><thead><tr><th>SESSION</th><th>ROOM</th><th>WATCHING</th><th>TRANSCRIPT</th><th>INTEREST MATCHES</th><th>PUBLICATION</th></tr></thead><tbody>{overview?.sessions.map((session) => <tr key={session.id}><td><strong>{session.title}</strong><small>{session.speaker_name} · max observed {session.max_viewers}</small></td><td>{session.room || '—'}</td><td><span className="viewer-count"><span className="tiny-live" />{session.active_viewers}</span></td><td><span className={`service-chip ${session.transcription_status === 'completed' ? 'chip-ready' : session.transcription_status === 'failed' ? 'chip-error' : 'chip-neutral'}`}>{session.transcription_status.replaceAll('_', ' ')}</span></td><td>{session.interest_mentions}</td><td>{session.publish_content ? 'Published' : 'Speaker opted out'}</td></tr>)}</tbody></table></div></section>

      <section className="panel-card"><div className="panel-title"><div><p className="eyebrow">AUDIENCE INTERESTS</p><h2>Topics attendees mentioned</h2></div><span className="role-badge">AGGREGATE ONLY</span></div>{interests.length ? <div className="topic-list">{interests.slice(0, 12).map((item) => <div className="topic-row" key={item.topic}><span>{item.topic}</span><div className="topic-meter"><i style={{ width: `${Math.max(8, (item.count / interests[0].count) * 100)}%` }} /></div><strong>{item.count}</strong></div>)}</div> : <p className="muted">No interest topics yet. Attendees can share optional learning interests from their session page.</p>}<button className="text-button ai-summary-button" onClick={() => api<{ summary: string }>(`/api/events/${event.id}/interest-summary`, { method: 'POST' }).then((result) => setInterestSummary(result.summary)).catch((reason) => onMessage(reason.message, true))}>Summarize aggregate themes with OpenAI ↗</button>{interestSummary && <div className="ai-answer">{interestSummary}</div>}</section>

      <section className="panel-card queue-panel"><div className="panel-title"><div><p className="eyebrow">RECORDING QUEUE</p><h2>Talks that still need processing</h2></div><span className="service-chip chip-neutral">{queue.length} recent</span></div>{queue.length ? <div className="queue-list">{queue.map((job) => <div className="queue-item" key={job.id}><span className={`queue-state state-${job.status}`} /> <div className="queue-copy"><strong>{overview?.sessions.find((item) => item.id === job.session_id)?.title ?? 'Conference session'}</strong><small>{job.message}</small></div><span className="priority-tag">priority {job.priority ?? 0}</span><span className="queue-percent">{job.progress}%</span></div>)}</div> : <p className="muted">No recording jobs have been queued.</p>}</section>

      <section className="panel-card"><div className="panel-title"><div><p className="eyebrow">SESSION FEEDBACK</p><h2>Aggregate ratings</h2></div></div>{overview?.sessions.map((session) => { const ratings = feedback[session.id] ?? []; const total = ratings.reduce((sum, item) => sum + item.count, 0); const average = total ? (ratings.reduce((sum, item) => sum + item.rating * item.count, 0) / total).toFixed(1) : '—'; return <div className="feedback-summary" key={session.id}><div><strong>{session.title}</strong><small>{total} anonymous responses</small></div><b>{average}<small> / 5</small></b></div>; })}</section></div>

    <section className="dash0-strip"><div className="dash0-symbol">d0</div><div className="dash0-copy"><span className="eyebrow">DASH0 · OBSERVABILITY</span><strong>Operational telemetry is ready to connect</strong><p>The API and worker emit OpenTelemetry traces and queue/viewer metrics when OTLP settings are configured. This local overview shows product activity; container CPU, memory, and GPU charts belong in the Dash0 operator dashboard.</p></div><div className="dash0-stat"><small>Backend process</small><strong>{overview?.compute ? `${overview.compute.backend_cpu_percent.toFixed(0)}% CPU · ${overview.compute.backend_memory_mb} MB` : 'Telemetry configured by environment'}</strong></div></section>
    <div className="advanced-toggle"><button className="text-button" onClick={() => setAdvanced(!advanced)}>{advanced ? 'Hide' : 'Open'} advanced operator view {advanced ? '↑' : '↓'}</button><span>Technical details for the person operating the platform</span></div>
    {advanced && <section className="advanced-grid"><div className="panel-card"><p className="eyebrow">CONNECTED SERVICES</p><div className="service-list">{Object.entries(overview?.services ?? {}).map(([name, status]) => <div key={name}><span className={`status-indicator ${status === 'available' || status === 'configured' ? 'is-up' : status.includes('optional') ? 'is-optional' : 'is-down'}`} /><strong>{name}</strong><span>{status.replaceAll('_', ' ')}</span></div>)}</div><p className="muted">WhisperLive active clients: {overview?.compute?.whisperlive.active_clients ?? '—'} / {overview?.compute?.whisperlive.max_clients ?? '—'}</p></div><div className="panel-card"><p className="eyebrow">CAPACITY ACTIONS</p><h3>When the queue grows</h3><p className="muted">The prototype preserves recordings and prioritizes jobs by the largest observed audience. Live transcript availability stays separate from the enhanced post-talk queue.</p><div className="feature-line"><span>1</span> Keep original-language captions first</div><div className="feature-line"><span>2</span> Queue saved talks for stronger processing</div><div className="feature-line"><span>3</span> Notify users in the session page when ready</div></div></section>}
  </main>;
}

function Metric({ label, value, hint, icon }: { label: string; value: number; hint: string; icon: string }) {
  return <article className="metric-card"><div className="metric-icon">{icon}</div><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{hint}</small></article>;
}

function PollCard({ poll, selectedId, voted, onSelect, onSubmit }: { poll?: Poll; selectedId: number; voted: boolean; onSelect: (id: number) => void; onSubmit: (event: FormEvent) => void }) {
  if (!poll) return <div className="poll-empty"><span className="eyebrow">AUDIENCE POLL</span><p>No poll is active for this session right now.</p></div>;
  return <form className="poll-card" onSubmit={onSubmit}><div className="poll-card-heading"><div><span className="eyebrow">QUICK POLL</span><h3>{poll.question}</h3></div><span className="role-badge">ANONYMOUS</span></div>{poll.options.map((option) => <label className={`poll-option ${selectedId === option.id ? 'selected' : ''}`} key={option.id}><input type="radio" name={`poll-${poll.id}`} checked={selectedId === option.id} onChange={() => onSelect(option.id)} disabled={voted} /><span className="radio-dot" /><span>{option.label}</span>{voted && <strong>{poll.total_votes ? Math.round((option.votes / poll.total_votes) * 100) : 0}%</strong>}</label>)}<div className="poll-bottom"><small>{voted ? `${poll.total_votes} anonymous responses · results update live` : 'Your choice is counted without saving who you are.'}</small>{!voted && <button className="button button-outline" disabled={!selectedId}>Submit answer</button>}</div></form>;
}

function FeedbackCard({ sessionId, onMessage }: { sessionId: string; onMessage: (message: string, error?: boolean) => void }) {
  const [rating, setRating] = useState(0); const [submitted, setSubmitted] = useState(false);
  const submit = async () => { if (!rating) return; try { await api(`/api/sessions/${sessionId}/feedback`, { method: 'POST', body: JSON.stringify({ rating }) }); setSubmitted(true); onMessage('Thanks. Your rating was added to the anonymous aggregate.'); } catch (e) { onMessage(e instanceof Error ? e.message : 'Could not submit feedback.', true); } };
  return <article className="info-card feedback-card"><span className="eyebrow">OPTIONAL FEEDBACK</span><h3>Was this session useful?</h3><p>Your individual answer is not retained; only the rating total is.</p><div className="rating-row" role="group" aria-label="Rate the session">{[1, 2, 3, 4, 5].map((value) => <button key={value} className={value <= rating ? 'rating-selected' : ''} onClick={() => setRating(value)} aria-label={`${value} out of 5`}>★</button>)}<button className="button button-dark" onClick={() => void submit()} disabled={!rating || submitted}>{submitted ? 'Submitted' : 'Send rating'}</button></div></article>;
}

function eventName(session: Session) { return session.event_id === 'demo-event' ? 'CONFERENCE COMPANION DEMO' : 'CONFERENCE'; }

function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return text;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
}
