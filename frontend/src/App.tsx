import { Fragment, FormEvent, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { I18n, STRINGS, statusLabel, useT, type Language, type Role, type Strings } from './i18n';

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
/** A search hit shown in the reader's language; `matched_*` is the line whose words actually matched. */
type SearchHit = {
  id: number; start_seconds: number; end_seconds: number; language: Language; text: string;
  matched_language?: Language; matched_text?: string; match_terms?: string[];
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
const LANGUAGE_CODES: Language[] = ['en', 'es', 'tl'];
const ROLES: Role[] = ['attendee', 'speaker', 'organizer'];
const THEME_KEY = 'curator-theme';
const LANGUAGE_KEY = 'curator-language';
const formatTimestamp = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const formatTime = (t: Strings, value?: string) => value ? new Date(value).toLocaleTimeString(t.locale, { hour: 'numeric', minute: '2-digit' }) : t.timeTba;
const formatNumber = (t: Strings, value: number) => value.toLocaleString(t.locale);
const jobLabel = (t: Strings, status: string) => t.jobLabels[status] ?? statusLabel(t, status);
const errorText = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;

function readSetting<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return allowed.find((value) => value === saved) ?? fallback;
  } catch { return fallback; }
}

function saveSetting(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private browsing: the setting lasts for this visit only */ }
}

function statusClass(status: string) {
  if (['completed', 'available', 'configured'].includes(status)) return 'is-ready';
  if (['failed', 'unavailable', 'degraded'].includes(status)) return 'is-error';
  if (['live', 'processing'].includes(status)) return 'is-live';
  return '';
}

export default function App() {
  const [role, setRole] = useState<Role>('attendee');
  const [theme, setTheme] = useState<Theme>(() => readSetting(THEME_KEY, ['dark', 'light'], 'dark'));
  const [language, setLanguage] = useState<Language>(() => readSetting(LANGUAGE_KEY, LANGUAGE_CODES, 'en'));
  const [liveState, setLiveState] = useState<LiveState>('idle');
  const [event, setEvent] = useState<ConferenceEvent | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [transcript, setTranscript] = useState<Segment[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [interests, setInterests] = useState<{ topic: string; count: number }[]>([]);
  const t = STRINGS[language];
  const tRef = useRef(t);
  tRef.current = t;
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
      setError(errorText(reason, tRef.current.connectError));
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
    saveSetting(THEME_KEY, theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = language;
    saveSetting(LANGUAGE_KEY, language);
  }, [language]);
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
        if (alive) setError(errorText(reason, tRef.current.loadError));
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

  return (
    <I18n.Provider value={t}>
      <div className="app-shell">
        <header className="curator-header">
          <Logo />
          <div className="header-controls">
            <div className="seg-toggle" role="group" aria-label={t.languageToggle}>
              {LANGUAGE_CODES.map((code) => <button key={code} type="button" lang={code} className={language === code ? 'active' : ''} aria-pressed={language === code} title={STRINGS[code].languageNames[code]} onClick={() => setLanguage(code)}>{code.toUpperCase()}</button>)}
            </div>
            <button type="button" className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? t.themeToLight : t.themeToDark}>{theme === 'dark' ? '☀' : '☾'}</button>
            {role === 'attendee' && <span className={`live-status${liveState === 'live' ? ' on' : ''}`} role="status"><span className="dot" /><span className="live-label">{t.liveStatus[liveState]}</span></span>}
          </div>
        </header>

        <nav className="view-bar" aria-label={t.chooseView}>
          <div className="seg-toggle seg-fill">
            {ROLES.map((item) => <button key={item} type="button" className={role === item ? 'active' : ''} aria-pressed={role === item} onClick={() => setRole(item)}>{t.roles[item]}</button>)}
          </div>
        </nav>

        {(notice || error) && <div className={`notice${error ? ' notice-error' : ''}`} role="status"><span>{error || notice}</span><button type="button" onClick={() => { setError(''); setNotice(''); }} aria-label={t.dismiss}>×</button></div>}

        {error && !sessions.length ? <main className="empty-state"><h1>{t.cantReach}</h1><p>{error}</p><button type="button" className="btn-primary" onClick={() => void loadSessions()}>{t.tryAgain}</button></main> : <>
          {role !== 'organizer' && !session && <main className="empty-state"><p>{event ? t.noSessions : t.loadingSessions}</p></main>}
          {role === 'attendee' && session && <AttendeeView key={session.id} session={session} sessions={sessions} selectedId={selectedId} setSelectedId={setSelectedId} language={language} transcript={transcript} setTranscript={setTranscript} jobs={jobs} polls={polls} liveState={liveState} setLiveState={setLiveState} onMessage={flash} />}
          {role === 'speaker' && session && <SpeakerView key={session.id} session={session} sessions={sessions} selectedId={selectedId} setSelectedId={setSelectedId} transcript={transcript} jobs={jobs} polls={polls} onMessage={flash} onRefresh={loadSessions} />}
          {role === 'organizer' && event && <OrganizerView event={event} overview={overview} interests={interests} onRefresh={loadOverview} onMessage={flash} />}
        </>}

        <footer className="app-footer"><span>{t.footer}</span><a href="/api/health" target="_blank" rel="noreferrer">{t.serviceHealth}</a></footer>
      </div>
    </I18n.Provider>
  );
}

