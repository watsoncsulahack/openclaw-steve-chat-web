# Steve Chat Runtime Stabilization Profile

Last updated (UTC): 2026-03-25

## Goal
Reduce model-switch instability and output contamination when switching between Gemma and BitNet families on mobile runtime.

## Profile policy

### 1) Warmup-first policy
- Treat `HTTP 503: Loading model` as normal warmup, not immediate hard-fail.
- Do not trigger restart loops during normal warmup window.

### 2) Recovery gate policy
- Auto-restart only on true endpoint/network failures (`Failed to fetch`, `ECONN`, connection refused/timeouts).
- Suppress noisy recovery status from background probes.

### 3) Prompt-history hygiene
- Strip template control tokens from assistant history before reuse.
- Drop low-signal assistant artifacts from runtime history (e.g., `(generation stopped)`, tiny control-like replies).
- Keep short, bounded history window for stability:
  - `maxHistoryMessages = 10`
  - `historyTokenBudget = 260`

### 4) UX stability
- Do not force auto-scroll to bottom while user is reading older content.
- Keep multiline composer behavior and preserve send via button/Ctrl+Enter.

## Known model behavior notes
- BitNet `tq1` may emit chat-template-looking text depending prompt/template compatibility.
- BitNet `tq2` may become unstable on this device/runtime path (503 -> connection refused).
- Gemma E4B can work but may require extended warmup.

## Operational recommendation
- Use Gemma E2B as default stable path.
- Use E4B as heavy profile with longer warmup.
- Treat BitNet tq2 as experimental until runtime stability is improved upstream.
