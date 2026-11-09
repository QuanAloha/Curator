# go-utah: Curator at the Cloud Native Hackathon

App: https://go-utah.cnh.radarhq.io · Radar Cloud cluster `go-utah` · namespace `team-go-utah`

## Before

Recorded 2026-11-09 15:46 MST, with the starter app deployed through Argo CD (commit `6207b78`).

Radar Checks: https://app.radarhq.io/checks?scope=daORIM1XFlA&namespace=team-go-utah

**Critical 0 · High 0 · Medium 4 · Low 0** (Security 2, Reliability 2)

Medium:
- `automountServiceAccountToken` (Security): Deployment/team-go-utah/app
- `readOnlyRootFs` (Security): Deployment/team-go-utah/app
- `missingPDB` (Reliability): Deployment/team-go-utah/app
- `missingTopologySpread` (Reliability): Deployment/team-go-utah/app
