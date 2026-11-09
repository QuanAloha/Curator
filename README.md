# Conference Companion

Conference Companion is a hackathon prototype for making recorded talks easier to follow, search, and revisit. It includes an attendee session viewer with captions and searchable transcripts, speaker tools for managing sessions and recordings, and an organizer operations view.

The prototype explores AI transcription and related workflows. Attendee preferences and performance at a real event still need validation.

## Run locally with Docker Compose

Install Docker Desktop or Docker Engine with the Compose plugin. From the repository root:

```sh
cp .env.example .env
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). The stack includes:

| Service | Purpose | Local address |
| --- | --- | --- |
| React + Nginx | Web interface and API/WebSocket proxy | [localhost:3000](http://localhost:3000) |
| FastAPI | Application API and operational metrics | [localhost:8000/docs](http://localhost:8000/docs) |
| PostgreSQL | Sessions, transcripts, aggregates, and jobs | `localhost:5432` |
| WhisperLive | Live and enhanced speech transcription | `localhost:9090` (WebSocket) |
| LibreTranslate | Transcript translation | [localhost:5001](http://localhost:5001) |
| Elasticsearch | Transcript search index | [localhost:9200](http://localhost:9200) |
| Worker | Background transcription, translation, and indexing | Internal Compose service |

The first run downloads container images and language models. WhisperLive's CPU image is AMD64-only, so Apple Silicon uses emulation and transcription may be slow. PostgreSQL, Elasticsearch, model caches, and uploaded recordings persist in Docker volumes.

Stop the stack with `Ctrl+C` or `docker compose down`. To also delete the local database, search index, model caches, and recordings, run `docker compose down --volumes`.

Ports can be changed in `.env` (for example, `LIBRETRANSLATE_PORT=5002`). Containers communicate using Compose service names and container ports; keep internal URLs such as `http://libretranslate:5000` unchanged.

## Configuration

Copy `.env.example` to `.env` to configure optional features. The application runs without third-party credentials.

- `OPENAI_API_KEY` enables transcript-grounded Q&A, transcript correction review, and aggregate interest summaries.
- `OTEL_EXPORTER_OTLP_*` values configure optional OpenTelemetry export to Dash0 or another OTLP endpoint.
- Port variables let you change host ports if they are already in use.

Keep API keys and telemetry authorization headers in `.env`. Never commit populated credentials or put them in an image. AI suggestions are advisory and transcript corrections should be reviewed before publishing.

## Project layout and containers

- `frontend/` contains the React UI and Nginx configuration.
- `backend/` contains the FastAPI API, background worker, and Python dependencies.
- `compose.yaml` runs the complete local development stack.
- `app/` and the root `Dockerfile` contain the lightweight Node starter currently used by the hackathon Kubernetes manifests in `deploy/`.
- `docs/` contains product and implementation documentation.

The full Compose stack is for local development. The current `deploy/` manifests deploy only the Node starter image; they do not deploy the Compose services or the Conference Companion frontend/backend. Read [k8s/README.md](k8s/README.md) before adapting Kubernetes deployment for the full application.

## Kubernetes and Radar hackathon workflow

This repository also contains the hackathon's GitOps starter setup. The team cluster is a virtual Kubernetes cluster managed through Radar Cloud; Argo CD syncs the `deploy/` directory after its Application is installed. Follow the repository's [AGENTS.md](AGENTS.md) and the applicable procedures in [`.agents/skills/`](.agents/skills/) for team setup, Radar access, shipping, troubleshooting, and release workflows.

The app's public hackathon URL is `https://<team-name>.cnh.radarhq.io`. The platform routes it to Service `app` on port 80 in namespace `team-<team-name>`. Keep that Service in place when changing the app deployment. Do not commit kubeconfigs, credentials, or private keys; the repository is public.

For optional Kubernetes components, credentials, jobs, databases, autoscaling, and canary deployments, see the corresponding guides in [`examples/`](examples/).

## Observability

The API emits request instrumentation and application metrics; the worker emits spans for enhanced recording processing. Audio, transcript text, attendee contact details, and interest text are not added to telemetry attributes. Locally, the organizer view includes application-level operational readings. Configure an OTLP exporter in `.env` to inspect traces and metrics in Dash0. This prototype does not include a custom Dash0 dashboard or alert policies.

## Prototype boundaries

Role switching is a demo convenience; the prototype has no authentication or role-based authorization. Email, SMS, RSS delivery, attendee accounts, and automatic post-conference contact deletion are not implemented. Session data and uploaded media have no automatic retention policy.

Before using the project at a real event, define recording consent, access controls, retention and deletion rules, production backups, media storage, TLS, and access to operational metrics. Measure transcription latency and concurrency with representative recordings; the local CPU WhisperLive service may not meet live-event requirements.

See [project documentation](docs/DOCUMENTATION.md), the [attendee specs](docs/ATTENDEE_SPECS.md), [speaker specs](docs/SPEAKER_SPECS.md), [organizer specs](docs/ORGANIZER_SPECS.md), and [hackathon technology plan](docs/HACKATHON_TECHNOLOGY_PLAN.md).

## Gitar and repository workflow

Gitar is a repository and pull request review tool, not an application container. See [TEST_GITAR.md](TEST_GITAR.md), [Gitar review guidance](docs/GITAR_REVIEW_GUIDANCE.md), and [Gitar's setup guide](https://www.sonarsource.com/developers/blueprints/get-started-with-gitar/).
