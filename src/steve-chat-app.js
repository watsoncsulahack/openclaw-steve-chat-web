import { getDomRefs } from "./dom.js";
import { IdenticonService } from "./services/identicon-service.js";
import { GestureService } from "./services/gesture-service.js";
import { RuntimeClient } from "./services/runtime-client.js";
import { StorageService } from "./services/storage-service.js";

const WIDE_QUERY = "(min-width: 700px)";
const ARCHIVE_ICON_SVG = '<svg class="archive-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16"/><rect x="5" y="6" width="14" height="13" rx="2"/><path d="M9 11h6"/><path d="M9 14h6"/></svg>';
const REGULAR_RUNTIME_TARGETS = {
  default: {
    label: "Regular llama.cpp",
    endpoint: "http://127.0.0.1:18080",
    accel: "gpu-capable",
  },
};

const QVAC_RUNTIME_TARGETS = {
  default: {
    label: "QVAC fabric llama.cpp",
    endpoint: "http://127.0.0.1:18084",
    accel: "gpu-capable",
  },
};

const MODEL_PROFILES = {
  e2b: {
    id: "gemma-3n-E2B-it-UD-Q4_K_XL.gguf",
    name: "Gemma 3n E2B",
    modelIndex: 1,
  },
  e4b: {
    id: "gemma-3n-E4B-it-UD-Q4_K_XL.gguf",
    name: "Gemma 3n E4B (4B profile)",
    modelIndex: 2,
  },
};

const CHAT_TEMPLATE_PRESETS = {
  none: "",
  assistant: "You are a helpful assistant. Be accurate, practical, and friendly.",
  concise: "You are concise and direct. Prefer short bullet points and clear next steps.",
  coder: "You are a coding copilot. Explain tradeoffs, include runnable examples, and call out risks.",
};

export class SteveChatApp {
  constructor() {
    this.els = getDomRefs();
    this.identicons = new IdenticonService();
    this.runtimeClient = new RuntimeClient();
    this.storage = new StorageService("steve.state.v2");
    this.persistTimer = null;
    this.recognition = null;
    this.drawerDrag = null;
    this.activeInferenceController = null;
    this.inferenceRunning = false;

    this.state = this.storage.load(this.createInitialState());
  }

  createInitialState() {
    const GPU_PROFILE_VERSION = "gpu-default-2026-03-22-v1";
    const savedProfileVersion = localStorage.getItem("steve.gpuProfileVersion");
    if (savedProfileVersion !== GPU_PROFILE_VERSION) {
      // One-time migration: default Steve Chat to a known GPU-backed runtime profile.
      localStorage.setItem("steve.backend", "qvac");
      localStorage.setItem("steve.baseUrl", QVAC_RUNTIME_TARGETS.default.endpoint);
      localStorage.setItem("steve.liveMode", "1");
      localStorage.setItem("steve.gpuProfileVersion", GPU_PROFILE_VERSION);
    }

    const backend = localStorage.getItem("steve.backend") || "qvac";
    const selectedRuntime = REGULAR_RUNTIME_TARGETS.default;
    const selectedQvacRuntime = QVAC_RUNTIME_TARGETS.default;
    const defaultBaseUrl = backend === "qvac"
      ? selectedQvacRuntime.endpoint
      : selectedRuntime.endpoint;
    const baseUrl = localStorage.getItem("steve.baseUrl") || defaultBaseUrl;

    const maxTokensRaw = Number(localStorage.getItem("steve.maxTokens") || 300);
    const temperatureRaw = Number(localStorage.getItem("steve.temperature") || 0.4);
    const topPRaw = Number(localStorage.getItem("steve.topP") || 0.95);
    const topKRaw = Number(localStorage.getItem("steve.topK") || 40);
    const minPRaw = Number(localStorage.getItem("steve.minP") || 0.05);
    const typicalPRaw = Number(localStorage.getItem("steve.typicalP") || 1);
    const repeatPenaltyRaw = Number(localStorage.getItem("steve.repeatPenalty") || 1);
    const customRuntimeJson = localStorage.getItem("steve.customRuntimeJson") || "";
    const chatTemplate = localStorage.getItem("steve.chatTemplate") || "none";
    const customTemplate = localStorage.getItem("steve.customTemplate") || "";

    const storedWideDrawerMode = localStorage.getItem("steve.wideDrawerMode") || "";
    const legacySidebarCollapsed = localStorage.getItem("steve.sidebarCollapsed") === "1";
    const wideDrawerMode = ["open", "preview", "closed"].includes(storedWideDrawerMode)
      ? storedWideDrawerMode
      : (legacySidebarCollapsed ? "preview" : "open");

    return {
      backend,
      runtimeTarget: "default",
      qvacRuntimeTarget: "default",
      baseUrl,
      liveMode: (localStorage.getItem("steve.liveMode") ?? "1") === "1",
      wideDrawerMode,
      theme: localStorage.getItem("steve.theme") || "dark",
      showArchived: false,
      replyTarget: null,
      mockMicOn: false,
      activeChatId: "steve",
      selectedModel: localStorage.getItem("steve.model") || MODEL_PROFILES.e4b.id,
      modelProfile: localStorage.getItem("steve.modelProfile") || "e4b",
      chatFilter: "",
      streamMode: localStorage.getItem("steve.streamMode") !== "0",
      ttsEnabled: localStorage.getItem("steve.ttsEnabled") === "1",
      settingsSection: "general",
      generation: {
        maxTokens: Number.isFinite(maxTokensRaw) ? Math.max(16, Math.min(4096, Math.round(maxTokensRaw))) : 300,
        temperature: Number.isFinite(temperatureRaw) ? Math.max(0, Math.min(2, temperatureRaw)) : 0.4,
        topP: Number.isFinite(topPRaw) ? Math.max(0, Math.min(1, topPRaw)) : 0.95,
        topK: Number.isFinite(topKRaw) ? Math.max(0, Math.min(200, Math.round(topKRaw))) : 40,
        minP: Number.isFinite(minPRaw) ? Math.max(0, Math.min(1, minPRaw)) : 0.05,
        typicalP: Number.isFinite(typicalPRaw) ? Math.max(0, Math.min(1, typicalPRaw)) : 1,
        repeatPenalty: Number.isFinite(repeatPenaltyRaw) ? Math.max(1, Math.min(2, repeatPenaltyRaw)) : 1,
        customRuntimeJson,
      },
      promptTemplate: {
        key: CHAT_TEMPLATE_PRESETS[chatTemplate] != null || chatTemplate === "custom" ? chatTemplate : "none",
        custom: customTemplate,
      },
      runtimeState: "idle",
      runtimeStatusText: "Runtime ready.",
      localLlamaConnected: false,
      power: {
        sessionEnergyMWh: 0,
        sessionMs: 0,
        samples: [],
      },
      tokens: {
        prompt: 0,
        completion: 0,
        total: 0,
      },
      models: [
        { id: MODEL_PROFILES.e4b.id, name: MODEL_PROFILES.e4b.name },
        { id: MODEL_PROFILES.e2b.id, name: MODEL_PROFILES.e2b.name },
      ],
      chats: [
        { id: "steve", title: "Steve", subtitle: "Main thread", archived: false },
        { id: "ops", title: "Ops Notes", subtitle: "Build + test", archived: false },
        { id: "ideas", title: "Feature Ideas", subtitle: "Voice + gestures", archived: false },
        { id: "bugs", title: "Bug Triage", subtitle: "Keyboard / viewport", archived: false },
        { id: "models", title: "Model Bench", subtitle: "E2B vs E4B", archived: false },
        { id: "ui", title: "UI Polish", subtitle: "Fold + portrait", archived: false },
        { id: "roadmap", title: "Roadmap", subtitle: "Phase checklist", archived: false },
      ],
      messages: {
        steve: [
          { role: "steve", text: "Hi user 👋 I'm Steve. Tap around and shape this UI." },
          { role: "user", text: "Nice. Let's make this cleaner than the old dashboard." },
        ],
        ops: [{ role: "steve", text: "Model endpoint and chat wiring placeholder." }],
      },
    };
  }

  init() {
    this.ensureStateDefaults();

    if (!["regular", "qvac"].includes(this.state.backend)) {
      this.state.backend = "regular";
    }

    this.state.runtimeTarget = "default";
    this.state.qvacRuntimeTarget = "default";

    this.els.baseUrlInput.value = this.state.baseUrl;
    this.els.streamModeToggle.checked = Boolean(this.state.streamMode);
    this.els.ttsToggle.checked = Boolean(this.state.ttsEnabled);
    if (this.els.chatTemplateSelect) this.els.chatTemplateSelect.value = this.state.promptTemplate.key;
    if (this.els.customTemplateInput) this.els.customTemplateInput.value = this.state.promptTemplate.custom;
    if (this.els.maxTokensInput) this.els.maxTokensInput.value = String(this.state.generation.maxTokens);
    if (this.els.backendSelect) this.els.backendSelect.value = this.state.backend;
    if (this.els.modelProfileSelect) this.els.modelProfileSelect.value = this.state.modelProfile || "e4b";
    if (this.els.temperatureInput) this.els.temperatureInput.value = String(this.state.generation.temperature);
    if (this.els.topPInput) this.els.topPInput.value = String(this.state.generation.topP);
    if (this.els.topKInput) this.els.topKInput.value = String(this.state.generation.topK);
    if (this.els.minPInput) this.els.minPInput.value = String(this.state.generation.minP);
    if (this.els.typicalPInput) this.els.typicalPInput.value = String(this.state.generation.typicalP);
    if (this.els.repeatPenaltyInput) this.els.repeatPenaltyInput.value = String(this.state.generation.repeatPenalty);
    if (this.els.customRuntimeJsonInput) this.els.customRuntimeJsonInput.value = String(this.state.generation.customRuntimeJson || "");
    this.applyTheme();
    this.bindEvents();
    this.bindViewportFixes();
    this.syncViewport();
    this.renderAll();
  }