/** Curator lockup. The bars use theme tokens, so one mark serves light and dark. Geometry from the brand artwork. */
function Logo() {
  return <div className="brand" role="img" aria-label="Curator">
    <svg className="brand-mark" viewBox="0 0 261 115" aria-hidden="true" focusable="false">
      <rect className="brand-ink" width="261" height="40" rx="20" />
      <rect className="brand-accent" y="75" width="191" height="40" rx="20" />
    </svg>
    <span className="wordmark" aria-hidden="true">Curator</span>
  </div>;
}

function SessionSelect({ sessions, selectedId, onChange }: { sessions: Session[]; selectedId: string; onChange: (id: string) => void }) {
  const t = useT();
  return <select className="session-select" value={selectedId} onChange={(event) => onChange(event.target.value)} aria-label={t.chooseSession}>
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
  const t = useT();
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
  const [results, setResults] = useState<SearchHit[] | null>(null);
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
    if (!video || !capture) { onMessage(t.msg.noCapture, true); return; }
    const stream = capture.call(video);
    if (!stream.getAudioTracks().length) { onMessage(t.msg.noAudio, true); return; }
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
    socket.onerror = () => onMessage(t.msg.captionsFailed, true);
    socket.onclose = () => { if (wsRef.current === socket) void stopLive(); };
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
      api<SearchHit[]>('/api/search', { method: 'POST', body: JSON.stringify({ session_id: session.id, query, language }) })
        .then((found) => { if (alive) setResults(found); })
        .catch((reason) => { if (alive) { setResults([]); onMessage(errorText(reason, t.msg.searchFailed), true); } })
        .finally(() => { if (alive) setSearching(false); });
    }, 400);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query, language, session.id]);

  const lines = useMemo(() => {
    const showInterim = interim && language === source ? interim : null;
    const list: FeedLine[] = transcript
      .filter((segment) => !showInterim || Math.abs(segment.start_seconds - showInterim.start) >= 0.3)
      .map((segment) => ({ key: `s-${segment.id}-${segment.start_seconds}`, start: segment.start_seconds, end: segment.end_seconds, text: segment.text, edited: segment.edited_by_speaker }));
    if (showInterim) list.push({ key: 'interim', start: showInterim.start, end: showInterim.end, text: showInterim.text });
    for (const outage of outages) {
      if (outage.language !== language) continue;
      list.push({ key: `outage-${outage.language}-${outage.start}`, start: outage.start, end: outage.start, outage: true, text: t.outage(t.languageNames[outage.language], t.languageNames[source], source.toUpperCase()) });
    }
    return list.sort((a, b) => a.start - b.start || Number(Boolean(a.outage)) - Number(Boolean(b.outage)));
  }, [transcript, interim, outages, language, source, t]);

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
      onMessage(t.msg.queued);
    } catch (reason) { onMessage(errorText(reason, t.msg.queueFailed), true); }
  };

  const vote = async (event: FormEvent) => {
    event.preventDefault();
    if (!primaryPoll || !selectedOption[primaryPoll.id]) return;
    try {
      await api(`/api/polls/${primaryPoll.id}/vote`, { method: 'POST', body: JSON.stringify({ option_id: selectedOption[primaryPoll.id] }) });
      setVoted((value) => ({ ...value, [primaryPoll.id]: true }));
      onMessage(t.msg.voted);
    } catch (reason) { onMessage(errorText(reason, t.msg.voteFailed), true); }
  };

  const submitInterest = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api(`/api/events/${session.event_id}/interests`, { method: 'POST', body: JSON.stringify({ text: interest }) });
      setInterest(''); onMessage(t.msg.interestSaved);
    } catch (reason) { onMessage(errorText(reason, t.msg.interestFailed), true); }
  };

  const askAboutTalk = async (event: FormEvent) => {
    event.preventDefault(); if (!question.trim()) return;
    setAsking(true); setAnswer('');
    try {
      const result = await api<{ answer: string }>(`/api/sessions/${session.id}/ask`, { method: 'POST', body: JSON.stringify({ question }) });
      setAnswer(result.answer);
    } catch (reason) { onMessage(errorText(reason, t.msg.qaUnavailable), true); }
    finally { setAsking(false); }
  };

  const timestamp = (seconds: number) => videoUrl
    ? <button type="button" className="ts" onClick={() => seek(seconds)} aria-label={t.playFrom(formatTimestamp(seconds))}>{formatTimestamp(seconds)}</button>
    : <span className="ts">{formatTimestamp(seconds)}</span>;
  const emptyText = !session.publish_content ? t.emptyUnpublished
    : !session.has_recording ? t.emptyNoRecording
    : live ? t.emptyListening(t.languageNames[language])
    : t.emptyIdle;
  const showJump = !following && !results && (live || Boolean(active));

  return <main className="curator">
    <section className="session-head">
      <p className="eyebrow">{[session.track, session.room].filter(Boolean).join(' · ') || t.sessionFallback}</p>
      <h1 className="session-title">{session.title}</h1>
      <p className="session-meta">
        <span>{session.speaker_name || t.speakerFallback} · {formatTime(t, session.starts_at)}</span>
        <span className="viewer-count"><span className={`dot${session.active_viewers ? ' on' : ''}`} />{t.watching(formatNumber(t, session.active_viewers))}</span>
      </p>
      {sessions.length > 1 && <SessionSelect sessions={sessions} selectedId={selectedId} onChange={setSelectedId} />}
    </section>

    {videoUrl && <div className="video-frame">
      <video ref={videoRef} controls playsInline src={videoUrl} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onEnded={() => { void stopLive(); void requestProcessing(); }} onError={() => { reportClientEvent('media_playback_error'); onMessage('The recording couldn’t be played.', true); }} />
      <video ref={videoRef} controls playsInline src={videoUrl} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onEnded={() => { void stopLive(); void requestProcessing(); }} onError={() => onMessage(t.msg.playbackFailed, true)} />
    </div>}

    <section className="live-zone" aria-label={t.transcriptRegion}>
      <div className="search-row">
        <input className="search-input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.searchPlaceholder} aria-label={t.searchLabel} disabled={!session.publish_content} />
        {query.length >= 2 && <span className="search-count" aria-live="polite">{searching ? t.searching : t.results(results?.length ?? 0)}</span>}
      </div>

      {currentJob && <div className={`feed-status${currentJob.status === 'failed' ? ' is-failed' : ''}`} title={currentJob.message}>
        <span className="dot" /><span>{jobLabel(t, currentJob.status)}</span>
        {currentJob.status !== 'completed' && <><span className="bar"><span style={{ width: `${currentJob.progress}%` }} /></span><span>{currentJob.progress}%</span></>}
      </div>}

      <div className="feed-wrap">
        <div className="feed" ref={feedRef} onScroll={onFeedScroll} onWheel={onFeedGesture} onTouchMove={onFeedGesture} aria-live={live ? 'polite' : 'off'}>
          {results
            ? results.length
              ? results.map((result) => {
                  const terms = result.match_terms?.length ? result.match_terms : query.split(/\s+/);
                  const matchedElsewhere = result.matched_text && result.matched_language && result.matched_language !== result.language;
                  return <div className="line" key={`r-${result.id}-${result.start_seconds}`}>
                    {timestamp(result.start_seconds)}
                    <div>
                      <p className="line-text">{result.language !== language && <span className="lang-tag">{result.language.toUpperCase()}</span>}{highlight(result.text, terms)}</p>
                      {matchedElsewhere && <p className="match-note"><span className="lang-tag">{result.matched_language?.toUpperCase()}</span>{highlight(result.matched_text ?? '', terms)}</p>}
                    </div>
                  </div>;
                })
              : <p className="feed-empty">{t.noMatches}</p>
            : lines.length
              ? lines.map((line) => <div key={line.key} className={`line${line.outage ? ' outage-line' : ''}${active && active.key === line.key ? ' active-line' : ''}`}>
                  {timestamp(line.start)}
                  <p className="line-text">{active && active.key === line.key ? karaoke(line.text, active.on) : line.text}{line.edited && <small className="edited-note">{t.editedBySpeaker}</small>}</p>
                </div>)
              : <p className="feed-empty">{emptyText}</p>}
        </div>
        {showJump && <button type="button" className="jump-live" onClick={jumpToNow}>{live ? t.jumpLive : t.jumpNow}</button>}
      </div>

      <div className="control-bar">
        <button type="button" className="btn-primary" onClick={() => void (live ? stopLive() : startLive())} disabled={!videoUrl}>{live ? t.stopCaptions : t.startCaptions}</button>
        <button type="button" className="btn-ghost" onClick={replay} disabled={!videoUrl || live}>{t.replay}</button>
        <span className="session-facts">{t.segments(formatNumber(t, transcript.length))} · {statusLabel(t, session.transcription_status)}</span>
      </div>
    </section>

    <section className="extras">
      {primaryPoll && <PollCard poll={primaryPoll} selectedId={selectedOption[primaryPoll.id] ?? 0} voted={voted[primaryPoll.id] ?? false} onSelect={(id) => setSelectedOption((current) => ({ ...current, [primaryPoll.id]: id }))} onSubmit={vote} />}

      <form className="card" onSubmit={askAboutTalk}>
        <div className="card-head"><h2>{t.askTitle}</h2><span className="status plain">{t.optionalAi}</span></div>
        <div className="inline-form">
          <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t.askPlaceholder} aria-label={t.askLabel} />
          <button className="btn-primary btn-sm" disabled={asking || question.trim().length < 3}>{asking ? t.looking : t.ask}</button>
        </div>
        {answer && <div className="ai-answer">{answer}</div>}
      </form>

      <FeedbackCard sessionId={session.id} onMessage={onMessage} />

      <form className="card" onSubmit={submitInterest}>
        <h2><label htmlFor="interest">{t.interestTitle}</label></h2>
        <div className="inline-form">
          <input id="interest" maxLength={500} value={interest} onChange={(event) => setInterest(event.target.value)} placeholder={t.interestPlaceholder} />
          <button className="btn-ghost btn-sm" disabled={interest.trim().length < 2}>{t.add}</button>
        </div>
        <p className="hint">{t.interestHint}</p>
      </form>
    </section>
  </main>;
}

