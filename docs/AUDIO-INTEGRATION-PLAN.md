# Steve Chat Audio Integration Plan (STT/TTS/Calls)

Last updated (UTC): 2026-03-24

## Scope order (as requested)
1. **Now:** Enable/validate reasoning output path in local runtimes.
2. **Next:** Speech-to-text integration for microphone workflow.
3. **Then:** Text-to-speech output.
4. **Later:** Phone-call initiation/control flows.

---

## Phase 1 — STT (microphone) integration

### UX goals
- Tap mic → start listening indicator
- Partial transcript preview while speaking
- Final transcript inserted into composer
- Retry/cancel behavior that does not block chat input

### Tooling options
1. **Web Speech API (baseline, already partially wired)**
   - Pros: zero install, fastest to ship
   - Cons: browser/device variability, cloud dependency on some engines
2. **On-device Whisper pipeline (local-first)**
   - Options: `faster-whisper` service, `whisper.cpp` server endpoint
   - Pros: privacy/local control
   - Cons: CPU/GPU load, model size and latency tuning
3. **Android native SpeechRecognizer bridge (WebView app-level)**
   - Pros: stable on-device UX in app context
   - Cons: requires native app bridge plumbing

### Recommended path
- Step A: harden current Web Speech path for UX fallback
- Step B: add optional local STT endpoint setting (`/v1/audio/transcriptions`-style or custom `/stt`)
- Step C: add auto-fallback chain (native/web/local endpoint priority)

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
