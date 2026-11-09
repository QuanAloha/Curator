import os
import re
import uuid
from pathlib import Path
from typing import Literal

import httpx
import psutil
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import db, observability

MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", "/data/recordings"))
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
WHISPERLIVE_URL = os.getenv("WHISPERLIVE_REST_URL", "http://whisperlive:8000")
LIBRETRANSLATE_URL = os.getenv("LIBRETRANSLATE_URL", "http://libretranslate:5000")
ELASTICSEARCH_URL = os.getenv("ELASTICSEARCH_URL", "").rstrip("/")
SUPPORTED_LANGUAGES = {"en", "es", "tl"}
MAX_MEDIA_BYTES = int(os.getenv("MAX_MEDIA_BYTES", str(1024 * 1024 * 1024)))

app = FastAPI(title="Conference Companion API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
observability.configure(app)


class ViewerHeartbeat(BaseModel):
    viewer_token: str = Field(min_length=12, max_length=80)


class SegmentInput(BaseModel):
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(ge=0)
    language: str = Field(default="en", min_length=2, max_length=8)
    text: str = Field(min_length=1, max_length=5000)
    source: Literal["live", "enhanced"] = "live"


class TranslationInput(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    target_language: Literal["en", "es", "tl"]


class SearchInput(BaseModel):
    session_id: str
    query: str = Field(min_length=1, max_length=160)


class SessionUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    speaker_name: str | None = Field(default=None, max_length=180)
    track: str | None = Field(default=None, max_length=100)
    room: str | None = Field(default=None, max_length=100)
    source_language: Literal["en", "es", "tl"] | None = None
    publish_content: bool | None = None


class PollCreate(BaseModel):
    question: str = Field(min_length=3, max_length=240)
    kind: Literal["multiple_choice", "true_false"]
    options: list[str] = Field(default_factory=list, min_length=2, max_length=8)


class PollVote(BaseModel):
    option_id: int


class InterestInput(BaseModel):
    text: str = Field(min_length=2, max_length=500)


class FeedbackInput(BaseModel):
    rating: int = Field(ge=1, le=5)


class EditInput(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class QuestionInput(BaseModel):
    question: str = Field(min_length=3, max_length=1000)


def _session_or_404(session_id: str):
    session = db.row("SELECT * FROM sessions WHERE id = %s", (session_id,))
    if not session:
        raise HTTPException(404, "Session not found")
    return session


def _service_check(url: str, path: str = "/health") -> str:
    if not url:
        return "not_configured"
    try:
        response = httpx.get(f"{url.rstrip('/')}{path}", timeout=1.5)
        return "available" if response.is_success else "degraded"
    except httpx.HTTPError:
        return "unavailable"


def _whisperlive_status():
    try:
        response = httpx.get(f"{WHISPERLIVE_URL}/health", timeout=1.5)
        response.raise_for_status()
        data = response.json()
        return {"status": "available", "active_clients": data.get("clients", 0), "max_clients": data.get("max_clients")}
    except (httpx.HTTPError, ValueError):
        return {"status": "unavailable", "active_clients": None, "max_clients": None}


def _active_viewer_count(session_id: str) -> int:
    return db.row(
        "SELECT count(*) AS total FROM session_viewers WHERE session_id = %s AND last_seen > now() - interval '90 seconds'",
        (session_id,),
    )["total"]


def _session_payload(session):
    active_viewers = _active_viewer_count(session["id"])
    jobs = db.rows(
        "SELECT id, status, progress, message, created_at, finished_at FROM processing_jobs WHERE session_id = %s ORDER BY created_at DESC LIMIT 5",
        (session["id"],),
    )
    segments = db.row(
        "SELECT count(*) AS total FROM transcript_segments WHERE session_id = %s AND language = %s",
        (session["id"], session["source_language"]),
    )["total"]
    interest_mentions = db.row(
        "SELECT count(*) AS total FROM interest_matches WHERE session_id = %s",
        (session["id"],),
    )["total"]
    transcript_updated = db.row(
        "SELECT max(updated_at) AS updated_at FROM transcript_segments WHERE session_id = %s",
        (session["id"],),
    )["updated_at"]
    result = dict(session)
    result.update(active_viewers=active_viewers, transcript_segments=segments, recent_jobs=jobs,
                  interest_mentions=interest_mentions, transcript_updated_at=transcript_updated)
    result["has_recording"] = bool(session["media_path"])
    result.pop("media_path", None)
    return result


def _index_segment(segment: dict):
    if not ELASTICSEARCH_URL:
        return
    index_doc = {
        "session_id": segment["session_id"],
        "language": segment["language"],
        "start_seconds": segment["start_seconds"],
        "end_seconds": segment["end_seconds"],
        "text": segment["text"],
    }
    try:
        httpx.put(
            f"{ELASTICSEARCH_URL}/conference-transcripts/_doc/{segment['id']}?refresh=wait_for",
            json=index_doc,
            timeout=2,
        )
    except httpx.HTTPError:
        pass


@app.on_event("startup")
def startup():
    db.init_database()
    observability.set_up_metrics()


@app.get("/api/")
def root():
    return {"message": "Conference Companion API is running.", "demo_mode": True}


@app.get("/api/health")
def health():
    try:
        db.row("SELECT 1 AS ok")
        database = "available"
    except Exception:
        database = "unavailable"
    return {
        "status": "ok" if database == "available" else "degraded",
        "demo_mode": True,
        "services": {
            "api": "available",
            "postgres": database,
            "whisperlive": _service_check(WHISPERLIVE_URL),
            "libretranslate": _service_check(LIBRETRANSLATE_URL, "/languages"),
            "elasticsearch": _service_check(ELASTICSEARCH_URL) if ELASTICSEARCH_URL else "optional",
            "openai": "configured" if os.getenv("OPENAI_API_KEY") else "optional_not_configured",
        },
    }


@app.get("/api/events")
def list_events():
    return db.rows(
        """SELECT e.id, e.title, e.description, e.starts_at,
                  count(s.id)::int AS session_count
           FROM events e LEFT JOIN sessions s ON s.event_id = e.id
           GROUP BY e.id ORDER BY e.starts_at"""
    )


@app.get("/api/events/{event_id}/sessions")
def list_sessions(event_id: str):
    sessions = db.rows("SELECT * FROM sessions WHERE event_id = %s ORDER BY starts_at", (event_id,))
    return [_session_payload(session) for session in sessions]


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    return _session_payload(_session_or_404(session_id))


@app.patch("/api/sessions/{session_id}")
def update_session(session_id: str, update: SessionUpdate):
    _session_or_404(session_id)
    changes = update.model_dump(exclude_unset=True)
    if not changes:
        return _session_payload(_session_or_404(session_id))
    assignments = ", ".join(f"{key} = %s" for key in changes)
    db.row(f"UPDATE sessions SET {assignments} WHERE id = %s RETURNING *", (*changes.values(), session_id))
    return _session_payload(_session_or_404(session_id))


@app.post("/api/sessions/{session_id}/media")
async def upload_media(session_id: str, file: UploadFile = File(...)):
    session = _session_or_404(session_id)
    suffix = Path(file.filename or "").suffix.lower()
    allowed = {".mp4", ".mov", ".webm", ".m4v", ".mp3", ".wav", ".m4a", ".aac", ".ogg"}
    if suffix not in allowed:
        raise HTTPException(415, "Upload an MP4, MOV, WebM, MP3, WAV, M4A, AAC, or OGG recording.")
    safe_name = f"{session_id}{suffix}"
    target = MEDIA_ROOT / safe_name
    total = 0
    try:
        with target.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_MEDIA_BYTES:
                    raise HTTPException(413, "Recording is larger than the configured upload limit.")
                destination.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    content_type = file.content_type or "application/octet-stream"
    db.row(
        """UPDATE sessions SET media_path = %s, media_filename = %s, media_type = %s,
           transcription_status = 'recording_ready' WHERE id = %s RETURNING id""",
        (str(target), file.filename, content_type, session_id),
    )
    return {"session_id": session_id, "filename": file.filename, "bytes": total, "media_url": f"/api/sessions/{session_id}/media"}


@app.get("/api/sessions/{session_id}/media")
def get_media(session_id: str, role: str = "attendee"):
    session = _session_or_404(session_id)
    if role not in {"speaker", "organizer", "operator"} and not session["publish_content"]:
        raise HTTPException(403, "This speaker has chosen not to publish the session recording.")
    if not session["media_path"] or not Path(session["media_path"]).is_file():
        raise HTTPException(404, "No recording has been uploaded for this session yet.")
    return FileResponse(session["media_path"], media_type=session["media_type"])


@app.get("/api/sessions/{session_id}/transcript")
def get_transcript(session_id: str, language: str = "en", role: str = "attendee"):
    session = _session_or_404(session_id)
    if role not in {"speaker", "organizer", "operator"} and not session["publish_content"]:
        raise HTTPException(403, "This speaker has chosen not to publish session materials.")
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(400, "Choose English, Spanish, or Tagalog.")
    return db.rows(
        """SELECT id, start_seconds, end_seconds, language, text, source,
                  edited_by_speaker, edit_review_status, updated_at
           FROM transcript_segments WHERE session_id = %s AND language = %s
           ORDER BY start_seconds""",
        (session_id, language),
    )


@app.post("/api/sessions/{session_id}/segments")
def save_live_segment(session_id: str, segment: SegmentInput):
    _session_or_404(session_id)
    if segment.end_seconds < segment.start_seconds:
        raise HTTPException(400, "Segment end must be after its start.")
    saved = db.row(
        """INSERT INTO transcript_segments
           (session_id, start_seconds, end_seconds, language, text, source)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (session_id, start_seconds, language) DO UPDATE SET
             end_seconds = EXCLUDED.end_seconds, text = EXCLUDED.text, source = EXCLUDED.source,
             updated_at = now()
           RETURNING *""",
        (session_id, segment.start_seconds, segment.end_seconds, segment.language, segment.text, segment.source),
    )
    _index_segment(saved)
    db.update_interest_matches(saved["id"], session_id, segment.text)
    with observability.tracer().start_as_current_span("transcript.segment.saved") as span:
        span.set_attribute("conference.session_id", session_id)
        span.set_attribute("transcript.source", segment.source)
        span.set_attribute("transcript.language", segment.language)
    return saved


@app.post("/api/sessions/{session_id}/translate")
def translate_text(session_id: str, request: TranslationInput):
    session = _session_or_404(session_id)
    if request.target_language == session["source_language"]:
        return {"translated_text": request.text, "language": request.target_language}
    try:
        response = httpx.post(
            f"{LIBRETRANSLATE_URL}/translate",
            json={"q": request.text, "source": session["source_language"], "target": request.target_language, "format": "text"},
            timeout=15,
        )
        response.raise_for_status()
        return {"translated_text": response.json()["translatedText"], "language": request.target_language}
    except (httpx.HTTPError, KeyError, ValueError):
        raise HTTPException(503, "Translation is temporarily unavailable. The original transcript is still available.")


@app.post("/api/sessions/{session_id}/viewers/heartbeat")
def viewer_heartbeat(session_id: str, heartbeat: ViewerHeartbeat):
    session = _session_or_404(session_id)
    db.rows("DELETE FROM session_viewers WHERE last_seen < now() - interval '90 seconds' RETURNING session_id")
    db.row(
        """INSERT INTO session_viewers (session_id, viewer_token, last_seen)
           VALUES (%s, %s, now()) ON CONFLICT (session_id, viewer_token)
           DO UPDATE SET last_seen = now() RETURNING session_id""",
        (session_id, heartbeat.viewer_token),
    )
    count = _active_viewer_count(session_id)
    db.row("UPDATE sessions SET max_viewers = greatest(max_viewers, %s) WHERE id = %s RETURNING id", (count, session_id))
    total_active = db.row("SELECT count(*) AS total FROM session_viewers WHERE last_seen > now() - interval '90 seconds'")["total"]
    queued = db.row("SELECT count(*) AS total FROM processing_jobs WHERE status = 'queued'")["total"]
    observability.set_operational_counts(total_active, queued)
    return {"active_viewers": count, "estimated": True, "expires_after_seconds": 90}


@app.post("/api/sessions/{session_id}/viewers/leave")
def viewer_leave(session_id: str, heartbeat: ViewerHeartbeat):
    db.row("DELETE FROM session_viewers WHERE session_id = %s AND viewer_token = %s RETURNING session_id", (session_id, heartbeat.viewer_token))
    return {"ok": True}


@app.post("/api/sessions/{session_id}/jobs")
def enqueue_processing(session_id: str):
    session = _session_or_404(session_id)
    if not session["media_path"] or not Path(session["media_path"]).is_file():
        raise HTTPException(409, "Upload a session recording before requesting enhanced processing.")
    existing = db.row(
        "SELECT * FROM processing_jobs WHERE session_id = %s AND status IN ('queued', 'processing') ORDER BY created_at DESC LIMIT 1",
        (session_id,),
    )
    if existing:
        return existing
    job_id = str(uuid.uuid4())
    # Sessions with a larger observed audience are placed earlier in the queue.
    priority = int(session["max_viewers"] or 0)
    job = db.row(
        """INSERT INTO processing_jobs (id, session_id, priority, message)
           VALUES (%s, %s, %s, 'Recording is queued for enhanced transcription and translation.')
           RETURNING *""",
        (job_id, session_id, priority),
    )
    db.row("UPDATE sessions SET transcription_status = 'queued' WHERE id = %s RETURNING id", (session_id,))
    queued = db.row("SELECT count(*) AS total FROM processing_jobs WHERE status = 'queued'")["total"]
    observability.set_operational_counts(0, queued)
    return job


@app.get("/api/sessions/{session_id}/jobs")
def list_jobs(session_id: str):
    _session_or_404(session_id)
    return db.rows(
        "SELECT id, status, progress, priority, message, created_at, started_at, finished_at FROM processing_jobs WHERE session_id = %s ORDER BY created_at DESC LIMIT 10",
        (session_id,),
    )


@app.get("/api/operator/overview")
def operator_overview():
    db.rows("DELETE FROM session_viewers WHERE last_seen < now() - interval '90 seconds' RETURNING session_id")
    sessions = db.rows("SELECT * FROM sessions ORDER BY starts_at")
    active = db.row("SELECT count(*) AS total FROM session_viewers WHERE last_seen > now() - interval '90 seconds'")["total"]
    queued = db.row("SELECT count(*) AS total FROM processing_jobs WHERE status = 'queued'")["total"]
    processing = db.row("SELECT count(*) AS total FROM processing_jobs WHERE status = 'processing'")["total"]
    completed = db.row("SELECT count(*) AS total FROM processing_jobs WHERE status = 'completed'")["total"]
    process = psutil.Process()
    cpu = process.cpu_percent(interval=None)
    memory_bytes = process.memory_info().rss
    whisper_status = _whisperlive_status()
    observability.set_operational_counts(active, queued, cpu, memory_bytes)
    return {
        "services": {
            "api": "available",
            "postgres": "available",
            "whisperlive": _service_check(WHISPERLIVE_URL),
            "libretranslate": _service_check(LIBRETRANSLATE_URL, "/languages"),
            "elasticsearch": _service_check(ELASTICSEARCH_URL) if ELASTICSEARCH_URL else "optional",
            "openai": "configured" if os.getenv("OPENAI_API_KEY") else "optional_not_configured",
        },
        "counts": {"active_viewers": active, "queued_jobs": queued, "processing_jobs": processing, "completed_jobs": completed},
        "compute": {"backend_cpu_percent": cpu, "backend_memory_mb": round(memory_bytes / (1024 * 1024), 1), "whisperlive": whisper_status},
        "sessions": [_session_payload(session) for session in sessions],
        "jobs": db.rows("SELECT id, session_id, status, progress, priority, message, created_at FROM processing_jobs ORDER BY created_at DESC LIMIT 25"),
    }


@app.post("/api/events/{event_id}/interests")
def submit_interest(event_id: str, submission: InterestInput):
    if not db.row("SELECT id FROM events WHERE id = %s", (event_id,)):
        raise HTTPException(404, "Event not found")
    # Keep only aggregate topic tokens. Raw responses, names, emails, and phone numbers are not persisted.
    text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", " ", submission.text.lower())
    text = re.sub(r"\+?[\d(). -]{7,}", " ", text)
    words = re.findall(r"[a-z][a-z0-9-]{2,}", text)
    stop = {"the", "and", "for", "with", "from", "that", "this", "would", "like", "learn", "about", "conference"}
    topics = list(dict.fromkeys(word for word in words if word not in stop))[:8]
    if not topics:
        return {"accepted": True, "topics_added": 0, "message": "No aggregate topic terms were detected."}
    with db.connection() as conn:
        for topic in topics:
            conn.execute(
                """INSERT INTO interest_topics (event_id, topic, count) VALUES (%s, %s, 1)
                   ON CONFLICT (event_id, topic) DO UPDATE SET count = interest_topics.count + 1""",
                (event_id, topic),
            )
    return {"accepted": True, "topics_added": len(topics), "stored": "aggregate topic counts only"}


@app.get("/api/events/{event_id}/interests")
def list_interest_topics(event_id: str):
    return db.rows("SELECT topic, count FROM interest_topics WHERE event_id = %s ORDER BY count DESC, topic LIMIT 30", (event_id,))


@app.post("/api/events/{event_id}/interest-summary")
def summarize_interests(event_id: str):
    if not db.row("SELECT id FROM events WHERE id = %s", (event_id,)):
        raise HTTPException(404, "Event not found")
    topics = db.rows("SELECT topic, count FROM interest_topics WHERE event_id = %s ORDER BY count DESC LIMIT 50", (event_id,))
    if not topics:
        raise HTTPException(409, "There are no aggregate interest topics to summarize yet.")
    prompt = "\n".join(f"{item['topic']}: {item['count']} mentions" for item in topics)
    text = _openai_text(
        "Summarize only these aggregate conference learning-interest counts into 3–5 useful themes for an organizer. Do not infer personal attributes or claim these counts represent attendance.",
        f"Aggregate topic counts:\n{prompt}",
    )
    return {"summary": text, "topics": topics, "model": os.getenv("OPENAI_MODEL", "gpt-6-astra")}


@app.post("/api/sessions/{session_id}/polls")
def create_poll(session_id: str, request: PollCreate):
    _session_or_404(session_id)
    if request.kind == "true_false":
        options = ["True", "False"]
    else:
        options = [option.strip() for option in request.options if option.strip()]
        if len(options) < 2 or len(set(options)) != len(options):
            raise HTTPException(400, "Multiple-choice polls need 2–8 distinct options.")
        if any(len(option) > 100 for option in options):
            raise HTTPException(400, "Poll choices must be 100 characters or fewer.")
    poll_id = str(uuid.uuid4())
    with db.connection() as conn:
        poll = conn.execute(
            "INSERT INTO polls (id, session_id, question, kind) VALUES (%s, %s, %s, %s) RETURNING *",
            (poll_id, session_id, request.question, request.kind),
        ).fetchone()
        for option in options:
            conn.execute("INSERT INTO poll_options (poll_id, label) VALUES (%s, %s)", (poll_id, option))
    return _poll_payload(poll_id)


def _poll_payload(poll_id: str):
    poll = db.row("SELECT * FROM polls WHERE id = %s", (poll_id,))
    if not poll:
        raise HTTPException(404, "Poll not found")
    options = db.rows("SELECT id, label, votes FROM poll_options WHERE poll_id = %s ORDER BY id", (poll_id,))
    return {**poll, "options": options, "total_votes": sum(option["votes"] for option in options)}


@app.get("/api/sessions/{session_id}/polls")
def list_polls(session_id: str):
    _session_or_404(session_id)
    polls = db.rows("SELECT id FROM polls WHERE session_id = %s ORDER BY created_at DESC", (session_id,))
    return [_poll_payload(poll["id"]) for poll in polls]


@app.post("/api/polls/{poll_id}/activate")
def activate_poll(poll_id: str):
    poll = db.row("UPDATE polls SET active = TRUE WHERE id = %s RETURNING id", (poll_id,))
    if not poll:
        raise HTTPException(404, "Poll not found")
    return _poll_payload(poll_id)


@app.post("/api/polls/{poll_id}/close")
def close_poll(poll_id: str):
    poll = db.row("UPDATE polls SET active = FALSE WHERE id = %s RETURNING id", (poll_id,))
    if not poll:
        raise HTTPException(404, "Poll not found")
    return _poll_payload(poll_id)


@app.post("/api/polls/{poll_id}/vote")
def cast_poll_vote(poll_id: str, vote: PollVote):
    poll = db.row("SELECT active FROM polls WHERE id = %s", (poll_id,))
    if not poll:
        raise HTTPException(404, "Poll not found")
    if not poll["active"]:
        raise HTTPException(409, "This poll is closed.")
    updated = db.row("UPDATE poll_options SET votes = votes + 1 WHERE id = %s AND poll_id = %s RETURNING id", (vote.option_id, poll_id))
    if not updated:
        raise HTTPException(404, "Poll choice not found")
    return _poll_payload(poll_id)


@app.post("/api/sessions/{session_id}/feedback")
def submit_feedback(session_id: str, feedback: FeedbackInput):
    _session_or_404(session_id)
    db.row(
        """INSERT INTO feedback_counts (session_id, rating, count) VALUES (%s, %s, 1)
           ON CONFLICT (session_id, rating) DO UPDATE SET count = feedback_counts.count + 1
           RETURNING count""",
        (session_id, feedback.rating),
    )
    return {"accepted": True, "stored": "anonymous aggregate count only"}


@app.get("/api/sessions/{session_id}/feedback")
def get_feedback(session_id: str):
    _session_or_404(session_id)
    return db.rows("SELECT rating, count FROM feedback_counts WHERE session_id = %s ORDER BY rating", (session_id,))


@app.post("/api/search")
def search(request: SearchInput):
    session = _session_or_404(request.session_id)
    if not session["publish_content"]:
        raise HTTPException(403, "This session is not published for attendee search.")
    query = request.query.strip()
    if ELASTICSEARCH_URL:
        try:
            response = httpx.post(
                f"{ELASTICSEARCH_URL}/conference-transcripts/_search",
                json={"size": 30, "query": {"bool": {"must": [{"match": {"text": query}}], "filter": [{"term": {"session_id.keyword": request.session_id}}]}}},
                timeout=2,
            )
            response.raise_for_status()
            hits = response.json()["hits"]["hits"]
            if hits:
                return [{"id": hit["_id"], **hit["_source"]} for hit in hits]
        except (httpx.HTTPError, KeyError, ValueError):
            pass
    return db.rows(
        """SELECT id, session_id, start_seconds, end_seconds, language, text
           FROM transcript_segments WHERE session_id = %s AND language = %s AND text ILIKE %s
           ORDER BY start_seconds LIMIT 30""",
        (request.session_id, session["source_language"], f"%{query}%"),
    )


def _openai_text(instructions: str, prompt: str):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(503, "OpenAI is not configured. Add OPENAI_API_KEY to enable this optional feature.")
    try:
        response = httpx.post(
            "https://api.openai.com/v1/responses",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": os.getenv("OPENAI_MODEL", "gpt-6-astra"),
                "store": False,
                "instructions": instructions,
                "input": prompt,
                "max_output_tokens": 800,
            },
            timeout=45,
        )
        response.raise_for_status()
        data = response.json()
        output = []
        for item in data.get("output", []):
            for content in item.get("content", []):
                if content.get("type") == "output_text":
                    output.append(content.get("text", ""))
        if not output:
            raise ValueError("The model response did not contain text output.")
        return "\n".join(output)
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "AI processing is temporarily unavailable.") from exc


@app.post("/api/sessions/{session_id}/summary")
def summarize_session(session_id: str):
    session = _session_or_404(session_id)
    if not session["publish_content"]:
        raise HTTPException(403, "This speaker has chosen not to publish session materials.")
    segments = db.rows(
        "SELECT start_seconds, text FROM transcript_segments WHERE session_id = %s AND language = %s ORDER BY start_seconds LIMIT 500",
        (session_id, session["source_language"]),
    )
    if not segments:
        raise HTTPException(409, "There is no transcript to summarize yet.")
    transcript = "\n".join(f"[{segment['start_seconds']:.1f}s] {segment['text']}" for segment in segments)[:24000]
    text = _openai_text(
        "Summarize this conference talk in plain language. Use only the transcript. Include 3–5 takeaways and note uncertainty. Do not invent claims.",
        f"Session: {session['title']}\nTranscript:\n{transcript}",
    )
    return {"summary": text, "model": os.getenv("OPENAI_MODEL", "gpt-6-astra")}


@app.post("/api/sessions/{session_id}/ask")
def ask_about_session(session_id: str, request: QuestionInput):
    session = _session_or_404(session_id)
    if not session["publish_content"]:
        raise HTTPException(403, "This speaker has chosen not to publish session materials.")
    words = re.findall(r"[a-zA-Z0-9-]{3,}", request.question.lower())
    terms = list(dict.fromkeys(words))[:8]
    if not terms:
        raise HTTPException(400, "Ask a question with a few specific words.")
    conditions = " OR ".join(["text ILIKE %s"] * len(terms))
    params = [session_id, session["source_language"], *[f"%{term}%" for term in terms]]
    sources = db.rows(
        f"""SELECT start_seconds, end_seconds, text FROM transcript_segments
            WHERE session_id = %s AND language = %s AND ({conditions})
            ORDER BY start_seconds LIMIT 12""",
        tuple(params),
    )
    if not sources:
        raise HTTPException(404, "I could not find a relevant passage in this talk yet.")
    evidence = "\n".join(f"[{source['start_seconds']:.1f}s–{source['end_seconds']:.1f}s] {source['text']}" for source in sources)
    answer = _openai_text(
        "Answer the attendee using only the provided transcript passages. If they do not contain the answer, say you could not find it in this talk. Cite supporting timestamps inline like [01:23]. Never invent a quotation or claim.",
        f"Question: {request.question}\nTranscript passages:\n{evidence}",
    )
    return {"answer": answer, "sources": sources, "model": os.getenv("OPENAI_MODEL", "gpt-6-astra")}


@app.post("/api/segments/{segment_id}/speaker-edit")
def review_speaker_edit(segment_id: int, edit: EditInput):
    original = db.row("SELECT * FROM transcript_segments WHERE id = %s", (segment_id,))
    if not original:
        raise HTTPException(404, "Transcript segment not found")
    _session_or_404(original["session_id"])
    review = _openai_text(
        "You review a speaker's correction to an automated transcript. Approve only if the edit is a plausible correction of the spoken words and does not add unsupported claims. Return exactly JSON with keys approved (boolean) and note (short string).",
        f"Original transcript segment: {original['text']}\nSpeaker's proposed edit: {edit.text}",
    )
    import json

    try:
        decision = json.loads(review)
    except json.JSONDecodeError:
        raise HTTPException(502, "AI review returned an unreadable decision; the transcript was not changed.")
    if not decision.get("approved"):
        return {"approved": False, "note": decision.get("note", "The edit needs a human review."), "transcript": original}
    updated = db.row(
        """UPDATE transcript_segments SET text = %s, edited_by_speaker = TRUE,
           edit_review_status = 'ai_reviewed', updated_at = now() WHERE id = %s RETURNING *""",
        (edit.text, segment_id),
    )
    _index_segment(updated)
    return {"approved": True, "note": decision.get("note", "Reviewed by AI."), "transcript": updated}


@app.post("/api/telemetry/client-event")
def record_client_event(payload: dict):
    # This endpoint accepts only an allowlisted event name and coarse device category.
    allowed = {"session_joined", "transcript_delay", "translation_unavailable", "media_playback_error", "websocket_reconnect"}
    name = payload.get("name")
    if name not in allowed:
        raise HTTPException(400, "Unsupported client event")
    observability.meter().create_counter("conference.frontend.events").add(1, {"event.name": name})
    return {"accepted": True}
