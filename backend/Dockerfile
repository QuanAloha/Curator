FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

# Run as a non-root user (numeric, so Kubernetes runAsNonRoot can verify it).
RUN useradd --uid 1000 --create-home appuser && mkdir -p /data/recordings && chown -R 1000:1000 /data
USER 1000

EXPOSE 8000
CMD ["opentelemetry-instrument", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
