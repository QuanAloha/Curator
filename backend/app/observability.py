"""OpenTelemetry setup and low-cardinality application metrics.

Export is configured entirely by OTEL_* environment variables read by
`opentelemetry-instrument` (see backend/Dockerfile). With the exporters set to
`none`, every call here is a cheap no-op, so the app works without Dash0.

Telemetry describes how the system behaves, never what people said: no audio,
transcript text, names, contact details or search terms in attributes or labels.
"""

import logging

from opentelemetry import metrics, trace
from opentelemetry.metrics import Observation

logger = logging.getLogger("conference")

_instrumented = False
_metrics_registered = False
_active_viewers = 0
_queued_jobs = 0
_backend_cpu_percent = 0.0
_backend_memory_bytes = 0

# Instruments are created once and reused; creating them per request leaks
# duplicate-instrument warnings and wastes work.
_instruments: dict = {}

# Allowlisted values for client-reported attributes, to keep cardinality bounded.
DEVICE_CATEGORIES = {"mobile", "tablet", "desktop", "unknown"}
# Delays above this are clamped: they indicate a stalled stream, not a useful sample.
MAX_CLIENT_DELAY_SECONDS = 600.0


def configure(app):
    global _instrumented
    if _instrumented:
        return
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        FastAPIInstrumentor.instrument_app(app)
    except Exception:
        # OTel is optional for a local demo without an exporter configuration.
        pass
    _instrumented = True


def set_operational_counts(active_viewers=None, queued_jobs=None, backend_cpu_percent=None, backend_memory_bytes=None):
    """Update the observable gauges. Values left as None keep their last reading."""
    global _active_viewers, _queued_jobs, _backend_cpu_percent, _backend_memory_bytes
    if active_viewers is not None:
        _active_viewers = active_viewers
    if queued_jobs is not None:
        _queued_jobs = queued_jobs
    if backend_cpu_percent is not None:
        _backend_cpu_percent = backend_cpu_percent
    if backend_memory_bytes is not None:
        _backend_memory_bytes = backend_memory_bytes


def set_up_metrics():
    """Register the API's observable gauges. Safe to call more than once."""
    global _metrics_registered
    if _metrics_registered:
        return
    meter = metrics.get_meter("conference-companion")
    meter.create_observable_gauge(
        "conference.active_viewers",
        callbacks=[lambda _options: [Observation(_active_viewers)]],
        description="Currently active anonymous session viewers",
    )
    meter.create_observable_gauge(
        "conference.backend.process.cpu.utilization",
        callbacks=[lambda _options: [Observation(_backend_cpu_percent / 100)]],
        unit="1",
        description="FastAPI process CPU utilization as a fraction",
    )
    meter.create_observable_gauge(
        "conference.backend.process.memory.usage",
        callbacks=[lambda _options: [Observation(_backend_memory_bytes)]],
        unit="By",
        description="FastAPI process resident memory in bytes",
    )
    meter.create_observable_gauge(
        "conference.processing_jobs.queued",
        callbacks=[lambda _options: [Observation(_queued_jobs)]],
        description="Queued recording processing jobs",
    )
    _metrics_registered = True


def _instrument(name: str, factory):
    if name not in _instruments:
        _instruments[name] = factory(metrics.get_meter("conference-companion"))
    return _instruments[name]


def frontend_events():
    return _instrument("frontend_events", lambda m: m.create_counter(
        "conference.frontend.events",
        description="Allowlisted client-side events reported by the web app",
    ))


def transcript_delay():
    return _instrument("transcript_delay", lambda m: m.create_histogram(
        "conference.transcript.delay",
        unit="s",
        description="Time from speech ending to its live caption arriving in the browser",
    ))


def translation_duration():
    return _instrument("translation_duration", lambda m: m.create_histogram(
        "conference.translation.duration",
        unit="s",
        description="Time to translate one transcript segment through LibreTranslate",
    ))


def processing_duration():
    return _instrument("processing_duration", lambda m: m.create_histogram(
        "conference.processing.duration",
        unit="s",
        description="Time for one enhanced-processing stage of a saved recording",
    ))


def processing_jobs():
    return _instrument("processing_jobs", lambda m: m.create_counter(
        "conference.processing.jobs",
        description="Enhanced-processing jobs finished, by outcome",
    ))


def tracer():
    return trace.get_tracer("conference-companion")


def meter():
    return metrics.get_meter("conference-companion")
