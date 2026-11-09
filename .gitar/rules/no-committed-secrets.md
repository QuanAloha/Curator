---
title: No committed secrets
description: Credentials stay in environment variables or a secret manager, never in the public repo.
type: check
when: The PR changes any file. Pay closest attention to compose.yaml, .env.example, Dockerfiles, deploy/, k8s/, argocd/, .github/workflows/, scripts/, and backend/app configuration.
actions: Fail the check, post an inline comment on the line that holds the secret, and add the label "security". Tell the author to rotate any credential that was pushed, because the repository is public.
---

# No committed secrets

This repository is public. Flag any:

- API key, token, password, or private key in source, Compose defaults, Kubernetes manifests, workflow files, or scripts. This includes OpenAI keys, Dash0 or OTLP auth headers, database passwords, and GitHub tokens.
- kubeconfig content, cluster certificates, or service-account tokens.
- `.env` files or `*.pem` and `*.key` files being added.
- Kubernetes `Secret` manifests with real `data` or `stringData` values.

Allowed: placeholders in `.env.example` (for example `OPENAI_API_KEY=`), references to `secretKeyRef` or `${{ secrets.* }}`, and obviously fake local development values that are labeled as such.
