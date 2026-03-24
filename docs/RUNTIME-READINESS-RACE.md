# Runtime readiness race (Steve Chat)

## What was observed
A short window exists where:
1. `GET /v1/models` returns `200`, but
2. immediate `POST /v1/chat/completions` still returns transient failure (`503` or fetch/connection flap).

## Why this happens
Model-list endpoint and generation pipeline readiness are not perfectly simultaneous during warmup/restart.

A second UI-layer race was also observed when pressing **Apply model**:
- `applyModelProfile()` starts runtime switch,
- `detectModels()` may still see transient `503 Loading model`,
- reasoning capability probe could run during this same warmup window,
- both paths previously attempted auto-recovery, causing status sequence noise:
  1) "Runtime seems down... attempting auto-start"
  2) "Runtime unreachable... attempting auto-start"
  3) eventual connect.

## How Steve Chat now reasons about it
In `src/steve-chat-app.js`:
- `isTransientRuntimeError(...)` classifies warmup/network-ish failures.
- `isLoadingModelTransient(...)` isolates "model still loading" from true endpoint-down failures.
- `shouldAttemptRuntimeAutoRecover(...)` only permits auto-start on real network/endpoint failures.
- `detectModels(...)` now:
  - waits longer on loading-model transients,
  - avoids immediate restart loops during normal warmup,
  - only auto-starts when recovery is actually appropriate.
- `withRuntimeRetry(...)` now supports `allowAutoRecover` + `suppressStatus` so background probes do not trigger user-facing restart noise.
- reasoning capability probe is timeout-bounded and does not run heavy recovery actions while runtime is still in working/warmup state.
- `sendLive(...)` uses retry wrapper for:
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
