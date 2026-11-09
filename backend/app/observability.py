"""OpenTelemetry setup and low-cardinality application metrics."""

from opentelemetry import metrics, trace
from opentelemetry.metrics import Observation

_instrumented = False
_active_viewers = 0
_queued_jobs = 0
_backend_cpu_percent = 0.0
_backend_memory_bytes = 0


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


def set_operational_counts(active_viewers: int, queued_jobs: int, backend_cpu_percent=None, backend_memory_bytes=None):
    global _active_viewers, _queued_jobs, _backend_cpu_percent, _backend_memory_bytes
    _active_viewers = active_viewers
    _queued_jobs = queued_jobs
    if backend_cpu_percent is not None:
        _backend_cpu_percent = backend_cpu_percent
    if backend_memory_bytes is not None:
        _backend_memory_bytes = backend_memory_bytes


def set_up_metrics():
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


def tracer():
    return trace.get_tracer("conference-companion")


def meter():
    return metrics.get_meter("conference-companion")
