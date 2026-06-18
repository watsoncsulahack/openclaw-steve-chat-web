# Steve Chat Audio Integration Plan (STT/TTS/Calls)

Last updated (UTC): 2026-06-18

## Scope order (as requested)
1. **Now:** Enable/validate reasoning output path in local runtimes.
2. **Next:** Speech-to-text integration for microphone workflow.
3. **Then:** Text-to-speech output.
4. **Later:** Phone-call initiation/control flows.

---

## Phase 1 — STT (microphone) integration

### Product direction
Steve Chat should work as an offline-capable local web app after it has been
cached in the user's browser. Speech-to-text should therefore be a local model
workflow, not a long-lived dependency on browser `SpeechRecognition`.

When a user enables STT for the first time, settings should show a model picker
with practical Whisper-size choices and approximate download sizes:

- Whisper small.en (~465 MB)
- Whisper medium.en (~1.43 GB)
- Whisper large-v3 (~3.1 GB)

After the user selects a model, Steve Chat should open the verified model
download link and let the active Android/browser download flow save it to the
normal download location. Settings should expose **Browse** controls for the chat
model directory and STT model directory. In a native Android bridge, Browse should
return a real filesystem path/URI; in a normal browser, it may only return a
File System Access directory handle/name, so the UI must not pretend that a full
sidecar-readable path is available when the browser does not expose one.

Once configured, the normal user workflow is:

1. Tap record.
2. Show the live waveform meter immediately.
3. Allow pause/resume while keeping the captured audio session coherent.
4. On commit, stop capture, transcribe through the selected local STT model, and
   insert the transcript into the composer for review.
5. On cancel/exit, stop tracks, abort any pending STT request, reset UI state,
   and preserve any pre-recording composer text.

Persisting a copy of the audio waveform is deprecated for now. The waveform is a
live recording affordance only; do not add durable waveform storage until there
is a concrete review/debug feature that needs it.

### UX goals
- Tap mic → start listening indicator
- Partial transcript preview while speaking
- Final transcript inserted into composer
- Retry/cancel behavior that does not block chat input

### Tooling options
1. **Local Whisper pipeline (primary)**
   - Options: `faster-whisper` service, `whisper.cpp` server endpoint, or
     another local STT sidecar with explicit model install/config APIs.
   - Pros: offline after setup, private, predictable across browsers.
   - Cons: model download size, storage, CPU/GPU load, latency tuning.
2. **Android native SpeechRecognizer bridge (optional fallback)**
   - Pros: stable app-context UX where local model install is unavailable.
   - Cons: requires native app bridge plumbing and may not be fully offline.
3. **Web Speech API (legacy fallback only)**
   - Pros: zero install.
   - Cons: browser/device variability, cloud dependency on some engines,
     long-session failure modes.

### Recommended path
- Step A: make recorder + local STT endpoint the source of truth for completed
  transcriptions; stop treating Web Speech as the primary path.
- Step B: add Settings UI for STT model status, selected model, model directory,
  directory Browse, direct download, and local STT endpoint health.
- Step C: add a sidecar API for listing supported STT models with sizes,
  installing/downloading a selected model, and returning the configured model
  path.
- Step D: persist STT config in the same user-visible settings surface used for
  local runtime and embedding config.
- Step E: cover edge cases: pause then cancel, pause then commit, close settings
  while recording, navigate chat while recording, STT endpoint timeout, missing
  model path, and mic permission denial.

---

## Phase 2 — TTS integration

### UX goals
- Optional auto-read assistant replies
- Voice selector + rate/pitch controls
- Stop/cancel speech button

### Tooling options
1. **Web Speech Synthesis (quickest)**
2. **Piper TTS local server (offline-quality path)**
3. **Android native TTS bridge**

### Recommended path
- Keep Web Speech as default fallback
- Add local TTS endpoint option for higher control/consistency

---

## Phase 3 — Phone-call initiation (later)

### Potential approaches
1. Android native intent/TelecomManager integration via app bridge
2. SIP/VoIP provider integration (Twilio/Plivo/Signal-compatible workflows depending constraints)
3. Hybrid: local assistant controls + native dialer handoff

### Notes
- Requires explicit user safety controls, contact permissions, and confirmation flows.
- Should be isolated from normal chat actions (no accidental calls).

---

## Dependencies / risks
- Device/browser STT behavior differences in WebView
- Long-running audio pipelines on mobile thermals
- Permission model friction (mic/call/foreground)
- Latency tradeoffs for fully local audio models
