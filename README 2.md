# Conference Companion

Conference Companion is a hackathon prototype for making recorded talks easier to follow, search, and revisit. Its first workflow centers on a session viewer with live captions, multilingual transcripts, a searchable transcript, optional AI-assisted Q&A, speaker tools, and an organizer operations view.

The prototype helps validate the AI transcription direction. It does not yet establish whether attendees prefer transcripts, summaries, or question answering; that needs feedback from a real event.

## What the prototype includes

- **Attendee view:** select a session, follow live WhisperLive captions from the recording, choose English, Spanish, or Tagalog, search timestamped transcript segments, view an active poll, submit optional topic interests, and rate a session anonymously.
- **Speaker view:** edit session details and publication status, upload a recording, start enhanced post-session processing, create multiple-choice or true/false polls, see aggregate poll results, and suggest transcript corrections for AI review.
- **Organizer view:** see active viewers, processing queue and job status, aggregate topic interests and session matches, anonymous feedback totals, and service health. An advanced mode adds backend CPU and memory readings.
- **Processing pipeline:** PostgreSQL-backed jobs are prioritized by observed session audience and processed by a separate worker. The worker extracts audio with FFmpeg, requests enhanced transcription from WhisperLive, translates available segments with LibreTranslate, and indexes them in Elasticsearch. Search falls back to PostgreSQL if Elasticsearch is unavailable.
- **Optional AI:** an OpenAI API key enables grounded session Q&A, transcript correction review, and aggregate interest summaries. It is not required to run the stack.

## Architecture

| Service | Purpose | Local address |
| --- | --- | --- |
| React + Nginx | Web interface and API/WebSocket proxy | [http://localhost:3000](http://localhost:3000) |
| FastAPI | Application API, session state, and operational metrics | [http://localhost:8000/docs](http://localhost:8000/docs) |
| PostgreSQL | Sessions, transcript, anonymous aggregates, and durable jobs | `localhost:5432` |
| Processing worker | Enhanced transcription, translation, and indexing | Internal Compose service |
| WhisperLive | Live and enhanced speech transcription | `localhost:9090` (WebSocket) |
| LibreTranslate | Transcript translation | [http://localhost:5001](http://localhost:5001) |
| Elasticsearch | Transcript search index | `localhost:9200` |

## Run locally

1. Install Docker Desktop or Docker Engine with the Compose plugin.
2. Copy `.env.example` to `.env` if you want to set an OpenAI key, Dash0 endpoint, or custom ports. The defaults work without third-party credentials.
3. From the repository root, start the stack:

   ```sh
   docker compose up --build
   ```

4. Open [http://localhost:3000](http://localhost:3000). The database is seeded with a demo event and two sample sessions. Use the view switcher to explore attendee, speaker, and organizer workflows.
5. In the Speaker view, upload a consented recording to try live captions and the enhanced post-session queue. Use a short recording for the first run.

The first start downloads several images and language models. WhisperLive's upstream CPU image is AMD64-only; Compose selects `linux/amd64`, so it runs under emulation on Apple Silicon and transcription may be slow. LibreTranslate also downloads its language models. Database, search index, model cache, and recordings persist in Docker volumes.

Stop with `Ctrl+C` or `docker compose down`. To remove all local data and uploaded recordings as well, run `docker compose down --volumes`.

Useful endpoints:

- Health check: [http://localhost:8000/api/health](http://localhost:8000/api/health)
- OpenAPI explorer: [http://localhost:8000/docs](http://localhost:8000/docs)

If a host port is already in use, change its corresponding value in `.env` (for example `LIBRETRANSLATE_PORT=5002`) and restart Compose. Containers call each other by service name, so internal URLs such as `http://libretranslate:5000` should not be changed to host-mapped ports.

## Dash0 observability

The API and worker use OpenTelemetry. The backend emits request instrumentation and gauges for active viewers, queued work, process CPU, and process memory. The worker emits spans for enhanced recording processing. Audio, transcript text, interest text, and attendee contact details are not added to telemetry attributes.

To export telemetry, copy `.env.example` to `.env` and fill in the OTLP endpoint and headers supplied by your Dash0 account. Then set the applicable exporters to `otlp`, for example:

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=https://YOUR_DASH0_OTLP_ENDPOINT
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20YOUR_TOKEN
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=none
```

Dash0 account endpoints and authentication header formats vary. Use the values from the Radar/Dash0 representative or your Dash0 account, keep credentials in `.env`, and never commit them. Restart the stack after editing environment values. The organizer view shows application-level readings locally; Dash0 is the place to explore exported time-series and traces. This prototype does not yet include a tailored Dash0 dashboard or alert policies.

## Optional OpenAI features

Set `OPENAI_API_KEY` in `.env` to enable AI Q&A grounded in stored transcript segments, aggregate interest summaries, and speaker transcript-edit review. The backend sends only the relevant transcript or aggregate context needed for each request. AI output is advisory and should be reviewed before publishing a transcript correction. Without a key, the rest of the application still runs.

## Gitar and repository workflow

Gitar is a repository/PR workflow tool, not an application container. The project includes a GitHub Actions workflow that builds the frontend, compiles the Python backend, and validates Compose configuration. Connect Gitar to the GitHub repository using the GitHub App and let it review pull requests against this CI workflow. A repository administrator needs to authorize the app. See [Gitar's setup guide](https://www.sonarsource.com/developers/blueprints/get-started-with-gitar/).

## Kubernetes and Radar

`k8s/base` contains a starter Kustomize deployment for a Radar-provided Kubernetes namespace or another cluster. Read [the Kubernetes deployment guide](k8s/README.md) before applying it. The Radar representative needs to provide the cluster context/namespace, image registry, ingress requirements, storage class, and telemetry configuration. The manifests are not deployable to Radar until those environment-specific values are supplied and the images are pushed to an accessible registry.

## Prototype boundaries and next decisions

This is a workflow prototype, not a production conference platform. Role switching is a demo convenience; there is no authentication or role-based authorization. Email, SMS, RSS delivery, attendee accounts, and automatic post-conference contact deletion are not implemented. Interest and feedback endpoints store aggregate counts rather than individual answers. Session data and uploaded media currently have no automatic retention policy. The sample event and operational interfaces are meant for local evaluation.

Before a real event, define speaker recording consent, attendee access controls, retention/deletion rules, contact-delivery providers, production database backups, media storage, TLS, and who may see operational metrics. Validate translation quality and processing times on representative recordings. The local CPU WhisperLive service may not meet live-conference latency or concurrency needs; measure it with Dash0 and the organizer queue before deciding how to scale or whether to use accelerator-backed processing.

For component details, see [project documentation](docs/DOCUMENTATION.md) and the [attendee](docs/ATTENDEE_SPECS.md), [speaker](docs/SPEAKER_SPECS.md), [organizer](docs/ORGANIZER_SPECS.md), and [hackathon technology plan](docs/HACKATHON_TECHNOLOGY_PLAN.md).
