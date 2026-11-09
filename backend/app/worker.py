"""Database-backed recording-processing worker.

Jobs survive API restarts because their state lives in PostgreSQL. Live/attended
sessions are prioritized using the largest observed audience count; jobs of the
same priority are processed FIFO.
"""

import os
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import httpx

from . import db, observability

WHISPERLIVE_URL = os.getenv("WHISPERLIVE_REST_URL", "http://whisperlive:8000").rstrip("/")
LIBRETRANSLATE_URL = os.getenv("LIBRETRANSLATE_URL", "http://libretranslate:5000").rstrip("/")
ELASTICSEARCH_URL = os.getenv("ELASTICSEARCH_URL", "").rstrip("/")
MODEL = os.getenv("ENHANCED_WHISPER_MODEL", "small")


def claim_job():
    with db.connection() as conn:
        job = conn.execute(
            """SELECT id, session_id, kind FROM processing_jobs
               WHERE status = 'queued'
               ORDER BY priority DESC, created_at ASC
               FOR UPDATE SKIP LOCKED LIMIT 1"""
        ).fetchone()
        if not job:
            return None
        conn.execute(
            """UPDATE processing_jobs SET status = 'processing', progress = 2,
               message = 'Preparing the saved recording for enhanced transcription.',
               attempts = attempts + 1, started_at = now() WHERE id = %s""",
            (job["id"],),
        )
        conn.execute("UPDATE sessions SET transcription_status = 'processing' WHERE id = %s", (job["session_id"],))
        return job


def update_job(job_id: str, progress: int, message: str):
    with db.connection() as conn:
        conn.execute("UPDATE processing_jobs SET progress = %s, message = %s WHERE id = %s", (progress, message[:500], job_id))


def fail_job(job_id: str, session_id: str, message: str):
    with db.connection() as conn:
        job = conn.execute("SELECT attempts FROM processing_jobs WHERE id = %s", (job_id,)).fetchone()
        if job and job["attempts"] < 3:
            conn.execute("UPDATE processing_jobs SET status = 'queued', message = %s WHERE id = %s", (f"Retry scheduled: {message[:400]}", job_id))
            conn.execute("UPDATE sessions SET transcription_status = 'queued' WHERE id = %s", (session_id,))
        else:
            conn.execute("UPDATE processing_jobs SET status = 'failed', message = %s, finished_at = now() WHERE id = %s", (message[:500], job_id))
            conn.execute("UPDATE sessions SET transcription_status = 'failed' WHERE id = %s", (session_id,))


def media_to_wav(source_path: str):
    path = Path(source_path)
    temp_path = Path(tempfile.gettempdir()) / f"conference-audio-{uuid.uuid4()}.wav"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(temp_path)],
        check=True,
        timeout=60 * 20,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    return temp_path


def translate_segment(text: str, source: str, target: str):
    if source == target:
        return text
    response = httpx.post(
        f"{LIBRETRANSLATE_URL}/translate",
        json={"q": text, "source": source, "target": target, "format": "text"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["translatedText"]


def index_segment(segment):
    if not ELASTICSEARCH_URL:
        return
    try:
        httpx.put(
            f"{ELASTICSEARCH_URL}/conference-transcripts/_doc/{segment['id']}?refresh=false",
            json={key: segment[key] for key in ("session_id", "start_seconds", "end_seconds", "language", "text")},
            timeout=3,
        )
    except httpx.HTTPError:
        # PostgreSQL full-text fallback keeps attendee search available.
        pass


def process(job):
    with observability.tracer().start_as_current_span("recording.enhanced_processing") as span:
        span.set_attribute("conference.session_id", job["session_id"])
        span.set_attribute("processing.kind", job["kind"])
        session = db.row("SELECT * FROM sessions WHERE id = %s", (job["session_id"],))
        if not session or not session["media_path"] or not Path(session["media_path"]).is_file():
            raise RuntimeError("The saved session recording could not be found.")

        update_job(job["id"], 5, "Extracting audio from the saved talk recording.")
        wav_path = media_to_wav(session["media_path"])
        try:
            update_job(job["id"], 12, "Running the enhanced speech-to-text model.")
            with wav_path.open("rb") as audio_file:
                response = httpx.post(
                    f"{WHISPERLIVE_URL}/v1/audio/transcriptions",
                    files={"file": ("recording.wav", audio_file, "audio/wav")},
                    data={"model": MODEL, "language": session["source_language"], "response_format": "verbose_json"},
                    timeout=60 * 60,
                )
            response.raise_for_status()
            payload = response.json()
        finally:
            wav_path.unlink(missing_ok=True)

        segments = payload.get("segments") or []
        if not segments and payload.get("text"):
            segments = [{"start": 0, "end": payload.get("duration", 0), "text": payload["text"]}]
        if not segments:
            raise RuntimeError("The transcription service returned no speech segments.")

        update_job(job["id"], 35, "Saving timestamped transcript and preparing translations.")
        translated_segments = []
        interval = max(1, len(segments) // 20)
        for index, segment in enumerate(segments):
            start = max(0.0, float(segment.get("start", 0)))
            end = max(start, float(segment.get("end", start)))
            text = str(segment.get("text", "")).strip()
            if not text:
                continue
            translated_segments.append((start, end, text, session["source_language"]))
            for target in ("en", "es", "tl"):
                if target == session["source_language"]:
                    continue
                try:
                    translated = translate_segment(text, session["source_language"], target)
                except (httpx.HTTPError, KeyError, ValueError):
                    continue
                translated_segments.append((start, end, translated, target))
            if index % interval == 0:
                update_job(job["id"], 40 + int((index / len(segments)) * 45), f"Translating segment {index + 1} of {len(segments)}.")

        with db.connection() as conn:
            conn.execute("DELETE FROM transcript_segments WHERE session_id = %s AND source = 'enhanced'", (job["session_id"],))
            for start, end, text, language in translated_segments:
                conn.execute(
                    """INSERT INTO transcript_segments (session_id, start_seconds, end_seconds, language, text, source)
                       VALUES (%s, %s, %s, %s, %s, 'enhanced')
                       ON CONFLICT (session_id, start_seconds, language) DO UPDATE SET
                         end_seconds = EXCLUDED.end_seconds, text = EXCLUDED.text, source = 'enhanced', updated_at = now()""",
                    (job["session_id"], start, end, language, text),
                )

        stored = db.rows("SELECT * FROM transcript_segments WHERE session_id = %s AND source = 'enhanced'", (job["session_id"],))
        for segment in stored:
            index_segment(segment)
            db.update_interest_matches(segment["id"], job["session_id"], segment["text"])
        with db.connection() as conn:
            conn.execute(
                """UPDATE processing_jobs SET status = 'completed', progress = 100,
                   message = 'Enhanced transcript is ready to read.', finished_at = now() WHERE id = %s""",
                (job["id"],),
            )
            conn.execute("UPDATE sessions SET transcription_status = 'completed' WHERE id = %s", (job["session_id"],))


def main():
    while True:
        try:
            job = claim_job()
            if not job:
                time.sleep(2)
                continue
            try:
                process(job)
            except Exception as exc:
                fail_job(job["id"], job["session_id"], str(exc) or exc.__class__.__name__)
        except Exception:
            # Leave the worker alive through transient database/network failures.
            time.sleep(3)


if __name__ == "__main__":
    db.init_database()
    main()
