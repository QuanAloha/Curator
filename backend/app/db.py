import os
import re
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://conference:conference_dev_password@postgres:5432/conference")

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    starts_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    speaker_name TEXT NOT NULL DEFAULT '',
    track TEXT NOT NULL DEFAULT '',
    room TEXT NOT NULL DEFAULT '',
    starts_at TIMESTAMPTZ,
    source_language TEXT NOT NULL DEFAULT 'en',
    publish_content BOOLEAN NOT NULL DEFAULT TRUE,
    media_path TEXT,
    media_filename TEXT,
    media_type TEXT,
    transcription_status TEXT NOT NULL DEFAULT 'ready',
    max_viewers INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS transcript_segments (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    start_seconds DOUBLE PRECISION NOT NULL,
    end_seconds DOUBLE PRECISION NOT NULL,
    language TEXT NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'live',
    edited_by_speaker BOOLEAN NOT NULL DEFAULT FALSE,
    edit_review_status TEXT NOT NULL DEFAULT 'not_applicable',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(session_id, start_seconds, language)
);
CREATE INDEX IF NOT EXISTS transcript_segments_session_time ON transcript_segments(session_id, start_seconds);
CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'enhanced_transcription',
    status TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS processing_jobs_queue ON processing_jobs(status, priority DESC, created_at ASC);
CREATE TABLE IF NOT EXISTS session_viewers (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    viewer_token TEXT NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(session_id, viewer_token)
);
CREATE TABLE IF NOT EXISTS interest_topics (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(event_id, topic)
);
CREATE TABLE IF NOT EXISTS interest_matches (
    segment_id BIGINT NOT NULL REFERENCES transcript_segments(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    PRIMARY KEY(segment_id, topic)
);
CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('multiple_choice', 'true_false')),
    active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS poll_options (
    id BIGSERIAL PRIMARY KEY,
    poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    votes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS feedback_counts (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL CHECK(rating BETWEEN 1 AND 5),
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(session_id, rating)
);
"""


@contextmanager
def connection():
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_database():
    with connection() as conn:
        for statement in SCHEMA.split(";"):
            if statement.strip():
                conn.execute(statement)
        conn.execute(
            """INSERT INTO events (id, title, description, starts_at)
               VALUES ('demo-event', 'Conference Companion Demo',
               'A sample conference space for exploring live sessions, transcripts, and translation.', now())
               ON CONFLICT (id) DO NOTHING"""
        )
        conn.execute(
            """INSERT INTO sessions
               (id, event_id, title, description, speaker_name, track, room, starts_at, source_language)
               VALUES
               ('session-ai-learning', 'demo-event', 'Designing for better learning',
                'A sample session exploring how technology can help people learn and share ideas.',
                'Jordan Miller', 'Product & Learning', 'Studio A', now() + interval '1 hour', 'en'),
               ('session-observability', 'demo-event', 'Making busy systems easier to understand',
                'A sample session about observing systems under real-world load.',
                'Sam Rivera', 'Cloud Native', 'Studio B', now() + interval '2 hours', 'en')
               ON CONFLICT (id) DO NOTHING"""
        )


def rows(query: str, params: tuple = ()):
    with connection() as conn:
        return conn.execute(query, params).fetchall()


def row(query: str, params: tuple = ()):
    with connection() as conn:
        return conn.execute(query, params).fetchone()


def update_interest_matches(segment_id: int, session_id: str, text: str):
    """Match aggregate pre-event topics against transcript text without retaining search queries."""
    session = row("SELECT event_id FROM sessions WHERE id = %s", (session_id,))
    if not session:
        return
    words = set(re.findall(r"[a-z][a-z0-9-]{2,}", text.lower()))
    with connection() as conn:
        conn.execute("DELETE FROM interest_matches WHERE segment_id = %s", (segment_id,))
        topics = conn.execute("SELECT topic FROM interest_topics WHERE event_id = %s", (session["event_id"],)).fetchall()
        for item in topics:
            if item["topic"] in words:
                conn.execute(
                    """INSERT INTO interest_matches (segment_id, event_id, session_id, topic)
                       VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                    (segment_id, session["event_id"], session_id, item["topic"]),
                )
