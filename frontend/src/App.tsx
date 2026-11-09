import { Fragment, FormEvent, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

type Role = 'attendee' | 'speaker' | 'organizer';
type Language = 'en' | 'es' | 'tl';
type Theme = 'dark' | 'light';
type LiveState = 'idle' | 'connecting' | 'live';
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
type ConferenceEvent = { id: string; title: string; description: string };
type Notify = (message: string, error?: boolean) => void;
/** The caption line still being heard: `confirmed` words have been stable across two interim results. */
type Interim = { start: number; end: number; text: string; confirmed: number };
type Outage = { start: number; language: Language };
type FeedLine = { key: string; start: number; end: number; text: string; outage?: boolean; edited?: boolean };

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

type ClientEventName = 'session_joined' | 'transcript_delay' | 'translation_unavailable' | 'media_playback_error' | 'websocket_disconnect';

function deviceCategory(): 'mobile' | 'tablet' | 'desktop' | 'unknown' {
  try {
    if (!window.matchMedia('(pointer: coarse)').matches) return 'desktop';
    return Math.min(window.screen.width, window.screen.height) >= 600 ? 'tablet' : 'mobile';
  } catch { return 'unknown'; }
}

/**
 * Report an allowlisted operational event for Dash0. Only the event name, a coarse
 * device category and (for delays) a number of seconds are sent: never transcript
 * text, session content or anything identifying. Failures are ignored.
 */
function reportClientEvent(name: ClientEventName, valueSeconds?: number) {
  const body = JSON.stringify({ name, device: deviceCategory(), ...(valueSeconds === undefined ? {} : { value_seconds: Math.max(0, valueSeconds) }) });
  void fetch('/api/telemetry/client-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

const LANGUAGES: Record<Language, string> = { en: 'English', es: 'Spanish', tl: 'Tagalog' };
const LANGUAGE_CODES = Object.keys(LANGUAGES) as Language[];
const ROLES: Role[] = ['attendee', 'speaker', 'organizer'];
const THEME_KEY = 'curator-theme';
const JOB_LABELS: Record<string, string> = {
  queued: 'Enhanced transcript queued',
  processing: 'Enhanced transcript processing',
  completed: 'Enhanced transcript ready',
  failed: 'Enhanced transcript needs attention',
};
const formatTime = (value?: string) => value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Time TBA';
const formatTimestamp = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const errorText = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;

function readTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

function statusClass(status: string) {
  if (['completed', 'available', 'configured'].includes(status)) return 'is-ready';
  if (['failed', 'unavailable', 'degraded'].includes(status)) return 'is-error';
  if (['live', 'processing'].includes(status)) return 'is-live';
  return '';
}

export default function App() {
  const [role, setRole] = useState<Role>('attendee');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [liveState, setLiveState] = useState<LiveState>('idle');
  const [event, setEvent] = useState<ConferenceEvent | null>(null);
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

  const loadSessions = useCallback(async () => {
    try {
      const events = await api<ConferenceEvent[]>('/api/events');
      const currentEvent = events[0];
      if (!currentEvent) return;
      setEvent(currentEvent);
      const nextSessions = await api<Session[]>(`/api/events/${currentEvent.id}/sessions`);
      setSessions(nextSessions);
      setSelectedId((current) => current || nextSessions[0]?.id || '');
      setError('');
    } catch (reason) {
      setError(errorText(reason, 'Could not connect to the conference service.'));
    }
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const data = await api<Overview>('/api/operator/overview');
      setOverview(data);
      setSessions(data.sessions);
    } catch { /* keep the last successful dashboard snapshot */ }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0C0A09' : '#FAF9F7');
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private browsing: the theme lasts for this visit only */ }
  }, [theme]);
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
        if (alive) setError(errorText(reason, 'Could not load session data.'));
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
    reportClientEvent('session_joined');
    const timer = window.setInterval(ping, 25000);
    return () => { window.clearInterval(timer); void api(`/api/sessions/${selectedId}/viewers/leave`, { method: 'POST', body: JSON.stringify({ viewer_token: viewerToken }) }).catch(() => {}); };
  }, [role, selectedId]);

  const flash: Notify = (message, isError = false) => {
    setNotice(message); setError(isError ? message : '');
    window.setTimeout(() => setNotice(''), 5000);
  };

  const liveLabel = liveState === 'live' ? 'LIVE' : liveState === 'connecting' ? 'STARTING' : 'IDLE';

  return (
    <div className="app-shell">
      <header className="curator-header">
        <div className="wordmark">Curator</div>
        <div className="header-controls">
          {role === 'attendee' && <div className="seg-toggle" role="group" aria-label="Transcript language">
            {LANGUAGE_CODES.map((code) => <button key={code} type="button" className={language === code ? 'active' : ''} aria-pressed={language === code} title={LANGUAGES[code]} onClick={() => setLanguage(code)}>{code.toUpperCase()}</button>)}
          </div>}
          <button type="button" className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? '☀' : '☾'}</button>
          {role === 'attendee' && <span className={`live-status${liveState === 'live' ? ' on' : ''}`} role="status"><span className="dot" /><span className="live-label">{liveLabel}</span></span>}
        </div>
      </header>

      <nav className="view-bar" aria-label="Choose view">
        <div className="seg-toggle seg-fill">
          {ROLES.map((item) => <button key={item} type="button" className={role === item ? 'active' : ''} aria-pressed={role === item} onClick={() => setRole(item)}>{item}</button>)}
        </div>
      </nav>

      {(notice || error) && <div className={`notice${error ? ' notice-error' : ''}`} role="status"><span>{error || notice}</span><button type="button" onClick={() => { setError(''); setNotice(''); }} aria-label="Dismiss">×</button></div>}

      {error && !sessions.length ? <main className="empty-state"><h1>Can’t reach the conference service</h1><p>{error}</p><button type="button" className="btn-primary" onClick={() => void loadSessions()}>Try again</button></main> : <>
        {role !== 'organizer' && !session && <main className="empty-state"><p>{event ? 'No sessions yet.' : 'Loading sessions…'}</p></main>}
        {role === 'attendee' && session && <AttendeeView key={session.id} session={session} sessions={sessions} selectedId={selectedId} setSelectedId={setSelectedId} language={language} transcript={transcript} setTranscript={setTranscript} jobs={jobs} polls={polls} liveState={liveState} setLiveState={setLiveState} onMessage={flash} />}
        {role === 'speaker' && session && <SpeakerView key={session.id} session={session} sessions={sessions} selectedId={selectedId} setSelectedId={setSelectedId} transcript={transcript} jobs={jobs} polls={polls} onMessage={flash} onRefresh={loadSessions} />}
        {role === 'organizer' && event && <OrganizerView event={event} overview={overview} interests={interests} onRefresh={loadOverview} onMessage={flash} />}
      </>}

      <footer className="app-footer"><span>CURATOR · PROTOTYPE</span><a href="/api/health" target="_blank" rel="noreferrer">Service health ↗</a></footer>
    </div>
  );
}