  ensureStateDefaults() {
    if (!this.state.power || typeof this.state.power !== "object") {
      this.state.power = { sessionEnergyMWh: 0, sessionMs: 0, samples: [] };
    }
    if (!Number.isFinite(Number(this.state.power.sessionEnergyMWh))) this.state.power.sessionEnergyMWh = 0;
    if (!Number.isFinite(Number(this.state.power.sessionMs))) this.state.power.sessionMs = 0;
    if (!Array.isArray(this.state.power.samples)) this.state.power.samples = [];

    if (!this.state.tokens || typeof this.state.tokens !== "object") {
      this.state.tokens = { prompt: 0, completion: 0, total: 0 };
    }
    const tp = Number(this.state.tokens.prompt || 0);
    const tc = Number(this.state.tokens.completion || 0);
    const tt = Number(this.state.tokens.total || 0);
    this.state.tokens.prompt = Number.isFinite(tp) ? Math.max(0, Math.round(tp)) : 0;
    this.state.tokens.completion = Number.isFinite(tc) ? Math.max(0, Math.round(tc)) : 0;
    this.state.tokens.total = Number.isFinite(tt) ? Math.max(0, Math.round(tt)) : (this.state.tokens.prompt + this.state.tokens.completion);

    if (!this.state.generation || typeof this.state.generation !== "object") {
      this.state.generation = {
        maxTokens: 300,
        temperature: 0.4,
        topP: 0.95,
        topK: 40,
        minP: 0.05,
        typicalP: 1,
        repeatPenalty: 1,
        customRuntimeJson: "",
      };
    }
    const maxTokens = Number(this.state.generation.maxTokens || 300);
    const temperature = Number(this.state.generation.temperature || 0.4);
    const topP = Number(this.state.generation.topP || 0.95);
    const topK = Number(this.state.generation.topK || 40);
    const minP = Number(this.state.generation.minP || 0.05);
    const typicalP = Number(this.state.generation.typicalP || 1);
    const repeatPenalty = Number(this.state.generation.repeatPenalty || 1);
    this.state.generation.maxTokens = Number.isFinite(maxTokens) ? Math.max(16, Math.min(4096, Math.round(maxTokens))) : 300;
    this.state.generation.temperature = Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0.4;
    this.state.generation.topP = Number.isFinite(topP) ? Math.max(0, Math.min(1, topP)) : 0.95;
    this.state.generation.topK = Number.isFinite(topK) ? Math.max(0, Math.min(200, Math.round(topK))) : 40;
    this.state.generation.minP = Number.isFinite(minP) ? Math.max(0, Math.min(1, minP)) : 0.05;
    this.state.generation.typicalP = Number.isFinite(typicalP) ? Math.max(0, Math.min(1, typicalP)) : 1;
    this.state.generation.repeatPenalty = Number.isFinite(repeatPenalty) ? Math.max(1, Math.min(2, repeatPenalty)) : 1;
    this.state.generation.customRuntimeJson = String(this.state.generation.customRuntimeJson || "").trim();

    if (!this.state.promptTemplate || typeof this.state.promptTemplate !== "object") {
      this.state.promptTemplate = { key: "none", custom: "" };
    }

    if (!["open", "preview", "closed"].includes(String(this.state.wideDrawerMode || ""))) {
      this.state.wideDrawerMode = this.state.sidebarCollapsed ? "preview" : "open";
    }

    if (!Object.prototype.hasOwnProperty.call(MODEL_PROFILES, this.state.modelProfile || "")) {
      this.state.modelProfile = "e4b";
    }
    const prof = MODEL_PROFILES[this.state.modelProfile] || MODEL_PROFILES.e4b;
    if (!this.state.selectedModel) this.state.selectedModel = prof.id;
    if (!CHAT_TEMPLATE_PRESETS[this.state.promptTemplate.key] && this.state.promptTemplate.key !== "custom") {
      this.state.promptTemplate.key = "none";
    }
    this.state.promptTemplate.custom = String(this.state.promptTemplate.custom || "");

    this.ensureModelProfilesPresent();

    if (!["general", "connectivity", "chat"].includes(this.state.settingsSection)) {
      this.state.settingsSection = "general";
    }
  }