function SpeakerView({ session, sessions, selectedId, setSelectedId, transcript, jobs, polls, onMessage, onRefresh }: {
  session: Session; sessions: Session[]; selectedId: string; setSelectedId: (id: string) => void; transcript: Segment[];
  jobs: Job[]; polls: Poll[]; onMessage: Notify; onRefresh: () => Promise<void>;
}) {
  const t = useT();
  const [form, setForm] = useState({ title: session.title, description: session.description, speaker_name: session.speaker_name, track: session.track, room: session.room, source_language: session.source_language, publish_content: session.publish_content });
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [question, setQuestion] = useState('');
  const [kind, setKind] = useState<'multiple_choice' | 'true_false'>('multiple_choice');
  const [choices, setChoices] = useState(t.defaultChoices);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [editBusy, setEditBusy] = useState<number | null>(null);
  const activeJob = jobs.find((job) => job.status === 'queued' || job.status === 'processing');

  const saveSession = async (event: FormEvent) => {
    event.preventDefault();
    try { await api(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify(form) }); await onRefresh(); onMessage(t.msg.saved); }
    catch (reason) { onMessage(errorText(reason, t.msg.saveFailed), true); }
  };
  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('recording') as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    const body = new FormData(); body.append('file', file); setUploading(true);
    try { await api(`/api/sessions/${session.id}/media`, { method: 'POST', body }); await onRefresh(); input.value = ''; setFileName(''); onMessage(t.msg.uploaded); }
    catch (reason) { onMessage(errorText(reason, t.msg.uploadFailed), true); }
    finally { setUploading(false); }
  };
  const queueProcessing = async () => {
    try { await api(`/api/sessions/${session.id}/jobs`, { method: 'POST' }); onMessage(t.msg.processingQueued); }
    catch (reason) { onMessage(errorText(reason, t.msg.queueFailed), true); }
  };
  const createPoll = async (event: FormEvent) => {
    event.preventDefault();
    const options = kind === 'true_false' ? [] : choices.split(',').map((item) => item.trim()).filter(Boolean);
    try { const poll = await api<Poll>(`/api/sessions/${session.id}/polls`, { method: 'POST', body: JSON.stringify({ question, kind, options }) }); await api(`/api/polls/${poll.id}/activate`, { method: 'POST' }); setQuestion(''); onMessage(t.msg.pollLive); }
    catch (reason) { onMessage(errorText(reason, t.msg.pollFailed), true); }
  };
  const togglePoll = (poll: Poll) => api(`/api/polls/${poll.id}/${poll.active ? 'close' : 'activate'}`, { method: 'POST' })
    .then(() => onMessage(poll.active ? t.msg.pollClosed : t.msg.pollLive))
    .catch((reason) => onMessage(errorText(reason, t.msg.pollUpdateFailed), true));
  const reviewEdit = async (segment: Segment) => {
    const text = edits[segment.id]?.trim(); if (!text) return;
    setEditBusy(segment.id);
    try { const result = await api<{ approved: boolean; note: string }>(`/api/segments/${segment.id}/speaker-edit`, { method: 'POST', body: JSON.stringify({ text }) }); onMessage(result.approved ? t.msg.editApproved(result.note) : t.msg.editRejected(result.note), !result.approved); }
    catch (reason) { onMessage(errorText(reason, t.msg.reviewUnavailable), true); }
    finally { setEditBusy(null); }
  };

  return <main className="page">
    <section className="page-head">
      <p className="eyebrow">{t.roles.speaker}</p>
      <h1>{session.title}</h1>
      {sessions.length > 1 && <SessionSelect sessions={sessions} selectedId={selectedId} onChange={setSelectedId} />}
    </section>

    <section className="card">
      <div className="card-head"><h2>{t.sessionDetails}</h2></div>
      <form className="field-grid" onSubmit={saveSession}>
        <label className="field full-field">{t.fieldTitle}<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="field full-field">{t.fieldDescription}<textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label className="field">{t.fieldSpeakerName}<input value={form.speaker_name} onChange={(e) => setForm({ ...form, speaker_name: e.target.value })} /></label>
        <label className="field">{t.fieldTrack}<input value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value })} /></label>
        <label className="field">{t.fieldRoom}<input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} /></label>
        <label className="field">{t.fieldTalkLanguage}<select value={form.source_language} onChange={(e) => setForm({ ...form, source_language: e.target.value as Language })}>{LANGUAGE_CODES.map((code) => <option key={code} value={code}>{t.languageNames[code]}</option>)}</select></label>
        <label className="check-row full-field"><input type="checkbox" checked={form.publish_content} onChange={(e) => setForm({ ...form, publish_content: e.target.checked })} /><span>{t.publish}<small>{t.publishHint}</small></span></label>
        <button className="btn-primary btn-sm" type="submit">{t.saveDetails}</button>
      </form>
    </section>

    <section className="card">
      <div className="card-head"><h2>{t.recording}</h2><span className={`status ${session.has_recording ? 'is-ready' : ''}`}>{session.has_recording ? t.recordingSaved : t.recordingNone}</span></div>
      <form className="upload-form" onSubmit={upload}>
        <label htmlFor="recording-file" className="upload-drop">
          <strong>{t.chooseRecording}</strong><small>{t.recordingHint}</small>
          {/* The native file button ignores the page language, so it is hidden behind a translated one. */}
          <span className="file-pick"><span className="file-button">{t.chooseFile}</span><span className="file-name">{fileName || t.noFile}</span></span>
          <input id="recording-file" className="file-input" name="recording" type="file" accept="video/mp4,video/quicktime,video/webm,audio/*" required onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')} />
        </label>
        <button className="btn-primary btn-sm" disabled={uploading}>{uploading ? t.uploading : t.upload}</button>
      </form>
      {session.has_recording && <div className="row">
        <div className="row-main"><strong>{t.enhancedTranscript}</strong><small title={activeJob?.message}>{activeJob ? jobLabel(t, activeJob.status) : t.enhancedHint}</small></div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => void queueProcessing()} disabled={Boolean(activeJob)}>{activeJob ? `${activeJob.progress}%` : t.process}</button>
      </div>}
      {activeJob && <div className="progress"><span style={{ width: `${activeJob.progress}%` }} /></div>}
    </section>

    <section className="card">
      <div className="card-head"><h2>{t.poll}</h2><span className="status plain">{t.anonymous}</span></div>
      <form className="field-grid" onSubmit={createPoll}>
        <label className="field full-field">{t.question}<input required value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t.questionPlaceholder} /></label>
        <label className="field">{t.format}<select value={kind} onChange={(e) => setKind(e.target.value as 'multiple_choice' | 'true_false')}><option value="multiple_choice">{t.multipleChoice}</option><option value="true_false">{t.trueFalse}</option></select></label>
        {kind === 'multiple_choice' && <label className="field">{t.choices}<input value={choices} onChange={(e) => setChoices(e.target.value)} /></label>}
        <button className="btn-primary btn-sm">{t.startPoll}</button>
      </form>
      {polls.length > 0 && <div className="row-list">{polls.map((poll) => <div className="row" key={poll.id}>
        <div className="row-main"><strong>{poll.question}</strong><small>{t.responses(formatNumber(t, poll.total_votes))}</small></div>
        <div className="row-side"><span className={`status ${poll.active ? 'is-live' : ''}`}>{poll.active ? t.pollLive : t.pollClosed}</span><button type="button" className="text-button" onClick={() => void togglePoll(poll)}>{poll.active ? t.closePoll : t.reopenPoll}</button></div>
      </div>)}</div>}
    </section>

    <section className="card">
      <div className="card-head"><h2>{t.corrections}</h2><span className="status plain">{t.lines(formatNumber(t, transcript.length))}</span></div>
      <p className="hint">{t.correctionsHint}</p>
      {transcript.length ? <div className="row-list">{transcript.slice(0, 6).map((segment) => <div className="edit-row" key={segment.id}>
        <p><span className="ts-tag">{formatTimestamp(segment.start_seconds)}</span>{segment.text}{segment.edited_by_speaker && <small className="edited-note">{t.edited}</small>}</p>
        <label className="field">{t.correction}<textarea rows={2} value={edits[segment.id] ?? ''} onChange={(e) => setEdits({ ...edits, [segment.id]: e.target.value })} placeholder={t.correctionPlaceholder} /></label>
        <button type="button" className="btn-ghost btn-sm" disabled={!edits[segment.id]?.trim() || editBusy === segment.id} onClick={() => void reviewEdit(segment)}>{editBusy === segment.id ? t.reviewing : t.submitReview}</button>
      </div>)}</div> : <p className="subtle-empty">{t.correctionsEmpty}</p>}
    </section>
  </main>;
}