function SessionSelect({ sessions, selectedId, onChange }: { sessions: Session[]; selectedId: string; onChange: (id: string) => void }) {
  return <select className="session-select" value={selectedId} onChange={(event) => onChange(event.target.value)} aria-label="Choose a session">
    {sessions.map((session) => <option value={session.id} key={session.id}>{session.title}</option>)}
  </select>;
}

function nextInterim(previous: Interim | null, next: Interim, completed: boolean): Interim {
  const words = next.text.split(/\s+/);
  if (completed) return { ...next, confirmed: words.length };
  if (!previous || Math.abs(previous.start - next.start) >= 0.3) return next;
  const before = previous.text.split(/\s+/);
  let same = 0;
  while (same < words.length && same < before.length && words[same] === before[same]) same += 1;
  return { ...next, confirmed: same };
}

function karaoke(text: string, on: number) {
  return text.trim().split(/\s+/).map((word, index) => <Fragment key={index}>{index > 0 && ' '}<span className={index < on ? 'w on' : 'w'}>{word}</span></Fragment>);
}

function AttendeeView({ session, sessions, selectedId, setSelectedId, language, transcript, setTranscript, jobs, polls, liveState, setLiveState, onMessage }: {
  session: Session; sessions: Session[]; selectedId: string; setSelectedId: (id: string) => void; language: Language;
  transcript: Segment[]; setTranscript: Dispatch<SetStateAction<Segment[]>>; jobs: Job[]; polls: Poll[];
  liveState: LiveState; setLiveState: (state: LiveState) => void; onMessage: Notify;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const languageRef = useRef(language);
  const readyRef = useRef(false);
  /** Video time when audio started streaming to WhisperLive, for measuring caption delay. */
  const audioStartRef = useRef<number | null>(null);
  const lastDelayEndRef = useRef(-1);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [interim, setInterim] = useState<Interim | null>(null);
  const [outages, setOutages] = useState<Outage[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Segment[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedOption, setSelectedOption] = useState<Record<string, number>>({});
  const [voted, setVoted] = useState<Record<string, boolean>>({});
  const [interest, setInterest] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const live = liveState !== 'idle';
  const query = search.trim();
  const source = session.source_language;
  const primaryPoll = polls.find((poll) => poll.active);
  const currentJob = jobs.find((job) => job.status === 'queued' || job.status === 'processing') ?? jobs[0];
  const videoUrl = session.has_recording && session.publish_content ? `/api/sessions/${session.id}/media?role=attendee` : '';

  useEffect(() => { languageRef.current = language; }, [language]);

  const setFollow = (value: boolean) => { followRef.current = value; setFollowing(value); };

  const saveSegment = useCallback(async (start: number, end: number, text: string, lang: Language, origin: 'live' | 'enhanced' = 'live') => {
    if (!text.trim()) return;
    try {
      const saved = await api<Segment>(`/api/sessions/${session.id}/segments`, { method: 'POST', body: JSON.stringify({ start_seconds: start, end_seconds: end, text: text.trim(), language: lang, source: origin }) });
      if (lang !== languageRef.current) return;
      setTranscript((previous) => {
        const next = previous.filter((segment) => !(segment.language === lang && Math.abs(segment.start_seconds - start) < 0.3));
        return [...next, saved].sort((a, b) => a.start_seconds - b.start_seconds);
      });
    } catch { /* keep the live captions visible even if persistence is temporarily unavailable */ }
  }, [session.id, setTranscript]);

  const stopLive = useCallback(async () => {
    const processor = processorRef.current;
    const socket = wsRef.current;
    readyRef.current = false;
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); processorRef.current = null; }
    try { if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode('END_OF_AUDIO')); } catch { /* closing */ }
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    if (contextRef.current && contextRef.current.state !== 'closed') await contextRef.current.close().catch(() => {});
    contextRef.current = null; wsRef.current = null; setInterim(null); setLiveState('idle');
  }, [setLiveState]);

  const startLive = async () => {
    const video = videoRef.current as (HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }) | null;
    const capture = video?.captureStream ?? video?.mozCaptureStream;
    if (!video || !capture) { onMessage('This browser can’t capture audio from the video. Try a current Chrome or Firefox.', true); return; }
    const stream = capture.call(video);
    if (!stream.getAudioTracks().length) { onMessage('This recording has no audio track.', true); return; }
    const context = new AudioContext({ sampleRate: 16000 });
    const input = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const gain = context.createGain(); gain.gain.value = 1;
    input.connect(processor); processor.connect(gain); gain.connect(context.destination);
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/whisper`);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => socket.send(JSON.stringify({ uid: crypto.randomUUID(), language: source, task: 'transcribe', model: 'small', use_vad: true, send_last_n_segments: 1, enable_translation: false }));
    socket.onmessage = (message) => {
      try {
        const data = JSON.parse(message.data as string);
        if (data.message === 'SERVER_READY') {
          readyRef.current = true; setLiveState('live');
          audioStartRef.current = videoRef.current?.currentTime ?? null; lastDelayEndRef.current = -1;
          return;
        }
        const segments = Array.isArray(data.segments) ? data.segments : [];
        let latest: Interim | null = null;
        let latestDone = false;
        for (const item of segments) {
          const text = typeof item.text === 'string' ? item.text.trim() : '';
          if (!text) continue;
          const start = Number(item.start ?? item.start_time ?? 0);
          const end = Math.max(start, Number(item.end ?? item.end_time ?? start));
          void saveSegment(start, end, text, source, 'live');
          const target = languageRef.current;
          if (target !== source) {
            void api<{ translated_text: string }>(`/api/sessions/${session.id}/translate`, { method: 'POST', body: JSON.stringify({ text, target_language: target }) })
              .then((result) => saveSegment(start, end, result.translated_text, target, 'live'))
              .catch(() => {
                reportClientEvent('translation_unavailable');
                setOutages((list) => list.some((entry) => entry.language === target && Math.abs(entry.start - start) < 30) ? list : [...list, { start, language: target }]);
              });
          }
          // Caption delay: how far the video has played past the end of this finished
          // segment. Audio offsets are relative to when streaming started.
          const audioStart = audioStartRef.current;
          const playing = videoRef.current;
          if (item.completed === true && audioStart !== null && playing && end > lastDelayEndRef.current) {
            lastDelayEndRef.current = end;
            const delay = (playing.currentTime - audioStart) - end;
            if (Number.isFinite(delay) && delay >= 0) reportClientEvent('transcript_delay', delay);
          }
          latest = { start, end, text, confirmed: 0 };
          latestDone = item.completed === true;
        }
        if (latest) {
          const next = latest;
          const done = latestDone;
          setInterim((previous) => nextInterim(previous, next, done));
        }
      } catch { /* ignore non-transcript control frames */ }
    };
    socket.onerror = () => onMessage('Live captions couldn’t connect. The recording is still available.', true);
    socket.onclose = () => {
      // wsRef still points at this socket only when the close wasn't started by stopLive.
      if (wsRef.current === socket) { reportClientEvent('websocket_disconnect'); void stopLive(); }
    };
    processor.onaudioprocess = (audio) => {
      if (!readyRef.current || socket.readyState !== WebSocket.OPEN) return;
      let samples = audio.inputBuffer.getChannelData(0);
      const rate = audio.inputBuffer.sampleRate;
      if (rate !== 16000) {
        const stride = rate / 16000;
        const downsampled = new Float32Array(Math.floor(samples.length / stride));
        for (let i = 0; i < downsampled.length; i++) downsampled[i] = samples[Math.floor(i * stride)];
        samples = downsampled;
      }
      socket.send(samples.slice().buffer);
    };
    wsRef.current = socket; processorRef.current = processor; contextRef.current = context; streamRef.current = stream;
    setLiveState('connecting');
    setFollow(true);
    await context.resume();
    video.play().catch(() => {});
  };

  useEffect(() => () => { void stopLive(); }, [stopLive]);

  useEffect(() => {
    if (query.length < 2) { setResults(null); setSearching(false); return; }
    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api<Segment[]>('/api/search', { method: 'POST', body: JSON.stringify({ session_id: session.id, query }) })
        .then((found) => { if (alive) setResults(found); })
        .catch((reason) => { if (alive) { setResults([]); onMessage(errorText(reason, 'Search failed.'), true); } })
        .finally(() => { if (alive) setSearching(false); });
    }, 300);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query, session.id]);

  const lines = useMemo(() => {
    const showInterim = interim && language === source ? interim : null;
    const list: FeedLine[] = transcript
      .filter((segment) => !showInterim || Math.abs(segment.start_seconds - showInterim.start) >= 0.3)
      .map((segment) => ({ key: `s-${segment.id}-${segment.start_seconds}`, start: segment.start_seconds, end: segment.end_seconds, text: segment.text, edited: segment.edited_by_speaker }));
    if (showInterim) list.push({ key: 'interim', start: showInterim.start, end: showInterim.end, text: showInterim.text });
    for (const outage of outages) {
      if (outage.language !== language) continue;
      list.push({ key: `outage-${outage.language}-${outage.start}`, start: outage.start, end: outage.start, outage: true, text: `${LANGUAGES[outage.language]} translation fell behind. ${LANGUAGES[source]} captions are still saved; switch to ${source.toUpperCase()} to keep following.` });
    }
    return list.sort((a, b) => a.start - b.start || Number(Boolean(a.outage)) - Number(Boolean(b.outage)));
  }, [transcript, interim, outages, language, source]);

  // The active line: the interim caption while live, otherwise the line at the video's playhead.
  const active = useMemo(() => {
    if (interim && live && language === source) return { key: 'interim', on: interim.confirmed };
    if (currentTime <= 0) return null;
    let current: FeedLine | undefined;
    for (const line of lines) if (!line.outage && line.start <= currentTime) current = line;
    if (!current || currentTime > Math.max(current.start, current.end) + 2) return null;
    const words = current.text.trim().split(/\s+/).length;
    const span = current.end - current.start;
    const fraction = span > 0 ? Math.min(1, Math.max(0, (currentTime - current.start) / span)) : 1;
    return { key: current.key, on: Math.ceil(words * fraction) };
  }, [interim, live, language, source, currentTime, lines]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || !followRef.current || results) return;
    if (live) { feed.scrollTop = feed.scrollHeight; return; }
    const line = feed.querySelector<HTMLElement>('.active-line');
    if (!line) return;
    const target = Math.max(0, line.offsetTop - feed.clientHeight / 3);
    if (Math.abs(feed.scrollTop - target) > 4) feed.scrollTop = target;
  }, [lines, active?.key, live, results, following]);

  // While live, following means "scrolled to the newest line". During playback, any manual scroll pauses it.
  const onFeedScroll = () => {
    const feed = feedRef.current;
    if (!feed || !live || results) return;
    const atEnd = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48;
    if (atEnd !== followRef.current) setFollow(atEnd);
  };
  const onFeedGesture = () => { if (!live && followRef.current) setFollow(false); };
  const jumpToNow = () => {
    setFollow(true);
    const feed = feedRef.current;
    if (feed && live) feed.scrollTop = feed.scrollHeight;
  };
  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds; setCurrentTime(seconds);
    if (!live) setFollow(true);
  };
  const replay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0; setCurrentTime(0); setFollow(true);
    void video.play().catch(() => {});
  };

  const requestProcessing = async () => {
    try {
      await api(`/api/sessions/${session.id}/jobs`, { method: 'POST' });
      onMessage('Recording queued for the enhanced transcript.');
    } catch (reason) { onMessage(errorText(reason, 'Could not queue recording.'), true); }
  };

  const vote = async (event: FormEvent) => {
    event.preventDefault();
    if (!primaryPoll || !selectedOption[primaryPoll.id]) return;
    try {
      await api(`/api/polls/${primaryPoll.id}/vote`, { method: 'POST', body: JSON.stringify({ option_id: selectedOption[primaryPoll.id] }) });
      setVoted((value) => ({ ...value, [primaryPoll.id]: true }));
      onMessage('Vote counted anonymously.');
    } catch (reason) { onMessage(errorText(reason, 'Could not submit your vote.'), true); }
  };

  const submitInterest = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api(`/api/events/${session.event_id}/interests`, { method: 'POST', body: JSON.stringify({ text: interest }) });
      setInterest(''); onMessage('Thanks. Only topic counts are kept.');
    } catch (reason) { onMessage(errorText(reason, 'Could not save interest.'), true); }
  };

  const askAboutTalk = async (event: FormEvent) => {
    event.preventDefault(); if (!question.trim()) return;
    setAsking(true); setAnswer('');
    try {
      const result = await api<{ answer: string }>(`/api/sessions/${session.id}/ask`, { method: 'POST', body: JSON.stringify({ question }) });
      setAnswer(result.answer);
    } catch (reason) { onMessage(errorText(reason, 'Session Q&A is unavailable.'), true); }
    finally { setAsking(false); }
  };

  const timestamp = (seconds: number) => videoUrl
    ? <button type="button" className="ts" onClick={() => seek(seconds)} aria-label={`Play from ${formatTimestamp(seconds)}`}>{formatTimestamp(seconds)}</button>
    : <span className="ts">{formatTimestamp(seconds)}</span>;
  const emptyText = !session.publish_content ? 'The speaker hasn’t published this session.'
    : !session.has_recording ? 'No recording yet. Captions appear here once the speaker uploads one.'
    : live ? `Listening… ${LANGUAGES[language]} captions will appear here.`
    : 'Press Start captions to begin.';
  const showJump = !following && !results && (live || Boolean(active));

  return <main className="curator">
    <section className="session-head">
      <p className="eyebrow">{[session.track, session.room].filter(Boolean).join(' · ') || 'Session'}</p>
      <h1 className="session-title">{session.title}</h1>
      <p className="session-meta">
        <span>{session.speaker_name || 'Speaker'} · {formatTime(session.starts_at)}</span>
        <span className="viewer-count"><span className={`dot${session.active_viewers ? ' on' : ''}`} />{session.active_viewers} watching</span>
      </p>
      {sessions.length > 1 && <SessionSelect sessions={sessions} selectedId={selectedId} onChange={setSelectedId} />}
    </section>

    {videoUrl && <div className="video-frame">
      <video ref={videoRef} controls playsInline src={videoUrl} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onEnded={() => { void stopLive(); void requestProcessing(); }} onError={() => { reportClientEvent('media_playback_error'); onMessage('The recording couldn’t be played.', true); }} />
    </div>}

    <section className="live-zone" aria-label="Transcript">
      <div className="search-row">
        <input className="search-input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this talk" aria-label="Search this talk" disabled={!session.publish_content} />
        {query.length >= 2 && <span className="search-count" aria-live="polite">{searching ? 'Searching…' : `${results?.length ?? 0} ${results?.length === 1 ? 'result' : 'results'}`}</span>}
      </div>

      {currentJob && <div className={`feed-status${currentJob.status === 'failed' ? ' is-failed' : ''}`} title={currentJob.message}>
        <span className="dot" /><span>{JOB_LABELS[currentJob.status] ?? currentJob.status}</span>
        {currentJob.status !== 'completed' && <><span className="bar"><span style={{ width: `${currentJob.progress}%` }} /></span><span>{currentJob.progress}%</span></>}
      </div>}

      <div className="feed-wrap">
        <div className="feed" ref={feedRef} onScroll={onFeedScroll} onWheel={onFeedGesture} onTouchMove={onFeedGesture} aria-live={live ? 'polite' : 'off'}>
          {results
            ? results.length
              ? results.map((result) => <div className="line" key={`r-${result.id}-${result.start_seconds}`}>{timestamp(result.start_seconds)}<p className="line-text">{highlight(result.text, query)}</p></div>)
              : <p className="feed-empty">No matches. Try another phrase.</p>
            : lines.length
              ? lines.map((line) => <div key={line.key} className={`line${line.outage ? ' outage-line' : ''}${active && active.key === line.key ? ' active-line' : ''}`}>
                  {timestamp(line.start)}
                  <p className="line-text">{active && active.key === line.key ? karaoke(line.text, active.on) : line.text}{line.edited && <small className="edited-note"> · edited by speaker</small>}</p>
                </div>)
              : <p className="feed-empty">{emptyText}</p>}
        </div>
        {showJump && <button type="button" className="jump-live" onClick={jumpToNow}>{live ? '↓ Live' : '↓ Now playing'}</button>}
      </div>

      <div className="control-bar">
        <button type="button" className="btn-primary" onClick={() => void (live ? stopLive() : startLive())} disabled={!videoUrl}>{live ? 'Stop captions' : 'Start captions'}</button>
        <button type="button" className="btn-ghost" onClick={replay} disabled={!videoUrl || live}>Replay</button>
        <span className="session-facts">{transcript.length} segments · {session.transcription_status.replaceAll('_', ' ')}</span>
      </div>
    </section>

    <section className="extras">
      {primaryPoll && <PollCard poll={primaryPoll} selectedId={selectedOption[primaryPoll.id] ?? 0} voted={voted[primaryPoll.id] ?? false} onSelect={(id) => setSelectedOption((current) => ({ ...current, [primaryPoll.id]: id }))} onSubmit={vote} />}

      <form className="card" onSubmit={askAboutTalk}>
        <div className="card-head"><h2>Ask this talk</h2><span className="status plain">Optional AI</span></div>
        <div className="inline-form">
          <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about an idea from this talk" aria-label="Your question" />
          <button className="btn-primary btn-sm" disabled={asking || question.trim().length < 3}>{asking ? 'Looking…' : 'Ask'}</button>
        </div>
        {answer && <div className="ai-answer">{answer}</div>}
      </form>

      <FeedbackCard sessionId={session.id} onMessage={onMessage} />

      <form className="card" onSubmit={submitInterest}>
        <h2><label htmlFor="interest">What do you want to learn here?</label></h2>
        <div className="inline-form">
          <input id="interest" maxLength={500} value={interest} onChange={(event) => setInterest(event.target.value)} placeholder="A few topics or ideas" />
          <button className="btn-ghost btn-sm" disabled={interest.trim().length < 2}>Add</button>
        </div>
        <p className="hint">Only topic counts are kept, not your answer.</p>
      </form>
    </section>
  </main>;
}

function SpeakerView({ session, sessions, selectedId, setSelectedId, transcript, jobs, polls, onMessage, onRefresh }: {
  session: Session; sessions: Session[]; selectedId: string; setSelectedId: (id: string) => void; transcript: Segment[];
  jobs: Job[]; polls: Poll[]; onMessage: Notify; onRefresh: () => Promise<void>;
}) {
  const [form, setForm] = useState({ title: session.title, description: session.description, speaker_name: session.speaker_name, track: session.track, room: session.room, source_language: session.source_language, publish_content: session.publish_content });
  const [uploading, setUploading] = useState(false);
  const [question, setQuestion] = useState('');
  const [kind, setKind] = useState<'multiple_choice' | 'true_false'>('multiple_choice');
  const [choices, setChoices] = useState('Choice A, Choice B');
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [editBusy, setEditBusy] = useState<number | null>(null);
  const activeJob = jobs.find((job) => job.status === 'queued' || job.status === 'processing');

  const saveSession = async (event: FormEvent) => {
    event.preventDefault();
    try { await api(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify(form) }); await onRefresh(); onMessage('Session details saved.'); }
    catch (reason) { onMessage(errorText(reason, 'Could not save session.'), true); }
  };
  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('recording') as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    const body = new FormData(); body.append('file', file); setUploading(true);
    try { await api(`/api/sessions/${session.id}/media`, { method: 'POST', body }); await onRefresh(); input.value = ''; onMessage('Recording saved. Attendees can now play it.'); }
    catch (reason) { onMessage(errorText(reason, 'Upload failed.'), true); }
    finally { setUploading(false); }
  };
  const queueProcessing = async () => {
    try { await api(`/api/sessions/${session.id}/jobs`, { method: 'POST' }); onMessage('Recording added to the processing queue.'); }
    catch (reason) { onMessage(errorText(reason, 'Could not queue recording.'), true); }
  };
  const createPoll = async (event: FormEvent) => {
    event.preventDefault();
    const options = kind === 'true_false' ? [] : choices.split(',').map((item) => item.trim()).filter(Boolean);
    try { const poll = await api<Poll>(`/api/sessions/${session.id}/polls`, { method: 'POST', body: JSON.stringify({ question, kind, options }) }); await api(`/api/polls/${poll.id}/activate`, { method: 'POST' }); setQuestion(''); onMessage('Poll is live.'); }
    catch (reason) { onMessage(errorText(reason, 'Could not create poll.'), true); }
  };
  const togglePoll = (poll: Poll) => api(`/api/polls/${poll.id}/${poll.active ? 'close' : 'activate'}`, { method: 'POST' })
    .then(() => onMessage(poll.active ? 'Poll closed.' : 'Poll is live.'))
    .catch((reason) => onMessage(errorText(reason, 'Could not update poll.'), true));
  const reviewEdit = async (segment: Segment) => {
    const text = edits[segment.id]?.trim(); if (!text) return;
    setEditBusy(segment.id);
    try { const result = await api<{ approved: boolean; note: string }>(`/api/segments/${segment.id}/speaker-edit`, { method: 'POST', body: JSON.stringify({ text }) }); onMessage(result.approved ? `Edit approved: ${result.note}` : `Edit not applied: ${result.note}`, !result.approved); }
    catch (reason) { onMessage(errorText(reason, 'AI review is unavailable.'), true); }
    finally { setEditBusy(null); }
  };

  return <main className="page">
    <section className="page-head">
      <p className="eyebrow">Speaker</p>
      <h1>{session.title}</h1>
      {sessions.length > 1 && <SessionSelect sessions={sessions} selectedId={selectedId} onChange={setSelectedId} />}
    </section>

    <section className="card">
      <div className="card-head"><h2>Session details</h2></div>
      <form className="field-grid" onSubmit={saveSession}>
        <label className="field full-field">Title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="field full-field">Description<textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label className="field">Speaker name<input value={form.speaker_name} onChange={(e) => setForm({ ...form, speaker_name: e.target.value })} /></label>
        <label className="field">Track<input value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value })} /></label>
        <label className="field">Room<input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} /></label>
        <label className="field">Talk language<select value={form.source_language} onChange={(e) => setForm({ ...form, source_language: e.target.value as Language })}>{LANGUAGE_CODES.map((code) => <option key={code} value={code}>{LANGUAGES[code]}</option>)}</select></label>
        <label className="check-row full-field"><input type="checkbox" checked={form.publish_content} onChange={(e) => setForm({ ...form, publish_content: e.target.checked })} /><span>Publish this talk<small>Uncheck to keep the recording private. It is still kept for processing.</small></span></label>
        <button className="btn-primary btn-sm" type="submit">Save details</button>
      </form>
    </section>

    <section className="card">
      <div className="card-head"><h2>Recording</h2><span className={`status ${session.has_recording ? 'is-ready' : ''}`}>{session.has_recording ? 'Saved' : 'None yet'}</span></div>
      <form className="upload-form" onSubmit={upload}>
        <label htmlFor="recording-file" className="upload-drop"><strong>Choose a recording</strong><small>Video or audio, up to 1 GB</small><input id="recording-file" name="recording" type="file" accept="video/mp4,video/quicktime,video/webm,audio/*" required /></label>
        <button className="btn-primary btn-sm" disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</button>
      </form>
      {session.has_recording && <div className="row">
        <div className="row-main"><strong>Enhanced transcript</strong><small>{activeJob ? activeJob.message : 'Transcribe, translate, and index for search.'}</small></div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => void queueProcessing()} disabled={Boolean(activeJob)}>{activeJob ? `${activeJob.progress}%` : 'Process'}</button>
      </div>}
      {activeJob && <div className="progress"><span style={{ width: `${activeJob.progress}%` }} /></div>}
    </section>

    <section className="card">
      <div className="card-head"><h2>Poll</h2><span className="status plain">Anonymous</span></div>
      <form className="field-grid" onSubmit={createPoll}>
        <label className="field full-field">Question<input required value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What should we explore next?" /></label>
        <label className="field">Format<select value={kind} onChange={(e) => setKind(e.target.value as 'multiple_choice' | 'true_false')}><option value="multiple_choice">Multiple choice</option><option value="true_false">True or false</option></select></label>
        {kind === 'multiple_choice' && <label className="field">Choices, comma separated<input value={choices} onChange={(e) => setChoices(e.target.value)} /></label>}
        <button className="btn-primary btn-sm">Start poll</button>
      </form>
      {polls.length > 0 && <div className="row-list">{polls.map((poll) => <div className="row" key={poll.id}>
        <div className="row-main"><strong>{poll.question}</strong><small>{poll.total_votes} responses</small></div>
        <div className="row-side"><span className={`status ${poll.active ? 'is-live' : ''}`}>{poll.active ? 'Live' : 'Closed'}</span><button type="button" className="text-button" onClick={() => void togglePoll(poll)}>{poll.active ? 'Close' : 'Reopen'}</button></div>
      </div>)}</div>}
    </section>

    <section className="card">
      <div className="card-head"><h2>Transcript corrections</h2><span className="status plain">{transcript.length} lines</span></div>
      <p className="hint">AI reviews each correction before it’s applied.</p>
      {transcript.length ? <div className="row-list">{transcript.slice(0, 6).map((segment) => <div className="edit-row" key={segment.id}>
        <p><span className="ts-tag">{formatTimestamp(segment.start_seconds)}</span>{segment.text}{segment.edited_by_speaker && <small className="edited-note"> · edited</small>}</p>
        <label className="field">Correction<textarea rows={2} value={edits[segment.id] ?? ''} onChange={(e) => setEdits({ ...edits, [segment.id]: e.target.value })} placeholder="Rewrite this line" /></label>
        <button type="button" className="btn-ghost btn-sm" disabled={!edits[segment.id]?.trim() || editBusy === segment.id} onClick={() => void reviewEdit(segment)}>{editBusy === segment.id ? 'Reviewing…' : 'Submit for review'}</button>
      </div>)}</div> : <p className="subtle-empty">Transcript lines appear here after captions or processing.</p>}
    </section>
  </main>;
}

function OrganizerView({ event, overview, interests, onRefresh, onMessage }: { event: ConferenceEvent; overview: Overview | null; interests: { topic: string; count: number }[]; onRefresh: () => Promise<void>; onMessage: Notify }) {
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
  const sessions = overview?.sessions ?? [];
  const queue = overview?.jobs ?? [];
  const serviceWarning = Object.entries(overview?.services ?? {}).filter(([, status]) => ['unavailable', 'degraded'].includes(status));
  const summarize = () => api<{ summary: string }>(`/api/events/${event.id}/interest-summary`, { method: 'POST' })
    .then((result) => setInterestSummary(result.summary))
    .catch((reason) => onMessage(errorText(reason, 'Summary is unavailable.'), true));

  return <main className="page">
    <section className="page-head page-head-row">
      <div><p className="eyebrow">Organizer</p><h1>{event.title}</h1></div>
      <div className="head-actions"><span className="status is-live">Auto-refresh</span><button type="button" className="btn-ghost btn-sm" onClick={() => void onRefresh()}>Refresh</button></div>
    </section>

    {serviceWarning.length > 0 && <div className="inline-alert"><strong>Service needs attention</strong><span>{serviceWarning.map(([name]) => name).join(', ')} is unavailable or degraded. Recordings stay queued for processing.</span></div>}

    <section className="metric-grid">
      <Metric label="Watching (est.)" value={overview?.counts.active_viewers ?? 0} />
      <Metric label="Queued" value={overview?.counts.queued_jobs ?? 0} />
      <Metric label="Processing" value={overview?.counts.processing_jobs ?? 0} />
      <Metric label="Ready" value={overview?.counts.completed_jobs ?? 0} />
    </section>

    <section className="card">
      <div className="card-head"><h2>Sessions</h2><span className="status plain">{sessions.length}</span></div>
      {sessions.length ? <div className="row-list">{sessions.map((session) => <div className="row" key={session.id}>
        <div className="row-main"><strong>{session.title}</strong><small>{[session.speaker_name, session.room || 'Room TBD', session.publish_content ? 'Published' : 'Opted out', `${session.interest_mentions} interest matches`, `peak ${session.max_viewers}`].filter(Boolean).join(' · ')}</small></div>
        <div className="row-side"><span className="viewer-count"><span className={`dot${session.active_viewers ? ' on' : ''}`} />{session.active_viewers}</span><span className={`status ${statusClass(session.transcription_status)}`}>{session.transcription_status.replaceAll('_', ' ')}</span></div>
      </div>)}</div> : <p className="hint">Loading sessions…</p>}
    </section>

    <section className="card">
      <div className="card-head"><h2>Audience interests</h2><span className="status plain">Aggregate</span></div>
      {interests.length ? <div className="topic-list">{interests.slice(0, 12).map((item) => <div className="topic-row" key={item.topic}><span>{item.topic}</span><div className="meter"><i style={{ width: `${Math.max(8, (item.count / interests[0].count) * 100)}%` }} /></div><strong>{item.count}</strong></div>)}</div> : <p className="hint">No topics yet.</p>}
      <button type="button" className="text-button" onClick={() => void summarize()}>Summarize themes with AI</button>
      {interestSummary && <div className="ai-answer">{interestSummary}</div>}
    </section>

    <section className="card">
      <div className="card-head"><h2>Processing queue</h2><span className="status plain">{queue.length} recent</span></div>
      {queue.length ? <div className="row-list">{queue.map((job) => <div className="row" key={job.id}>
        <div className="row-main"><strong>{sessions.find((item) => item.id === job.session_id)?.title ?? 'Conference session'}</strong><small>{job.message}</small></div>
        <div className="row-side"><span>P{job.priority ?? 0}</span><span className={`status ${statusClass(job.status)}`}>{job.progress}%</span></div>
      </div>)}</div> : <p className="hint">No recordings queued.</p>}
    </section>

    <section className="card">
      <div className="card-head"><h2>Ratings</h2></div>
      <div className="row-list">{sessions.map((session) => {
        const ratings = feedback[session.id] ?? [];
        const total = ratings.reduce((sum, item) => sum + item.count, 0);
        const average = total ? (ratings.reduce((sum, item) => sum + item.rating * item.count, 0) / total).toFixed(1) : '—';
        return <div className="row" key={session.id}><div className="row-main"><strong>{session.title}</strong><small>{total} responses</small></div><div className="row-side"><b>{average}</b><span>/ 5</span></div></div>;
      })}</div>
    </section>

    <section className="card">
      <div className="card-head"><div><p className="eyebrow">Dash0</p><h2>Telemetry</h2></div></div>
      <p className="hint">The API, worker and this web app send OpenTelemetry traces, metrics and logs to Dash0: caption delay, translation latency, processing stages and container resources.</p>
      <p className="mono-stat">{overview?.compute ? `Backend · ${overview.compute.backend_cpu_percent.toFixed(0)}% CPU · ${overview.compute.backend_memory_mb} MB` : 'Backend telemetry set by environment'}</p>
    </section>

    <button type="button" className="text-button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>{advanced ? 'Hide' : 'Show'} operator details</button>
    {advanced && <section className="card">
      <div className="card-head"><h2>Connected services</h2></div>
      <div className="row-list">{Object.entries(overview?.services ?? {}).map(([name, status]) => <div className="row" key={name}>
        <div className="row-main"><strong>{name}</strong></div>
        <span className={`status ${statusClass(status)}`}>{status.replaceAll('_', ' ')}</span>
      </div>)}</div>
      <p className="mono-stat">WhisperLive clients · {overview?.compute?.whisperlive.active_clients ?? '—'} / {overview?.compute?.whisperlive.max_clients ?? '—'}</p>
    </section>}
  </main>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="metric"><span>{label}</span><strong>{value.toLocaleString()}</strong></div>;
}

function PollCard({ poll, selectedId, voted, onSelect, onSubmit }: { poll: Poll; selectedId: number; voted: boolean; onSelect: (id: number) => void; onSubmit: (event: FormEvent) => void }) {
  return <form className="card" onSubmit={onSubmit}>
    <div className="card-head"><h2>{poll.question}</h2><span className="status is-live">Poll</span></div>
    <div className="poll-options">{poll.options.map((option) => <label className={`poll-option${selectedId === option.id ? ' selected' : ''}`} key={option.id}>
      <input type="radio" name={`poll-${poll.id}`} checked={selectedId === option.id} onChange={() => onSelect(option.id)} disabled={voted} />
      <span className="radio-dot" /><span>{option.label}</span>
      {voted && <strong>{poll.total_votes ? Math.round((option.votes / poll.total_votes) * 100) : 0}%</strong>}
    </label>)}</div>
    <div className="poll-bottom">
      <p className="hint">{voted ? `${poll.total_votes} anonymous responses` : 'Anonymous. Only totals are counted.'}</p>
      {!voted && <button className="btn-primary btn-sm" disabled={!selectedId}>Vote</button>}
    </div>
  </form>;
}

function FeedbackCard({ sessionId, onMessage }: { sessionId: string; onMessage: Notify }) {
  const [rating, setRating] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const submit = async () => {
    if (!rating) return;
    try { await api(`/api/sessions/${sessionId}/feedback`, { method: 'POST', body: JSON.stringify({ rating }) }); setSubmitted(true); onMessage('Thanks for rating this session.'); }
    catch (reason) { onMessage(errorText(reason, 'Could not submit feedback.'), true); }
  };
  return <div className="card">
    <h2>Rate this session</h2>
    <div className="rating-row" role="group" aria-label="Rate the session">
      {[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={`star${value <= rating ? ' on' : ''}`} onClick={() => setRating(value)} aria-label={`${value} out of 5`} aria-pressed={value === rating} disabled={submitted}>★</button>)}
      <button type="button" className="btn-primary btn-sm" onClick={() => void submit()} disabled={!rating || submitted}>{submitted ? 'Sent' : 'Send'}</button>
    </div>
  </div>;
}

function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return text;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
}
