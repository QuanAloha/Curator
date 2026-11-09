# Kubernetes and Radar deployment

The local default remains Docker Compose. This directory is a starter deployment for a Radar-provided Kubernetes namespace or another cluster. Radar can inspect the workloads only after these services are deployed in a cluster it can access.

## Before applying

Ask the Radar representative or cluster administrator for:

- the namespace and kubeconfig/context;
- the supported ingress class and host/TLS requirements;
- a registry where the frontend and backend/worker images can be pushed, plus pull credentials if it is private;
- whether the storage class supports `ReadWriteMany` for the recordings volume; and
- whether Metrics Server and the HorizontalPodAutoscaler APIs are available.

Build and push the backend and frontend images using the registry paths provided by the team. Update the `image` fields in `base/workloads.yaml` to those paths. Create the namespace or select the provided namespace, then create the `conference-secrets` secret with the demo database credentials. Do not commit secret values:

```sh
kubectl -n YOUR_NAMESPACE create secret generic conference-secrets \
  --from-literal=DATABASE_URL='postgresql://conference:YOUR_PASSWORD@postgres:5432/conference' \
  --from-literal=POSTGRES_PASSWORD='YOUR_PASSWORD' \
  --from-literal=OPENAI_API_KEY='YOUR_OPENAI_KEY'
```

If using Dash0, add `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` to that secret and change the OTEL exporter values in `base/config.yaml` to `otlp`. Keep the token out of Git.

Apply the manifests in the provided namespace:

```sh
kubectl -n YOUR_NAMESPACE apply -k k8s/base
kubectl -n YOUR_NAMESPACE get pods,services,ingress
```

Configure DNS or a local hosts entry for `conference.local` according to the cluster ingress instructions.

## Current prototype limits

- PostgreSQL and Elasticsearch are single-replica demo deployments. They are not production database configurations and need backups, access controls, and an operator/managed service before production use.
- The recordings claim requires a `ReadWriteMany` storage class because the API and worker pods share files. If the provided cluster lacks RWX storage, use object storage or adjust the architecture before deploying.
- CPU-based HPAs require Metrics Server. They scale copies of the API and worker but do not set job priorities; the PostgreSQL queue orders jobs by recorded engagement.
- The worker queue can process multiple jobs, but each WhisperLive pod is still a compute bottleneck. Scale WhisperLive only after confirming its model memory, session limits, and available CPU/GPU capacity.
- The WhisperLive image is the upstream CPU image. Confirm node architecture and available resources with the Radar team.
- This namespace deployment is for a hackathon demo. It has no attendee authentication, TLS policy, production secret rotation, or high-availability database setup.
