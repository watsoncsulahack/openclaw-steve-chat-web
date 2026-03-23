# Runtime readiness race (Steve Chat)

## What was observed
A short window exists where:
1. `GET /v1/models` returns `200`, but
2. immediate `POST /v1/chat/completions` still returns transient failure (`503` or fetch/connection flap).

## Why this happens
Model-list endpoint and generation pipeline readiness are not perfectly simultaneous during warmup/restart.

## How Steve Chat now reasons about it
In `src/steve-chat-app.js`:
- `isTransientRuntimeError(...)` classifies warmup/network-ish failures.
- `withRuntimeRetry(...)` performs one warmup-aware retry before surfacing failure.
- `sendLive(...)` uses that wrapper for:
  - streaming (`streamChat`)
  - fallback non-stream call (`completeOnce`)
  - regular non-stream call (`completeOnce`)

## Executed runtime calls (high level)
1. Preflight model detect (`fetchModelsWithRetry`)
2. Stream or complete call
3. If transient failure, warmup probe + retry once
4. If still failing, show user-facing error bubble

## Repro script
Read and run:

`scripts/repro_runtime_readiness_race.sh`

Example:

```bash
bash scripts/repro_runtime_readiness_race.sh
```

The script prints each step and shows if models are up before chat is fully ready.