  ensureModelProfilesPresent(runtimeModels = []) {
    const runtime = Array.isArray(runtimeModels) ? runtimeModels : [];
    const profileModels = Object.values(MODEL_PROFILES).map((p) => ({ id: p.id, name: p.name }));
    const existing = Array.isArray(this.state.models) ? this.state.models : [];

    const merged = [...runtime, ...existing, ...profileModels];
    const seen = new Set();
    this.state.models = merged.filter((m) => {
      const id = String(m?.id || "").trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map((m) => ({ id: String(m.id), name: String(m.name || this.shortName(m.id)) }));

    if (!this.state.models.some((m) => m.id === this.state.selectedModel)) {
      this.state.selectedModel = profileModels[0].id;
      localStorage.setItem("steve.model", this.state.selectedModel);
    }
  }

  getRuntimeTarget() {
    return REGULAR_RUNTIME_TARGETS.default;
  }

  getQvacRuntimeTarget() {
    return QVAC_RUNTIME_TARGETS.default;
  }

  getBackendEndpoint() {
    if (this.state.backend === "qvac") return this.getQvacRuntimeTarget().endpoint;
    return this.getRuntimeTarget().endpoint;
  }

  getBackendLabel() {
    return this.state.backend === "qvac" ? this.getQvacRuntimeTarget().label : this.getRuntimeTarget().label;
  }

  parsePortFromBaseUrl() {
    try {
      const u = new URL(this.state.baseUrl);
      return Number(u.port || (u.protocol === "https:" ? 443 : 80));
    } catch {
      return null;
    }
  }

  async notifyGpuFallbackIfNeeded() {
    const target = this.state.backend === "qvac" ? this.getQvacRuntimeTarget() : this.getRuntimeTarget();
    if (target?.accel !== "gpu-capable") return;

    const port = this.parsePortFromBaseUrl();
    if (!port) return;

    const diag = await this.runtimeClient.fetchLlamaRuntimeStatus(port);
    if (!diag?.noGpuFound) return;

    this.setRuntimeState("idle", "No GPU was found for this runtime. Steve Chat automatically fell back to CPU mode.");
  }

  setBackend(backend) {
    if (!["regular", "qvac"].includes(backend)) return;
    this.state.backend = backend;
    localStorage.setItem("steve.backend", backend);

    this.state.baseUrl = this.getBackendEndpoint();
    this.els.baseUrlInput.value = this.state.baseUrl;
    localStorage.setItem("steve.baseUrl", this.state.baseUrl);

    this.state.localLlamaConnected = false;
    this.renderBackendUi();
    this.renderRuntimeTargetUi();
    this.renderLocalLlamaButton();

    const runtimeLabel = this.getBackendLabel();
    this.setRuntimeState("idle", `Selected runtime: ${runtimeLabel}. Endpoint set to ${this.state.baseUrl}`);
    this.notifyGpuFallbackIfNeeded();
    this.schedulePersist();
  }

  setRuntimeTarget() {
    this.state.runtimeTarget = "default";
    localStorage.setItem("steve.runtimeTarget", "default");

    if (this.state.backend === "regular") {
      this.state.baseUrl = this.getBackendEndpoint();
      this.els.baseUrlInput.value = this.state.baseUrl;
      localStorage.setItem("steve.baseUrl", this.state.baseUrl);
      this.state.localLlamaConnected = false;
      this.setRuntimeState("idle", `Selected runtime: ${this.getRuntimeTarget().label}. Endpoint set to ${this.state.baseUrl}`);
      this.notifyGpuFallbackIfNeeded();
    }

    this.renderRuntimeTargetUi();
    this.renderLocalLlamaButton();
    this.schedulePersist();
  }

  setQvacRuntimeTarget() {
    this.state.qvacRuntimeTarget = "default";
    localStorage.setItem("steve.qvacRuntimeTarget", "default");

    if (this.state.backend === "qvac") {
      this.state.baseUrl = this.getBackendEndpoint();
      this.els.baseUrlInput.value = this.state.baseUrl;
      localStorage.setItem("steve.baseUrl", this.state.baseUrl);
      this.state.localLlamaConnected = false;
      this.setRuntimeState("idle", `Selected runtime: ${this.getQvacRuntimeTarget().label}. Endpoint set to ${this.state.baseUrl}`);
      this.notifyGpuFallbackIfNeeded();
    }

    this.renderRuntimeTargetUi();
    this.renderLocalLlamaButton();
    this.schedulePersist();
  }

  schedulePersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.storage.save(this.state);
    }, 80);
  }

  setRuntimeState(kind, text) {
    this.state.runtimeState = kind;
    if (text) this.state.runtimeStatusText = text;
    this.renderModeUi();
  }

  renderSendButtonState() {
    if (!this.els.sendBtn) return;
    if (!this.inferenceRunning) {
      this.els.sendBtn.title = "Send message";
      this.els.sendBtn.setAttribute("aria-label", "Send message");
      this.els.sendBtn.classList.remove("stop-mode");
      this.els.sendBtn.innerHTML = `
        <svg class="send-glyph" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12h14" />
          <path d="M12 5l8 7-8 7" />
        </svg>
      `;
      return;
    }

    this.els.sendBtn.title = "Stop inference";
    this.els.sendBtn.setAttribute("aria-label", "Stop inference");
    this.els.sendBtn.classList.add("stop-mode");
    this.els.sendBtn.innerHTML = `<span class="stop-glyph" aria-hidden="true">■</span>`;
  }

  startInferenceController() {
    this.activeInferenceController?.abort?.();
    this.activeInferenceController = new AbortController();
    this.inferenceRunning = true;
    this.renderSendButtonState();
    return this.activeInferenceController;
  }

  finishInferenceController() {
    this.activeInferenceController = null;
    this.inferenceRunning = false;
    this.renderSendButtonState();
  }

  stopCurrentInference() {
    if (!this.inferenceRunning) return;
    this.setRuntimeState("idle", "Stopping inference...");
    this.activeInferenceController?.abort?.();
  }

  bindEvents() {
    this.els.menuBtn.addEventListener("click", () => {
      if (this.isWide()) {
        this.setWideDrawerMode(this.state.wideDrawerMode === "open" ? "closed" : "open");
        return;
      }
      this.toggleDrawer(true);
    });
    this.els.closeDrawerBtn.addEventListener("click", () => this.toggleDrawer(false));
    this.els.backdrop.addEventListener("click", () => {
      this.toggleDrawer(false);
      this.toggleModelSheet(false);
      this.toggleSettingsSheet(false);
    });

    this.els.modelPickerBtn.addEventListener("click", () => this.toggleModelSheet(true));
    this.els.closeModelSheetBtn.addEventListener("click", () => this.toggleModelSheet(false));
    this.els.settingsBtn.addEventListener("click", () => this.toggleSettingsSheet(true));
    this.els.closeSettingsBtn.addEventListener("click", () => this.toggleSettingsSheet(false));

    this.els.saveBaseUrlBtn.addEventListener("click", () => this.saveBaseUrl());
    this.els.detectModelsBtn.addEventListener("click", () => this.detectModels());
    this.els.connectLocalLlamaBtn.addEventListener("click", () => this.connectLocalLlama());

    this.els.chatSearchInput.addEventListener("input", (e) => {
      this.state.chatFilter = (e.target.value || "").toLowerCase().trim();
      this.renderChatSearchState();
      this.renderChats();
      this.schedulePersist();
    });

    this.els.clearChatSearchBtn.addEventListener("click", () => this.clearChatSearch());
    this.els.newChatBtn.addEventListener("click", () => this.createNewChat());
    this.els.archivesBtn.addEventListener("click", () => this.toggleArchivedView());
    this.els.drawerCompactBtn.addEventListener("click", () => this.toggleSidebarCollapsed());
    this.els.clearReplyBtn.addEventListener("click", () => this.clearReplyTarget());
    this.els.themeToggleBtn.addEventListener("click", () => this.toggleTheme());
    this.els.resetPowerStatsBtn?.addEventListener("click", () => this.resetPowerStats());

    this.els.backendSelect?.addEventListener("change", (e) => this.setBackend(String(e.target?.value || "qvac")));
    this.els.applyModelProfileBtn?.addEventListener("click", () => this.applyModelProfile());

    this.els.mockModeBtn.addEventListener("click", () => this.setMode(false));
    this.els.runtimeModeBtn.addEventListener("click", () => this.setMode(true));
    this.els.streamModeToggle.addEventListener("change", (e) => {
      this.state.streamMode = Boolean(e.target.checked);
      localStorage.setItem("steve.streamMode", this.state.streamMode ? "1" : "0");
      this.setRuntimeState("idle", this.state.streamMode ? "Streaming enabled." : "Streaming disabled.");
      this.schedulePersist();
    });
    this.els.ttsToggle.addEventListener("change", (e) => {
      this.state.ttsEnabled = Boolean(e.target.checked);
      localStorage.setItem("steve.ttsEnabled", this.state.ttsEnabled ? "1" : "0");
      this.setRuntimeState("idle", this.state.ttsEnabled ? "Text-to-speech enabled." : "Text-to-speech disabled.");
      this.schedulePersist();
    });
    this.els.settingsToggleThemeBtn?.addEventListener("click", () => this.toggleTheme());
    this.els.chatTemplateSelect?.addEventListener("change", () => this.renderChatDefaultsUi());
    this.els.saveChatDefaultsBtn?.addEventListener("click", () => this.saveChatDefaults());

    this.els.sendBtn.addEventListener("click", () => {
      if (this.inferenceRunning) {
        this.stopCurrentInference();
        return;
      }
      this.onSend();
    });
    this.els.messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.onSend();
    });

    this.els.plusBtn.addEventListener("click", () => {
      this.els.modeHint.textContent = "Attachment/actions menu hook (non-modal).";
    });

    this.els.micBtn.addEventListener("click", () => this.toggleSpeechInput());

    this.els.messageInput.addEventListener("focus", () => {
      window.setTimeout(() => this.ensureComposerVisible(), 120);
      window.setTimeout(() => this.ensureComposerVisible(), 300);
    });

    this.bindDrawerDragGesture();
  }

  bindDrawerDragGesture() {
    const host = this.els.appShell || this.els.phoneFrame || this.els.messages;
    if (!host) return;

    this.drawerDrag?.cleanup?.();

    let active = false;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let gesture = null; // "open" | "close"

    const edgeWidth = 36;
    const threshold = 56;

    const finish = () => {
      if (!active) return;
      const pid = pointerId;
      active = false;
      pointerId = null;
      gesture = null;
      if (pid != null && host.releasePointerCapture) {
        try { host.releasePointerCapture(pid); } catch { /* ignore */ }
      }
    };

    const onDown = (e) => {
      if (active) return;
      if (this.els.settingsSheet.classList.contains("show") || this.els.modelSheet.classList.contains("show")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const wide = this.isWide();
      const drawerRect = this.els.drawer.getBoundingClientRect();
      const drawerIsOpen = wide
        ? this.getWideDrawerMode() === "open"
        : this.els.drawer.classList.contains("open");

      const nearLeftEdge = e.clientX <= edgeWidth;
      const nearDrawerRightEdge = Math.abs(e.clientX - drawerRect.right) <= edgeWidth;
      const insideDrawer = e.clientX <= drawerRect.right;

      if (wide) {
        if (drawerIsOpen && nearDrawerRightEdge) {
          gesture = "close";
        } else if (!drawerIsOpen && nearLeftEdge) {
          gesture = "open";
        } else {
          return;
        }
      } else {
        if (drawerIsOpen && insideDrawer) {
          gesture = "close";
        } else if (!drawerIsOpen && nearLeftEdge) {
          gesture = "open";
        } else {
          return;
        }
      }

      active = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;

      if (host.setPointerCapture && pointerId != null) {
        try { host.setPointerCapture(pointerId); } catch { /* ignore */ }
      }
    };

    const onUp = (e) => {
      if (!active) return;
      if (pointerId != null && e.pointerId !== pointerId) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;

      if (horizontal && dx > threshold) {
        if (gesture === "open") this.toggleDrawer(true);
        if (gesture === "close") this.toggleDrawer(false);
      }

      finish();
    };

    const onCancel = () => finish();

    host.addEventListener("pointerdown", onDown, { passive: true });
    host.addEventListener("pointerup", onUp, { passive: true });
    host.addEventListener("pointercancel", onCancel, { passive: true });
    host.addEventListener("lostpointercapture", onCancel, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });
    window.addEventListener("blur", onCancel, { passive: true });
    document.addEventListener("visibilitychange", onCancel, { passive: true });

    this.drawerDrag = {
      cleanup: () => {
        host.removeEventListener("pointerdown", onDown);
        host.removeEventListener("pointerup", onUp);
        host.removeEventListener("pointercancel", onCancel);
        host.removeEventListener("lostpointercapture", onCancel);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("blur", onCancel);
        document.removeEventListener("visibilitychange", onCancel);
      },
    };
  }

  bindViewportFixes() {
    window.addEventListener("resize", () => this.syncViewport(), { passive: true });
    window.addEventListener("orientationchange", () => this.syncViewport(), { passive: true });

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => this.syncViewport(), { passive: true });
      window.visualViewport.addEventListener("scroll", () => this.syncViewport(), { passive: true });
    }
  }

  isWide() {
    return window.matchMedia(WIDE_QUERY).matches;
  }

  applyTheme() {
    document.body.classList.toggle("theme-light", this.state.theme === "light");
    this.els.themeToggleBtn.textContent = this.state.theme === "light" ? "🌙" : "☀";
    this.els.themeToggleBtn.title = this.state.theme === "light" ? "Switch to dark mode" : "Switch to light mode";
  }

  toggleTheme() {
    this.state.theme = this.state.theme === "light" ? "dark" : "light";
    localStorage.setItem("steve.theme", this.state.theme);
    this.applyTheme();
    this.schedulePersist();
  }

  getWideDrawerMode() {
    const mode = String(this.state.wideDrawerMode || "open");
    return ["open", "preview", "closed"].includes(mode) ? mode : "open";
  }

  setWideDrawerMode(mode, { persist = true } = {}) {
    const normalized = ["open", "preview", "closed"].includes(mode) ? mode : "open";
    this.state.wideDrawerMode = normalized;

    if (persist) {
      localStorage.setItem("steve.wideDrawerMode", normalized);
      // Backward compatibility for old key readers.
      localStorage.setItem("steve.sidebarCollapsed", normalized === "preview" ? "1" : "0");
    }

    this.applySidebarLayoutState();
    this.syncBackdrop();
    this.renderSidebarRail();
    this.schedulePersist();
  }

  applySidebarLayoutState() {
    const wide = this.isWide();
    const mode = wide ? this.getWideDrawerMode() : "closed";

    this.els.appShell.classList.toggle("wide-drawer-open", wide && mode === "open");
    this.els.appShell.classList.toggle("wide-drawer-preview", wide && mode === "preview");
    this.els.appShell.classList.toggle("wide-drawer-closed", wide && mode === "closed");

    // Keep legacy class for existing CSS blocks tied to preview mode.
    this.els.appShell.classList.toggle("sidebar-collapsed", wide && mode === "preview");

    if (wide) {
      this.els.drawer.classList.toggle("open", mode === "open");
      this.els.drawerCompactBtn.textContent = mode === "open" ? "◧" : (mode === "preview" ? "▤" : "☰");
      this.els.drawerCompactBtn.title = mode === "open"
        ? "Switch drawer to preview"
        : (mode === "preview" ? "Switch drawer to closed" : "Open full drawer");

      const showHeaderActions = mode === "open";
      this.els.settingsBtn.hidden = !showHeaderActions;
      this.els.archivesBtn.hidden = !showHeaderActions;
      return;
    }

    this.els.drawerCompactBtn.textContent = "◧";
    this.els.drawerCompactBtn.title = "Toggle compact sidebar";
    this.els.settingsBtn.hidden = false;
    this.els.archivesBtn.hidden = false;
  }

  toggleSidebarCollapsed() {
    if (!this.isWide()) return;
    const order = ["open", "preview", "closed"];
    const mode = this.getWideDrawerMode();
    const next = order[(order.indexOf(mode) + 1) % order.length];
    this.setWideDrawerMode(next);
  }

  syncViewport() {
    const vv = window.visualViewport;
    const height = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;

    document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
    document.documentElement.style.setProperty("--vv-top", `${Math.round(top)}px`);

    this.applySidebarLayoutState();
    this.syncBackdrop();

    if (document.activeElement === this.els.messageInput) {
      window.setTimeout(() => this.scrollMessagesToBottom(), 40);
      window.setTimeout(() => this.scrollMessagesToBottom(), 200);
    }
  }

  ensureComposerVisible() {
    this.els.composer?.scrollIntoView({ block: "end", behavior: "auto" });
    this.scrollMessagesToBottom();
  }

  scrollMessagesToBottom() {
    if (!this.els?.messages) return;
    this.els.messages.scrollTop = this.els.messages.scrollHeight;
  }

  toggleDrawer(open) {
    if (this.isWide()) {
      this.setWideDrawerMode(open ? "open" : "closed");
      return;
    }

    this.els.drawer.classList.toggle("open", open);
    this.syncBackdrop();
  }

  toggleModelSheet(open) {
    if (open) this.els.settingsSheet.classList.remove("show");
    this.els.modelSheet.classList.toggle("show", open);
    this.syncBackdrop();
  }

  toggleSettingsSheet(open) {
    if (open) this.els.modelSheet.classList.remove("show");
    this.els.settingsSheet.classList.toggle("show", open);
    if (open) this.renderSettingsSections();
    this.syncBackdrop();
  }

  toggleSettingsNavMenu() {
    if (!this.els.settingsNavMenu) return;
    const next = !this.els.settingsNavMenu.classList.contains("open");
    this.els.settingsNavMenu.classList.toggle("open", next);
    if (this.els.settingsNavBtn) {
      this.els.settingsNavBtn.setAttribute("aria-expanded", String(next));
    }
  }

  closeSettingsNavMenu() {
    this.els.settingsNavMenu?.classList.remove("open");
    if (this.els.settingsNavBtn) {
      this.els.settingsNavBtn.setAttribute("aria-expanded", "false");
    }
  }

  setSettingsSection(section) {
    if (!["general", "connectivity", "chat"].includes(section)) return;
    this.state.settingsSection = section;
    this.renderSettingsSections();
    this.closeSettingsNavMenu();
    this.schedulePersist();
  }

  renderSettingsSections() {
    this.els.settingsSectionGeneral?.classList.add("active");
    this.renderChatDefaultsUi();
  }

  renderChatDefaultsUi() {
    const key = this.els.chatTemplateSelect?.value || this.state.promptTemplate.key || "none";
    if (!this.els.customTemplateInput) return;
    const custom = key === "custom";
    this.els.customTemplateInput.disabled = !custom;
    this.els.customTemplateInput.placeholder = custom
      ? "Custom instruction prefix for live runtime prompts"
      : "Select 'Custom template' to edit this field.";

    const templateDescriptions = {
      none: "No template: sends your prompt unchanged.",
      assistant: "Helpful assistant: practical, friendly, and accurate responses.",
      concise: "Concise + direct: shorter replies with clear next steps.",
      coder: "Coding copilot: explains tradeoffs and includes runnable examples.",
      custom: "Custom template: your instruction text is prepended to each user prompt.",
    };
    if (this.els.templateDescription) {
      this.els.templateDescription.textContent = templateDescriptions[key] || templateDescriptions.none;
    }
  }

  syncBackdrop() {
    const settingsOpen = this.els.settingsSheet.classList.contains("show");
    const modelOpen = this.els.modelSheet.classList.contains("show");
    const wideDrawerOpen = this.isWide() && this.getWideDrawerMode() === "open";
    const mobileDrawerOpen = !this.isWide() && this.els.drawer.classList.contains("open");
    const show = settingsOpen || modelOpen || wideDrawerOpen || mobileDrawerOpen;

    this.els.backdrop.classList.toggle("show", show);
    this.els.backdrop.classList.toggle("settings-dim", settingsOpen);
  }

  renderAll() {
    this.applySidebarLayoutState();
    this.renderArchiveState();
    this.renderChatSearchState();
    this.renderChats();
    this.renderSidebarRail();
    this.renderMessages();
    this.renderReplyBanner();
    this.renderModels();
    this.syncModelLabel();
    this.renderBackendUi();
    this.renderRuntimeTargetUi();
    this.renderModeUi();
    this.renderSettingsSections();
    this.renderPowerUi();
    this.renderTokenUi();
    this.renderLocalLlamaButton();
    this.renderSendButtonState();
  }

  renderChatSearchState() {
    const hasText = (this.els.chatSearchInput.value || "").trim().length > 0;
    this.els.chatSearchWrap.classList.toggle("has-text", hasText);
  }

  renderArchiveState() {
    this.els.archivesBtn.classList.toggle("active", this.state.showArchived);
    this.els.archivesBtn.setAttribute("aria-pressed", String(this.state.showArchived));
    this.els.archivesBtn.title = this.state.showArchived ? "Showing archived chats (tap to return)" : "Show archived chats";
    this.els.chatListTitle.textContent = this.state.showArchived ? "Archived (tap archive icon to return)" : "All chats";
  }

  toggleArchivedView() {
    this.state.showArchived = !this.state.showArchived;

    if (this.state.showArchived) {
      const firstArchived = this.state.chats.find((c) => c.archived);
      if (firstArchived) this.state.activeChatId = firstArchived.id;
    } else {
      const firstMain = this.state.chats.find((c) => !c.archived);
      if (firstMain) this.state.activeChatId = firstMain.id;
    }

    this.ensureActiveChatVisible();
    this.renderArchiveState();
    this.renderChats();
    this.renderSidebarRail();
    this.renderMessages();
    this.renderReplyBanner();
    this.schedulePersist();
  }

  getVisibleChats() {
    const filtered = this.state.showArchived
      ? this.state.chats.filter((c) => c.archived)
      : this.state.chats.filter((c) => !c.archived);

    if (!this.state.chatFilter) return filtered;
    return filtered.filter((c) => `${c.title} ${c.subtitle}`.toLowerCase().includes(this.state.chatFilter));
  }

  clearChatSearch() {
    this.els.chatSearchInput.value = "";
    this.state.chatFilter = "";
    this.renderChatSearchState();
    this.renderChats();
    this.els.chatSearchInput.focus();
    this.schedulePersist();
  }

  createNewChat() {
    const id = `chat-${Date.now()}`;
    const title = `New chat ${this.state.chats.length - 1}`;
    this.state.chats.unshift({ id, title, subtitle: "Just now", archived: false });
    this.state.messages[id] = [{ role: "steve", text: "New thread ready." }];

    if (this.state.showArchived) {
      this.state.showArchived = false;
      this.renderArchiveState();
    }

    this.switchChat(id);
    this.state.chatFilter = "";
    this.els.chatSearchInput.value = "";
    this.renderChatSearchState();
    this.renderChats();
    this.renderSidebarRail();
    this.renderMessages();
    this.schedulePersist();
  }

  switchChat(chatId) {
    this.state.activeChatId = chatId;
    this.renderChats();
    this.renderSidebarRail();
    this.renderMessages();
    this.renderReplyBanner();
    if (!this.isWide()) this.toggleDrawer(false);
    this.schedulePersist();
  }

  ensureActiveChatVisible() {
    const visible = this.state.showArchived
      ? this.state.chats.filter((c) => c.archived)
      : this.state.chats.filter((c) => !c.archived);

    if (visible.find((c) => c.id === this.state.activeChatId)) return;

    if (this.state.showArchived) {
      if (visible[0]) this.state.activeChatId = visible[0].id;
      return;
    }

    const firstUnarchived = this.state.chats.find((c) => !c.archived);
    if (firstUnarchived) {
      this.state.activeChatId = firstUnarchived.id;
      return;
    }

    if (this.state.chats[0]) {
      this.state.activeChatId = this.state.chats[0].id;
    }
  }

  renderSidebarRail() {
    if (!this.els.sidebarRail) return;
    this.els.sidebarRail.innerHTML = "";

    const newBtn = document.createElement("button");
    newBtn.className = "rail-btn rail-action";
    newBtn.textContent = "+";
    newBtn.title = "New chat";
    newBtn.addEventListener("click", () => this.createNewChat());
    this.els.sidebarRail.appendChild(newBtn);

    const settingsRailBtn = document.createElement("button");
    settingsRailBtn.className = "rail-btn rail-action";
    settingsRailBtn.textContent = "⚙";
    settingsRailBtn.title = "Settings";
    settingsRailBtn.addEventListener("click", () => this.toggleSettingsSheet(true));
    this.els.sidebarRail.appendChild(settingsRailBtn);

    const archiveRailBtn = document.createElement("button");
    archiveRailBtn.className = `rail-btn rail-action ${this.state.showArchived ? "active" : ""}`;
    archiveRailBtn.innerHTML = ARCHIVE_ICON_SVG;
    archiveRailBtn.title = "Archives";
    archiveRailBtn.addEventListener("click", () => this.toggleArchivedView());
    this.els.sidebarRail.appendChild(archiveRailBtn);

    this.getVisibleChats().slice(0, 8).forEach((chat) => {
      const b = document.createElement("button");
      b.className = `rail-btn ${chat.id === this.state.activeChatId ? "active" : ""}`;
      b.title = chat.title;
      this.identicons.paint(b, chat.id, 48, 14);
      b.addEventListener("click", () => this.switchChat(chat.id));
      this.els.sidebarRail.appendChild(b);
    });
  }

  renderChats() {
    this.els.chatList.innerHTML = "";
    const items = this.getVisibleChats();

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "chat-item";
      empty.textContent = this.state.showArchived ? "No archived chats." : "No chats match your search.";
      this.els.chatList.appendChild(empty);
      return;
    }

    items.forEach((chat) => {
      const item = document.createElement("div");
      item.className = `chat-item ${chat.id === this.state.activeChatId ? "active" : ""}`;

      const icon = document.createElement("div");
      icon.className = "chat-identicon";
      this.identicons.paint(icon, chat.id, 30, 8);

      const text = document.createElement("div");
      text.innerHTML = `<strong>${chat.title}</strong><br /><small>${chat.subtitle}</small>`;

      const row = document.createElement("div");
      row.className = "chat-item-inner";
      row.appendChild(icon);
      row.appendChild(text);

      const cueRight = document.createElement("div");
      cueRight.className = "swipe-cue swipe-cue-right";
      cueRight.innerHTML = `${ARCHIVE_ICON_SVG}<span>Archive</span>`;

      const cueLeft = document.createElement("div");
      cueLeft.className = "swipe-cue swipe-cue-left";
      cueLeft.textContent = "Delete 🗑";

      item.appendChild(cueRight);
      item.appendChild(cueLeft);
      item.appendChild(row);

      GestureService.bindSwipeAction(item, {
        onLeft: () => this.deleteChat(chat.id),
        onRight: () => this.toggleArchiveChat(chat.id),
        onTap: () => this.switchChat(chat.id),
        previewClassRight: "swipe-preview-right",
        previewClassLeft: "swipe-preview-left",
        threshold: 92,
        transformEl: row,
        maxTranslate: 74,
      });

      item.addEventListener("contextmenu", (e) => e.preventDefault());

      this.els.chatList.appendChild(item);
    });
  }

  deleteChat(chatId) {
    this.state.chats = this.state.chats.filter((c) => c.id !== chatId);
    delete this.state.messages[chatId];

    if (this.state.replyTarget?.chatId === chatId) {
      this.clearReplyTarget();
    }

    this.ensureActiveChatVisible();
    this.renderChats();
    this.renderSidebarRail();
    this.renderMessages();
    this.schedulePersist();
  }

  toggleArchiveChat(chatId) {
    const chat = this.state.chats.find((c) => c.id === chatId);
    if (!chat) return;

    chat.archived = !chat.archived;
    if (chat.id === this.state.activeChatId && chat.archived && !this.state.showArchived) {
      this.ensureActiveChatVisible();
    }

    this.renderChats();
    this.renderSidebarRail();
    this.renderMessages();
    this.schedulePersist();
  }

  setReplyTarget(messageIndex, msg) {
    this.state.replyTarget = {
      chatId: this.state.activeChatId,
      index: messageIndex,
      text: msg.text,
      role: msg.role,
    };
    this.renderReplyBanner();
    this.schedulePersist();
  }

  clearReplyTarget() {
    this.state.replyTarget = null;
    this.renderReplyBanner();
    this.schedulePersist();
  }

  renderReplyBanner() {
    const t = this.state.replyTarget;
    if (!t || t.chatId !== this.state.activeChatId) {
      this.els.replyBanner.classList.add("hidden");
      this.els.replyBannerText.textContent = "";
      return;
    }

    this.els.replyBanner.classList.remove("hidden");
    const snippet = (t.text || "").replace(/\s+/g, " ").slice(0, 80);
    this.els.replyBannerText.textContent = `Replying to ${t.role}: ${snippet}`;
  }

  renderMessages() {
    const messages = this.state.messages[this.state.activeChatId] || [];
    this.els.messages.innerHTML = "";

    messages.forEach((msg) => {
      const row = document.createElement("article");
      row.className = `msg-row ${msg.role}`;

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.textContent = msg.role === "user" ? "🙂" : "🤖";

      const bubble = document.createElement("div");
      bubble.className = "bubble";
      if (msg.pending) bubble.classList.add("pending");
      if (msg.error) bubble.classList.add("error");

      if (msg.replyTo?.text) {
        const reply = document.createElement("div");
        reply.className = "bubble-reply";
        reply.textContent = `${msg.replyTo.role}: ${msg.replyTo.text}`;
        bubble.appendChild(reply);
      }

      if (msg.role === "steve" && msg.modelName) {
        const modelMeta = document.createElement("div");
        modelMeta.className = "msg-model";
        modelMeta.textContent = String(msg.modelName);
        bubble.appendChild(modelMeta);
      }

      const body = document.createElement("div");
      body.textContent = msg.text;
      bubble.appendChild(body);

      if (msg.role === "steve" && (msg.tps != null || msg.energyMw != null)) {
        const meta = document.createElement("div");
        meta.className = "msg-tps";

        const bits = [];
        if (msg.tps != null) {
          const n = Number(msg.tps);
          const fixed = Number.isFinite(n) ? (n >= 10 ? n.toFixed(0) : n.toFixed(1)) : "--";
          bits.push(`${fixed} tokens/s`);
        }
        if (msg.energyMw != null) {
          bits.push(this.formatPower(msg.energyMw));
        }
        if (msg.energyMWh != null) {
          bits.push(this.formatEnergyMWh(msg.energyMWh));
        }

        meta.textContent = bits.join(" • ");
        bubble.appendChild(meta);
      }

      row.appendChild(avatar);
      row.appendChild(bubble);
      this.els.messages.appendChild(row);
    });

    this.els.messages.scrollTop = this.els.messages.scrollHeight;
  }

  renderModels() {
    this.els.modelList.innerHTML = "";
    this.state.models.forEach((model) => {
      const btn = document.createElement("button");
      btn.className = `model-item ${model.id === this.state.selectedModel ? "active" : ""}`;
      btn.textContent = model.name;
      btn.addEventListener("click", async () => {
        this.state.selectedModel = model.id;
        localStorage.setItem("steve.model", model.id);
        this.syncModelLabel();
        this.renderModels();
        this.toggleModelSheet(false);

        const profileKey = this.profileKeyForModelId(model.id);
        if (profileKey) {
          await this.applyModelProfile(profileKey);
        }
      });
      this.els.modelList.appendChild(btn);
    });
  }

  syncModelLabel() {
    const model = this.state.models.find((m) => m.id === this.state.selectedModel);
    this.els.currentModelLabel.textContent = model?.name || this.state.selectedModel;
  }

  setMode(live) {
    this.state.liveMode = live;
    localStorage.setItem("steve.liveMode", this.state.liveMode ? "1" : "0");
    this.setRuntimeState("idle", this.state.liveMode ? "Live runtime ready." : "UI Demo mode active.");
    this.schedulePersist();
  }

  renderBackendUi() {
    if (this.els.backendSelect) this.els.backendSelect.value = this.state.backend;
  }

  renderRuntimeTargetUi() {
    if (this.els.backendSelect) this.els.backendSelect.value = this.state.backend;
    if (this.els.modelProfileSelect) this.els.modelProfileSelect.value = this.state.modelProfile || "e4b";
  }

  renderModeUi() {
    this.els.mockModeBtn.classList.toggle("active", !this.state.liveMode);
    this.els.runtimeModeBtn.classList.toggle("active", this.state.liveMode);
    this.els.streamModeToggle.checked = Boolean(this.state.streamMode);
    this.els.ttsToggle.checked = Boolean(this.state.ttsEnabled);

    const chatDefaults = `Temp ${this.state.generation.temperature} • top-k ${this.state.generation.topK} • top-p ${this.state.generation.topP} • min-p ${this.state.generation.minP} • max ${this.state.generation.maxTokens}`;
    this.els.modeHint.textContent = this.state.liveMode
      ? `Local Runtime mode (${this.getBackendLabel()}) sends prompts with chat history to /v1/chat/completions. ${chatDefaults}.`
      : `UI Demo mode uses mock Steve replies for flow testing. ${chatDefaults}.`;

    this.els.runtimeStatus.textContent = this.state.runtimeStatusText || "Runtime: idle.";

    if (this.els.statusDot) {
      if (!this.state.liveMode) {
        this.els.statusDot.style.background = "#6d7cb4";
      } else if (this.state.runtimeState === "working") {
        this.els.statusDot.style.background = "#f0b846";
      } else if (this.state.runtimeState === "error") {
        this.els.statusDot.style.background = "#e15f5f";
      } else {
        this.els.statusDot.style.background = "#3ad06b";
      }
    }

    this.renderBackendUi();
    this.renderRuntimeTargetUi();
    this.renderPowerUi();
    this.renderLocalLlamaButton();
  }

  renderLocalLlamaButton() {
    const connected = Boolean(this.state.localLlamaConnected);
    const label = this.getBackendLabel();
    this.els.connectLocalLlamaBtn.classList.toggle("active", connected);
    this.els.connectLocalLlamaBtn.textContent = connected ? `Connected ${label}` : `Connect ${label}`;
  }

  toggleSpeechInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      this.setRuntimeState("error", "Speech recognition is not available in this browser.");
      return;
    }

    if (this.recognition) {
      this.recognition.stop();
      return;
    }

    const recognizer = new Recognition();
    recognizer.lang = "en-US";
    recognizer.continuous = false;
    recognizer.interimResults = true;

    this.recognition = recognizer;
    this.state.mockMicOn = true;
    this.els.micBtn.classList.add("active");
    this.els.micBtn.setAttribute("aria-pressed", "true");
    this.setRuntimeState("working", "Listening… speak your prompt.");

    recognizer.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const seg = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalText += seg;
        else interim += seg;
      }
      const nextValue = (finalText || interim || "").trim();
      if (nextValue) this.els.messageInput.value = nextValue;
    };

    recognizer.onerror = (event) => {
      this.setRuntimeState("error", `Speech input error: ${event.error || "unknown"}`);
    };

    recognizer.onend = () => {
      this.recognition = null;
      this.state.mockMicOn = false;
      this.els.micBtn.classList.remove("active");
      this.els.micBtn.setAttribute("aria-pressed", "false");
      if (this.state.liveMode) {
        this.setRuntimeState("idle", "Live runtime ready.");
      } else {
        this.setRuntimeState("idle", "UI Demo mode active.");
      }
      this.els.messageInput.focus();
    };

    recognizer.start();
  }

  async connectLocalLlama() {
    this.els.baseUrlInput.value = this.getBackendEndpoint();
    this.saveBaseUrl();
    this.state.localLlamaConnected = false;
    this.renderLocalLlamaButton();
    this.setRuntimeState("working", `Connecting to ${this.getBackendLabel()} endpoint...`);
    await this.detectModels();
  }

  profileKeyForModelId(modelId) {
    const id = String(modelId || "");
    for (const [key, profile] of Object.entries(MODEL_PROFILES)) {
      if (profile.id === id) return key;
    }
    return null;
  }

  async applyModelProfile(profileKeyInput = null) {
    const profileKey = profileKeyInput || this.els.modelProfileSelect?.value || "e4b";
    const profile = MODEL_PROFILES[profileKey] || MODEL_PROFILES.e4b;
    this.state.modelProfile = profileKey;
    if (this.els.modelProfileSelect) this.els.modelProfileSelect.value = profileKey;
    localStorage.setItem("steve.modelProfile", profileKey);

    const target = this.state.backend === "qvac" ? "qvac-vulkan" : "reg-prebuilt";
    this.setRuntimeState("working", `Applying ${profile.name} on ${this.getBackendLabel()}...`);

    try {
      const switched = await this.runtimeClient.switchLocalRuntime({
        target,
        modelIndex: profile.modelIndex,
        siteId: "steve-chat",
      });

      const endpoint = switched?.endpoint || this.getBackendEndpoint();
      this.state.baseUrl = endpoint;
      this.els.baseUrlInput.value = endpoint;
      localStorage.setItem("steve.baseUrl", endpoint);

      this.state.selectedModel = profile.id;
      localStorage.setItem("steve.model", this.state.selectedModel);

      this.ensureModelProfilesPresent([{ id: profile.id, name: profile.name }]);
      this.syncModelLabel();
      this.renderModels();
      this.state.localLlamaConnected = true;
      this.renderLocalLlamaButton();

      await this.detectModels();
      this.setRuntimeState("ok", `Applied ${profile.name} on ${this.getBackendLabel()}.`);
      this.schedulePersist();
    } catch (err) {
      this.setRuntimeState("error", `Model switch failed: ${String(err?.message || err)}`);
    }
  }

  saveBaseUrl() {
    this.state.baseUrl = (this.els.baseUrlInput.value || "").trim().replace(/\/$/, "");
    localStorage.setItem("steve.baseUrl", this.state.baseUrl);

    const isSelectedBackendEndpoint = this.state.baseUrl === this.getBackendEndpoint();
    if (!isSelectedBackendEndpoint) this.state.localLlamaConnected = false;

    this.setRuntimeState("idle", `Endpoint saved: ${this.state.baseUrl}`);
    this.schedulePersist();
  }

  saveChatDefaults() {
    const templateKey = this.els.chatTemplateSelect?.value || "none";
    const customTemplate = String(this.els.customTemplateInput?.value || "").trim();
    const maxTokens = Number(this.els.maxTokensInput?.value || this.state.generation.maxTokens);
    const temperature = Number(this.els.temperatureInput?.value || this.state.generation.temperature);
    const topP = Number(this.els.topPInput?.value || this.state.generation.topP);
    const topK = Number(this.els.topKInput?.value || this.state.generation.topK);
    const minP = Number(this.els.minPInput?.value || this.state.generation.minP);
    const typicalP = Number(this.els.typicalPInput?.value || this.state.generation.typicalP);
    const repeatPenalty = Number(this.els.repeatPenaltyInput?.value || this.state.generation.repeatPenalty);
    const customRuntimeJson = String(this.els.customRuntimeJsonInput?.value || "").trim();

    if (customRuntimeJson) {
      try {
        const parsed = JSON.parse(customRuntimeJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          this.setRuntimeState("error", "Custom runtime JSON must be a JSON object.");
          return;
        }
      } catch {
        this.setRuntimeState("error", "Custom runtime JSON is invalid.");
        return;
      }
    }

    this.state.promptTemplate.key = (CHAT_TEMPLATE_PRESETS[templateKey] != null || templateKey === "custom") ? templateKey : "none";
    this.state.promptTemplate.custom = customTemplate;

    this.state.generation.maxTokens = Number.isFinite(maxTokens) ? Math.max(16, Math.min(4096, Math.round(maxTokens))) : 300;
    this.state.generation.temperature = Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0.4;
    this.state.generation.topP = Number.isFinite(topP) ? Math.max(0, Math.min(1, topP)) : 0.95;
    this.state.generation.topK = Number.isFinite(topK) ? Math.max(0, Math.min(200, Math.round(topK))) : 40;
    this.state.generation.minP = Number.isFinite(minP) ? Math.max(0, Math.min(1, minP)) : 0.05;
    this.state.generation.typicalP = Number.isFinite(typicalP) ? Math.max(0, Math.min(1, typicalP)) : 1;
    this.state.generation.repeatPenalty = Number.isFinite(repeatPenalty) ? Math.max(1, Math.min(2, repeatPenalty)) : 1;
    this.state.generation.customRuntimeJson = customRuntimeJson;

    if (this.els.maxTokensInput) this.els.maxTokensInput.value = String(this.state.generation.maxTokens);
    if (this.els.temperatureInput) this.els.temperatureInput.value = String(this.state.generation.temperature);
    if (this.els.topPInput) this.els.topPInput.value = String(this.state.generation.topP);
    if (this.els.topKInput) this.els.topKInput.value = String(this.state.generation.topK);
    if (this.els.minPInput) this.els.minPInput.value = String(this.state.generation.minP);
    if (this.els.typicalPInput) this.els.typicalPInput.value = String(this.state.generation.typicalP);
    if (this.els.repeatPenaltyInput) this.els.repeatPenaltyInput.value = String(this.state.generation.repeatPenalty);
    if (this.els.customRuntimeJsonInput) this.els.customRuntimeJsonInput.value = this.state.generation.customRuntimeJson;

    localStorage.setItem("steve.chatTemplate", this.state.promptTemplate.key);
    localStorage.setItem("steve.customTemplate", this.state.promptTemplate.custom);
    localStorage.setItem("steve.maxTokens", String(this.state.generation.maxTokens));
    localStorage.setItem("steve.temperature", String(this.state.generation.temperature));
    localStorage.setItem("steve.topP", String(this.state.generation.topP));
    localStorage.setItem("steve.topK", String(this.state.generation.topK));
    localStorage.setItem("steve.minP", String(this.state.generation.minP));
    localStorage.setItem("steve.typicalP", String(this.state.generation.typicalP));
    localStorage.setItem("steve.repeatPenalty", String(this.state.generation.repeatPenalty));
    localStorage.setItem("steve.customRuntimeJson", this.state.generation.customRuntimeJson);

    this.setRuntimeState("idle", "Chat defaults saved.");
    this.schedulePersist();
  }

  getActiveTemplateText() {
    if (this.state.promptTemplate.key === "custom") return String(this.state.promptTemplate.custom || "").trim();
    return String(CHAT_TEMPLATE_PRESETS[this.state.promptTemplate.key] || "").trim();
  }

  applyTemplateToMessages(messages) {
    const template = this.getActiveTemplateText();
    if (!template || !Array.isArray(messages) || !messages.length) return messages;

    const patched = messages.map((m) => ({ ...m }));
    for (let i = patched.length - 1; i >= 0; i -= 1) {
      if (patched[i].role === "user") {
        patched[i].content = `[Instruction]\n${template}\n\n[User]\n${patched[i].content}`;
        break;
      }
    }
    return patched;
  }

  async detectModels() {
    this.saveBaseUrl();
    this.setRuntimeState("working", `Detecting models on ${this.state.baseUrl} (waiting for runtime warmup if needed)...`);
    try {
      const listed = await this.runtimeClient.fetchModelsWithRetry(this.state.baseUrl, {
        timeoutMs: 45000,
        intervalMs: 900,
      });

      this.ensureModelProfilesPresent(listed);

      this.renderModels();
      this.syncModelLabel();

      const localHit = this.state.baseUrl === this.getBackendEndpoint();
      this.state.localLlamaConnected = localHit;
      this.setRuntimeState("ok", localHit ? `Connected ${this.getBackendLabel()}` : `Detected ${listed.length} model(s).`);
      await this.notifyGpuFallbackIfNeeded();
      this.schedulePersist();
    } catch (err) {
      this.state.localLlamaConnected = false;
      const msg = String(err?.message || "Unknown error");

      if (this.state.backend === "qvac" && /NetworkError|Failed to fetch|fetch/i.test(msg)) {
        this.setRuntimeState(
          "error",
          `Detect failed: ${this.getQvacRuntimeTarget().label} not reachable on ${this.getBackendEndpoint()}. Start qvac server first (set QVAC_LLAMA_BIN + QVAC_LLAMA_PORT, then scripts/llama_cpp_local.sh start --backend qvac --mode gpu --index 1 for Vulkan testing).`,
        );
      } else {
        this.setRuntimeState("error", `Detect failed: ${msg}`);
      }
    }
  }

  isTransientRuntimeError(message = "") {
    const msg = String(message || "");
    return /Runtime not ready|Failed to fetch|NetworkError|HTTP\s*503|Loading model|No models returned|Empty reply|ECONN|timeout|fetch/i.test(msg);
  }

  async withRuntimeRetry(taskFn, {
    signal = null,
    baseUrl = "",
    attempts = 2,
    warmupTimeoutMs = 16000,
    warmupIntervalMs = 700,
    phaseLabel = "Runtime call",
  } = {}) {
    let lastErr = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      try {
        return await taskFn();
      } catch (err) {
        const aborted = err?.name === "AbortError" || /aborted|abort/i.test(String(err?.message || ""));
        if (aborted) throw err;

        lastErr = err;
        const msg = String(err?.message || err || "");
        const transient = this.isTransientRuntimeError(msg);
        const canRetry = transient && attempt < attempts;
        if (!canRetry) throw err;

        this.setRuntimeState("working", `${phaseLabel} hit transient runtime issue (${msg}). Retrying...`);

        if (baseUrl) {
          try {
            await this.runtimeClient.fetchModelsWithRetry(baseUrl, {
              timeoutMs: warmupTimeoutMs,
              intervalMs: warmupIntervalMs,
              signal,
            });
          } catch {
            // ignore warmup failure; we'll still retry task once.
          }
        }

        await this.runtimeClient.sleep(220, signal);
      }
    }

    throw lastErr || new Error(`${phaseLabel} failed`);
  }

  shortName(full) {
    const cleaned = full.split("/").pop() || full;
    return cleaned.replace(/\.gguf$/i, "");
  }

  formatPower(milliwatts) {
    const n = Number(milliwatts);
    if (!Number.isFinite(n)) return "--";
    const watts = Math.max(0, n / 1000);
    return `${watts >= 10 ? watts.toFixed(1) : watts.toFixed(2)} W`;
  }

  formatEnergyMWh(mWh) {
    const n = Number(mWh);
    if (!Number.isFinite(n)) return "--";
    if (n >= 1000) return `${(n / 1000).toFixed(2)} Wh`;
    return `${n >= 10 ? n.toFixed(1) : n.toFixed(2)} mWh`;
  }

  resetPowerStats() {
    this.state.power = { sessionEnergyMWh: 0, sessionMs: 0, samples: [] };
    this.renderPowerUi();
    this.schedulePersist();
    this.setRuntimeState("idle", "Power telemetry reset.");
  }

  getAveragePowerMw() {
    const totalMs = Number(this.state.power?.sessionMs || 0);
    const totalMWh = Number(this.state.power?.sessionEnergyMWh || 0);
    if (totalMs <= 0 || totalMWh <= 0) return null;
    return (totalMWh * 3600000) / totalMs;
  }

  recordPowerSample(mw) {
    if (!this.state.power?.samples) this.ensureStateDefaults();
    const n = Number(mw);
    if (!Number.isFinite(n) || n < 0) return;
    this.state.power.samples.push({ t: Date.now(), mw: n });
    if (this.state.power.samples.length > 120) {
      this.state.power.samples = this.state.power.samples.slice(-120);
    }
  }

  addEnergyUsage(mw, elapsedMs) {
    const p = Number(mw);
    const dt = Number(elapsedMs);
    if (!Number.isFinite(p) || !Number.isFinite(dt) || dt <= 0) return 0;

    const energyMWh = (Math.max(0, p) * dt) / 3600000;
    this.state.power.sessionEnergyMWh = Number(this.state.power.sessionEnergyMWh || 0) + energyMWh;
    this.state.power.sessionMs = Number(this.state.power.sessionMs || 0) + dt;
    this.recordPowerSample(p);
    return energyMWh;
  }

  renderPowerUi() {
    if (!this.els.powerTotalValue || !this.els.powerAvgValue || !this.els.powerTrendSvg) return;

    const totalMWh = Number(this.state.power?.sessionEnergyMWh || 0);
    this.els.powerTotalValue.textContent = this.formatEnergyMWh(totalMWh);

    const avgMw = this.getAveragePowerMw();
    this.els.powerAvgValue.textContent = avgMw == null ? "--" : this.formatPower(avgMw);

    const poly = this.els.powerTrendSvg.querySelector("polyline");
    const samples = (this.state.power?.samples || []).slice(-40);

    if (!poly || samples.length < 2) {
      if (poly) poly.setAttribute("points", "");
      return;
    }

    const min = Math.min(...samples.map((s) => s.mw));
    const max = Math.max(...samples.map((s) => s.mw));
    const span = Math.max(1, max - min);
    const points = samples.map((s, i) => {
      const x = (i / (samples.length - 1)) * 100;
      const y = 24 - (((s.mw - min) / span) * 22);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");

    poly.setAttribute("points", points);
  }

  estimateTokenCount(text) {
    const clean = String(text || "").trim();
    if (!clean) return 0;
    const words = clean.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words * 1.35));
  }

  addTokenUsage({ promptTokens = 0, completionTokens = 0, totalTokens = null }) {
    const p = Math.max(0, Math.round(Number(promptTokens) || 0));
    const c = Math.max(0, Math.round(Number(completionTokens) || 0));
    const t = totalTokens == null ? p + c : Math.max(0, Math.round(Number(totalTokens) || 0));

    this.state.tokens.prompt += p;
    this.state.tokens.completion += c;
    this.state.tokens.total += t;
  }

  renderTokenUi(preview = null) {
    if (!this.els.sessionTokenTotal || !this.els.sessionPromptTokens || !this.els.sessionCompletionTokens) return;

    let prompt = Number(this.state.tokens.prompt || 0);
    let completion = Number(this.state.tokens.completion || 0);
    let total = Number(this.state.tokens.total || 0);

    if (preview && typeof preview === "object") {
      prompt += Math.max(0, Math.round(Number(preview.prompt || 0)));
      completion += Math.max(0, Math.round(Number(preview.completion || 0)));
      total += Math.max(0, Math.round(Number(preview.total || 0)));
    }

    this.els.sessionTokenTotal.textContent = String(total);
    this.els.sessionPromptTokens.textContent = String(prompt);
    this.els.sessionCompletionTokens.textContent = String(completion);
  }

  estimateAutoPowerMw({ text = "", tps = null, live = false }) {
    const parsedTps = Number(tps);
    const safeTps = Number.isFinite(parsedTps) ? Math.max(0, parsedTps) : 0;

    const backendBase = this.state.backend === "qvac" ? 1850 : 2250;
    const liveOverhead = live ? 180 : 0;
    const promptCost = Math.min(240, text.length * 0.7);
    const throughputCost = safeTps * (this.state.backend === "qvac" ? 42 : 55);

    return backendBase + liveOverhead + promptCost + throughputCost;
  }

  appendMessage(role, text, options = {}, chatId = this.state.activeChatId) {
    if (!this.state.messages[chatId]) {
      this.state.messages[chatId] = [];
    }
    const entry = { role, text, ...options };
    this.state.messages[chatId].push(entry);
    const index = this.state.messages[chatId].length - 1;

    if (chatId === this.state.activeChatId) this.renderMessages();
    this.schedulePersist();
    return index;
  }

  patchMessage(chatId, index, patch) {
    const list = this.state.messages[chatId] || [];
    if (!list[index]) return;

    if (typeof patch === "function") {
      patch(list[index]);
    } else {
      Object.assign(list[index], patch);
    }

    if (chatId === this.state.activeChatId) this.renderMessages();
    this.schedulePersist();
  }

  buildRuntimeMessages(chatId = this.state.activeChatId) {
    const raw = this.state.messages[chatId] || [];
    const mapped = raw
      .filter((m) => m.role === "user" || m.role === "steve")
      .map((m) => ({
        role: m.role === "steve" ? "assistant" : "user",
        content: (m.text || "").trim(),
      }))
      .filter((m) => m.content.length > 0);

    const normalized = [];
    for (const msg of mapped) {
      if (normalized.length === 0) {
        if (msg.role !== "user") continue; // llama.cpp gemma template expects user first (unless system message)
        normalized.push(msg);
        continue;
      }

      const prev = normalized[normalized.length - 1];
      if (prev.role === msg.role) {
        normalized[normalized.length - 1] = msg; // coalesce duplicates to preserve alternation
      } else {
        normalized.push(msg);
      }
    }

    // Keep only a recent window, then re-normalize again so truncation never breaks
    // user/assistant alternation (Gemma chat template is strict and returns HTTP 500).
    const windowed = normalized.slice(-16);
    const safe = [];
    for (const msg of windowed) {
      if (safe.length === 0) {
        if (msg.role !== "user") continue;
        safe.push(msg);
        continue;
      }

      const prev = safe[safe.length - 1];
      if (prev.role === msg.role) {
        safe[safe.length - 1] = msg;
      } else {
        safe.push(msg);
      }
    }

    // Additional latency guard: cap prompt history by estimated token budget so
    // first-token latency doesn't explode on long mobile chat threads.
    const tokenBudget = 420;
    const compact = [];
    let estimated = 0;

    for (let i = safe.length - 1; i >= 0; i -= 1) {
      const msg = safe[i];
      const cost = this.estimateTokenCount(msg.content) + 4;
      if (compact.length >= 2 && (estimated + cost) > tokenBudget) break;
      compact.unshift(msg);
      estimated += cost;
    }

    while (compact.length && compact[0].role !== "user") compact.shift();

    return compact.length ? compact : safe.slice(-2);
  }

  speakText(text) {
    if (!this.state.ttsEnabled) return;
    if (!("speechSynthesis" in window)) {
      this.setRuntimeState("error", "Speech synthesis is unavailable in this browser.");
      return;
    }

    try {
      const clean = (text || "").trim();
      if (!clean) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(clean);
      utter.rate = 1;
      utter.pitch = 1;
      window.speechSynthesis.speak(utter);
    } catch {
      this.setRuntimeState("error", "Unable to play speech output.");
    }
  }

  mockReplyForChat(chatId, userText) {
    const bank = {
      steve: [
        `Copy that. You said: “${userText}”. Want me to branch this into a task?`,
        "Nice. I can simulate a longer robot answer if you want stress testing.",
        "I’m Steve 🤖 and this is a dummy conversation pass with fake timing.",
      ],
      ops: [
        "[OPS] Health check simulated: all services green.",
        "[OPS] Build queue empty. No alerts.",
        "[OPS] Dummy telemetry: memory stable, no throttling.",
      ],
      ideas: [
        "Feature sketch noted: voice shortcut + one-tap transcript.",
        "Possible UX: swipe right from composer for quick actions.",
        "This is simulated ideation output with placeholder confidence.",
      ],
    };

    const list = bank[chatId] || [
      `Simulated robot response for ${chatId}.`,
      `I heard: ${userText}`,
    ];

    const idx = Math.floor(Math.random() * list.length);
    return list[idx];
  }

  async onSend() {
    if (this.inferenceRunning) {
      this.stopCurrentInference();
      return;
    }

    const text = (this.els.messageInput.value || "").trim();
    if (!text) return;

    this.els.messageInput.value = "";

    const chatId = this.state.activeChatId;
    const replyTo = this.state.replyTarget?.chatId === chatId
      ? { role: this.state.replyTarget.role, text: this.state.replyTarget.text }
      : null;

    this.appendMessage("user", text, replyTo ? { replyTo } : {}, chatId);
    this.clearReplyTarget();

    if (this.state.liveMode) {
      await this.sendLive(text, chatId);
      return;
    }

    const delayMs = 220 + Math.floor(Math.random() * 700);
    const simTps = 9 + Math.random() * 22;

    window.setTimeout(() => {
      const replyText = this.mockReplyForChat(chatId, text);
      const powerMw = this.estimateAutoPowerMw({ text, tps: simTps, live: false });
      const energyMWh = this.addEnergyUsage(powerMw, delayMs);

      const promptTokens = this.estimateTokenCount(text);
      const completionTokens = this.estimateTokenCount(replyText);
      this.addTokenUsage({ promptTokens, completionTokens });

      this.appendMessage("steve", replyText, {
        tps: simTps,
        energyMw: powerMw,
        energyMWh,
      }, chatId);

      this.renderPowerUi();
      this.renderTokenUi();
      this.setRuntimeState("idle", "UI Demo response generated.");
    }, delayMs);
  }

  async sendLive(text, chatId = this.state.activeChatId) {
    this.setRuntimeState("working", this.state.streamMode ? "Streaming response…" : "Waiting for live response…");

    const initialModelName = this.shortName(this.state.selectedModel || "model");
    const assistantIndex = this.appendMessage("steve", "", { pending: true, modelName: initialModelName }, chatId);
    const messages = this.applyTemplateToMessages(this.buildRuntimeMessages(chatId));
    const controller = this.startInferenceController();
    const signal = controller.signal;
    let streamedText = "";

    try {
      let readyModels = [];
      try {
        readyModels = await this.runtimeClient.fetchModelsWithRetry(this.state.baseUrl, {
          timeoutMs: 8000,
          intervalMs: 700,
          signal,
        });
      } catch (preflightErr) {
        const preflightMsg = String(preflightErr?.message || preflightErr || "");
        if (!this.isTransientRuntimeError(preflightMsg)) {
          throw preflightErr;
        }
        readyModels = Array.isArray(this.state.models) ? this.state.models : [];
        this.setRuntimeState("working", `Runtime preflight unstable (${preflightMsg}). Using cached model selection...`);
      }

      this.ensureModelProfilesPresent(readyModels);
      if (readyModels.length > 0 && !readyModels.some((m) => m.id === this.state.selectedModel)) {
        const preferred = this.state.modelProfile && MODEL_PROFILES[this.state.modelProfile]
          ? MODEL_PROFILES[this.state.modelProfile].id
          : null;
        this.state.selectedModel = preferred && this.state.models.some((m) => m.id === preferred)
          ? preferred
          : (readyModels[0]?.id || this.state.selectedModel);
        localStorage.setItem("steve.model", this.state.selectedModel);
      }
      this.renderModels();
      this.syncModelLabel();

      const activeModelName = this.shortName(this.state.selectedModel || "model");
      this.patchMessage(chatId, assistantIndex, { modelName: activeModelName });

      if (this.state.streamMode) {
        let chunkCount = 0;
        let liveTps = null;
        let livePowerMw = null;
        const promptPreviewTokens = this.estimateTokenCount(text);
        let completionPreviewTokens = 0;
        const startedAt = performance.now();

        this.renderTokenUi({
          prompt: promptPreviewTokens,
          completion: 0,
          total: promptPreviewTokens,
        });

        let result = await this.withRuntimeRetry(() => this.runtimeClient.streamChat({
          baseUrl: this.state.baseUrl,
          model: this.state.selectedModel,
          messages,
          maxTokens: this.state.generation.maxTokens,
          temperature: this.state.generation.temperature,
          topP: this.state.generation.topP,
          topK: this.state.generation.topK,
          minP: this.state.generation.minP,
          typicalP: this.state.generation.typicalP,
          repeatPenalty: this.state.generation.repeatPenalty,
          customJson: this.state.generation.customRuntimeJson,
          signal,
          onToken: (token) => {
            streamedText += token;
            chunkCount += 1;
            completionPreviewTokens = Math.max(1, this.estimateTokenCount(streamedText));
            const elapsedSec = Math.max(0.2, (performance.now() - startedAt) / 1000);
            liveTps = completionPreviewTokens / elapsedSec;
            livePowerMw = this.estimateAutoPowerMw({ text, tps: liveTps, live: true });
            this.recordPowerSample(livePowerMw);

            this.patchMessage(chatId, assistantIndex, {
              text: streamedText,
              pending: true,
              error: false,
              tps: liveTps,
              energyMw: livePowerMw,
            });

            this.renderTokenUi({
              prompt: promptPreviewTokens,
              completion: completionPreviewTokens,
              total: promptPreviewTokens + completionPreviewTokens,
            });

            if (chunkCount % 4 === 0) this.renderPowerUi();
          },
        }), {
          signal,
          baseUrl: this.state.baseUrl,
          attempts: 2,
          phaseLabel: "Stream call",
        });

        if (!streamedText.trim()) {
          this.setRuntimeState("working", "Empty stream reply, retrying once...");
          const retry = await this.withRuntimeRetry(() => this.runtimeClient.completeOnce({
            baseUrl: this.state.baseUrl,
            model: this.state.selectedModel,
            messages,
            maxTokens: Math.max(32, this.state.generation.maxTokens),
            temperature: this.state.generation.temperature,
            topP: this.state.generation.topP,
            topK: this.state.generation.topK,
            minP: this.state.generation.minP,
            typicalP: this.state.generation.typicalP,
            repeatPenalty: this.state.generation.repeatPenalty,
            customJson: this.state.generation.customRuntimeJson,
            signal,
          }), {
            signal,
            baseUrl: this.state.baseUrl,
            attempts: 2,
            phaseLabel: "Fallback completion",
          });

          streamedText = String(retry?.reply || "").trim();
          if (!streamedText || streamedText === "(empty reply)") {
            streamedText = "(empty reply)";
          }

          if (retry) {
            result = {
              tps: retry.tps,
              promptTokens: retry.promptTokens,
              completionTokens: retry.completionTokens,
              totalTokens: retry.totalTokens,
            };
          }
        }

        const elapsedMs = Math.max(1, performance.now() - startedAt);
        const promptTokens = result?.promptTokens ?? this.estimateTokenCount(text);
        const completionTokens = result?.completionTokens ?? Math.max(1, this.estimateTokenCount(streamedText));
        const totalTokens = result?.totalTokens ?? (promptTokens + completionTokens);
        const finalTps = completionTokens / Math.max(0.2, elapsedMs / 1000);
        const finalPowerMw = this.estimateAutoPowerMw({ text, tps: finalTps, live: true });
        const energyMWh = this.addEnergyUsage(finalPowerMw, elapsedMs);
        this.addTokenUsage({ promptTokens, completionTokens, totalTokens });

        this.patchMessage(chatId, assistantIndex, {
          text: streamedText,
          pending: false,
          error: false,
          tps: finalTps ?? null,
          energyMw: finalPowerMw,
          energyMWh,
        });

        this.renderPowerUi();
        this.renderTokenUi();
        this.speakText(streamedText);
        this.setRuntimeState("ok", `Live stream complete. Session energy ${this.formatEnergyMWh(this.state.power.sessionEnergyMWh)}.`);
        return;
      }

      const startedAt = performance.now();
      const oneShot = await this.withRuntimeRetry(() => this.runtimeClient.completeOnce({
        baseUrl: this.state.baseUrl,
        model: this.state.selectedModel,
        messages,
        maxTokens: this.state.generation.maxTokens,
        temperature: this.state.generation.temperature,
        topP: this.state.generation.topP,
        topK: this.state.generation.topK,
        minP: this.state.generation.minP,
        typicalP: this.state.generation.typicalP,
        repeatPenalty: this.state.generation.repeatPenalty,
        customJson: this.state.generation.customRuntimeJson,
        signal,
      }), {
        signal,
        baseUrl: this.state.baseUrl,
        attempts: 2,
        phaseLabel: "Completion call",
      });

      const elapsedMs = Math.max(1, performance.now() - startedAt);

      const promptTokens = oneShot.promptTokens ?? this.estimateTokenCount(text);
      const completionTokens = oneShot.completionTokens ?? this.estimateTokenCount(oneShot.reply);
      const totalTokens = oneShot.totalTokens ?? (promptTokens + completionTokens);
      const effectiveTps = completionTokens / Math.max(0.2, elapsedMs / 1000);
      const powerMw = this.estimateAutoPowerMw({ text, tps: effectiveTps, live: true });
      const energyMWh = this.addEnergyUsage(powerMw, elapsedMs);

      this.addTokenUsage({ promptTokens, completionTokens, totalTokens });

      this.patchMessage(chatId, assistantIndex, {
        text: oneShot.reply,
        pending: false,
        error: false,
        tps: effectiveTps,
        energyMw: powerMw,
        energyMWh,
      });
      this.renderPowerUi();
      this.renderTokenUi();
      this.speakText(oneShot.reply);
      this.setRuntimeState("ok", `Live response complete. Session energy ${this.formatEnergyMWh(this.state.power.sessionEnergyMWh)}.`);
    } catch (err) {
      const aborted = err?.name === "AbortError" || /aborted|abort/i.test(String(err?.message || ""));
      if (aborted) {
        const stoppedText = streamedText.trim() || "(generation stopped)";
        this.patchMessage(chatId, assistantIndex, {
          text: stoppedText,
          pending: false,
          error: false,
        });
        this.renderTokenUi();
        this.setRuntimeState("idle", "Inference stopped.");
        return;
      }

      this.patchMessage(chatId, assistantIndex, {
        text: `Live call failed: ${err.message}`,
        pending: false,
        error: true,
      });
      this.renderTokenUi();
      this.setRuntimeState("error", `Live call failed: ${err.message}`);
    } finally {
      this.finishInferenceController();
    }
  }
}