function OrganizerView({ event, overview, interests, onRefresh, onMessage }: { event: ConferenceEvent; overview: Overview | null; interests: { topic: string; count: number }[]; onRefresh: () => Promise<void>; onMessage: Notify }) {
  const t = useT();
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
    .catch((reason) => onMessage(errorText(reason, t.msg.summaryUnavailable), true));
  const whisper = overview?.compute?.whisperlive;

  return <main className="page">
    <section className="page-head page-head-row">
      <div><p className="eyebrow">{t.roles.organizer}</p><h1>{event.title}</h1></div>
      <div className="head-actions"><span className="status is-live">{t.autoRefresh}</span><button type="button" className="btn-ghost btn-sm" onClick={() => void onRefresh()}>{t.refresh}</button></div>
    </section>

    {serviceWarning.length > 0 && <div className="inline-alert"><strong>{t.serviceAttention}</strong><span>{t.serviceAttentionDetail(serviceWarning.map(([name]) => name).join(', '))}</span></div>}

    <section className="metric-grid">
      <Metric label={t.metricWatching} value={overview?.counts.active_viewers ?? 0} />
      <Metric label={t.metricQueued} value={overview?.counts.queued_jobs ?? 0} />
      <Metric label={t.metricProcessing} value={overview?.counts.processing_jobs ?? 0} />
      <Metric label={t.metricReady} value={overview?.counts.completed_jobs ?? 0} />
    </section>

    <section className="card">
      <div className="card-head"><h2>{t.sessions}</h2><span className="status plain">{formatNumber(t, sessions.length)}</span></div>
      {sessions.length ? <div className="row-list">{sessions.map((session) => <div className="row" key={session.id}>
        <div className="row-main"><strong>{session.title}</strong><small>{[session.speaker_name, session.room || t.roomTbd, session.publish_content ? t.published : t.optedOut, t.interestMatches(formatNumber(t, session.interest_mentions)), t.peak(formatNumber(t, session.max_viewers))].filter(Boolean).join(' · ')}</small></div>
        <div className="row-side"><span className="viewer-count"><span className={`dot${session.active_viewers ? ' on' : ''}`} />{formatNumber(t, session.active_viewers)}</span><span className={`status ${statusClass(session.transcription_status)}`}>{statusLabel(t, session.transcription_status)}</span></div>
      </div>)}</div> : <p className="hint">{t.loadingSessions}</p>}
    </section>

    <section className="card">
      <div className="card-head"><h2>{t.interests}</h2><span className="status plain">{t.aggregate}</span></div>
      {interests.length ? <div className="topic-list">{interests.slice(0, 12).map((item) => <div className="topic-row" key={item.topic}><span>{item.topic}</span><div className="meter"><i style={{ width: `${Math.max(8, (item.count / interests[0].count) * 100)}%` }} /></div><strong>{formatNumber(t, item.count)}</strong></div>)}</div> : <p className="hint">{t.noTopics}</p>}
      <button type="button" className="text-button" onClick={() => void summarize()}>{t.summarize}</button>
      {interestSummary && <div className="ai-answer">{interestSummary}</div>}
    </section>

    <section className="card">
      <div className="card-head"><h2>{t.queue}</h2><span className="status plain">{t.recent(formatNumber(t, queue.length))}</span></div>
      {queue.length ? <div className="row-list">{queue.map((job) => <div className="row" key={job.id}>
        <div className="row-main"><strong>{sessions.find((item) => item.id === job.session_id)?.title ?? t.conferenceSession}</strong><small title={job.message}>{jobLabel(t, job.status)}</small></div>
        <div className="row-side"><span>P{job.priority ?? 0}</span><span className={`status ${statusClass(job.status)}`}>{job.progress}%</span></div>
      </div>)}</div> : <p className="hint">{t.noQueue}</p>}
    </section>

    <section className="card">
      <div className="card-head"><h2>{t.ratings}</h2></div>
      <div className="row-list">{sessions.map((session) => {
        const ratings = feedback[session.id] ?? [];
        const total = ratings.reduce((sum, item) => sum + item.count, 0);
        const average = total ? (ratings.reduce((sum, item) => sum + item.rating * item.count, 0) / total).toLocaleString(t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
        return <div className="row" key={session.id}><div className="row-main"><strong>{session.title}</strong><small>{t.responses(formatNumber(t, total))}</small></div><div className="row-side"><b>{average}</b><span>/ 5</span></div></div>;
      })}</div>
    </section>

    <section className="card">
      <div className="card-head"><div><p className="eyebrow">Dash0</p><h2>Telemetry</h2></div></div>
      <p className="hint">The API, worker and this web app send OpenTelemetry traces, metrics and logs to Dash0: caption delay, translation latency, processing stages and container resources.</p>
      <p className="mono-stat">{overview?.compute ? `Backend · ${overview.compute.backend_cpu_percent.toFixed(0)}% CPU · ${overview.compute.backend_memory_mb} MB` : 'Backend telemetry set by environment'}</p>
      <div className="card-head"><div><p className="eyebrow">Dash0</p><h2>{t.telemetry}</h2></div></div>
      <p className="hint">{t.telemetryHint}</p>
      <p className="mono-stat">{overview?.compute ? t.backendStat(overview.compute.backend_cpu_percent.toFixed(0), formatNumber(t, overview.compute.backend_memory_mb)) : t.backendUnset}</p>
    </section>

    <button type="button" className="text-button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>{advanced ? t.hideDetails : t.showDetails}</button>
    {advanced && <section className="card">
      <div className="card-head"><h2>{t.connectedServices}</h2></div>
      <div className="row-list">{Object.entries(overview?.services ?? {}).map(([name, status]) => <div className="row" key={name}>
        <div className="row-main"><strong>{name}</strong></div>
        <span className={`status ${statusClass(status)}`}>{statusLabel(t, status)}</span>
      </div>)}</div>
      <p className="mono-stat">{t.whisperClients(whisper?.active_clients != null ? formatNumber(t, whisper.active_clients) : '—', whisper?.max_clients != null ? formatNumber(t, whisper.max_clients) : '—')}</p>
    </section>}
  </main>;
}

function Metric({ label, value }: { label: string; value: number }) {
  const t = useT();
  return <div className="metric"><span>{label}</span><strong>{formatNumber(t, value)}</strong></div>;
}

function PollCard({ poll, selectedId, voted, onSelect, onSubmit }: { poll: Poll; selectedId: number; voted: boolean; onSelect: (id: number) => void; onSubmit: (event: FormEvent) => void }) {
  const t = useT();
  return <form className="card" onSubmit={onSubmit}>
    <div className="card-head"><h2>{poll.question}</h2><span className="status is-live">{t.poll}</span></div>
    <div className="poll-options">{poll.options.map((option) => <label className={`poll-option${selectedId === option.id ? ' selected' : ''}`} key={option.id}>
      <input type="radio" name={`poll-${poll.id}`} checked={selectedId === option.id} onChange={() => onSelect(option.id)} disabled={voted} />
      <span className="radio-dot" /><span>{option.label}</span>
      {voted && <strong>{poll.total_votes ? Math.round((option.votes / poll.total_votes) * 100) : 0}%</strong>}
    </label>)}</div>
    <div className="poll-bottom">
      <p className="hint">{voted ? t.pollResponses(formatNumber(t, poll.total_votes)) : t.pollAnonymous}</p>
      {!voted && <button className="btn-primary btn-sm" disabled={!selectedId}>{t.vote}</button>}
    </div>
  </form>;
}

function FeedbackCard({ sessionId, onMessage }: { sessionId: string; onMessage: Notify }) {
  const t = useT();
  const [rating, setRating] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const submit = async () => {
    if (!rating) return;
    try { await api(`/api/sessions/${sessionId}/feedback`, { method: 'POST', body: JSON.stringify({ rating }) }); setSubmitted(true); onMessage(t.msg.rated); }
    catch (reason) { onMessage(errorText(reason, t.msg.rateFailed), true); }
  };
  return <div className="card">
    <h2>{t.rateTitle}</h2>
    <div className="rating-row" role="group" aria-label={t.rateGroup}>
      {[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={`star${value <= rating ? ' on' : ''}`} onClick={() => setRating(value)} aria-label={t.stars(value)} aria-pressed={value === rating} disabled={submitted}>★</button>)}
      <button type="button" className="btn-primary btn-sm" onClick={() => void submit()} disabled={!rating || submitted}>{submitted ? t.sent : t.send}</button>
    </div>
  </div>;
}

const fold = (value: string) => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Marks every word that starts with one of `terms`, ignoring case and accents (the same rule the search API uses). */
function highlight(text: string, terms: string[]) {
  const wanted = terms.map(fold).map((term) => term.trim()).filter(Boolean);
  if (!wanted.length) return text;
  let folded = '';
  const origin: number[] = []; // folded index -> index in the original text
  for (let i = 0; i < text.length; i++) {
    const piece = fold(text[i]);
    for (let k = 0; k < piece.length; k++) { folded += piece[k]; origin.push(i); }
  }
  const marked = new Array<boolean>(text.length).fill(false);
  for (const term of wanted) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + 1)) {
      if (at > 0 && WORD_CHAR.test(folded[at - 1])) continue;
      for (let k = at; k < at + term.length; k++) marked[origin[k]] = true;
    }
  }
  const parts: ReactNode[] = [];
  for (let i = 0; i < text.length;) {
    let j = i;
    while (j < text.length && marked[j] === marked[i]) j++;
    parts.push(marked[i] ? <mark key={i}>{text.slice(i, j)}</mark> : text.slice(i, j));
    i = j;
  }
  return <>{parts}</>;
}
