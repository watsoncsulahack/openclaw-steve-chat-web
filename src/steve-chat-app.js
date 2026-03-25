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
  bitnet1: {
    id: "1bitLLM-bitnet_b1_58-xl-tq1_0.gguf",
    name: "BitNet B1.58 XL (1-bit tq1)",
    modelIndex: 1,
  },
  bitnet2: {
    id: "1bitLLM-bitnet_b1_58-xl-tq2_0.gguf",
    name: "BitNet B1.58 XL (2-bit tq2)",
    modelIndex: 2,
  },
  e2b: {
    id: "gemma-3n-E2B-it-UD-Q4_K_XL.gguf",
    name: "Gemma 3n E2B",
    modelIndex: 3,
  },
  e4b: {
    id: "gemma-3n-E4B-it-UD-Q4_K_XL.gguf",
    name: "Gemma 3n E4B (4B profile)",
    modelIndex: 4,
  },
};

const CHAT_TEMPLATE_PRESETS = {
  none: "",
  assistant: "You are a helpful assistant. Be accurate, practical, and friendly.",
  concise: "You are concise and direct. Prefer short bullet points and clear next steps.",
  coder: "You are a coding copilot. Explain tradeoffs, include runnable examples, and call out risks.",
};

const RUNTIME_STABILITY_PROFILE = {
  maxHistoryMessages: 10,
  historyTokenBudget: 260,
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
    this.reasoningProbeController = null;
    this.reasoningProbeTimer = null;
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
    let reasoningCapabilityByModel = {};
    try {
      const rawCaps = localStorage.getItem("steve.reasoningCapabilityByModel") || "{}";
      const parsedCaps = JSON.parse(rawCaps);
      if (parsedCaps && typeof parsedCaps === "object" && !Array.isArray(parsedCaps)) {
        reasoningCapabilityByModel = parsedCaps;
      }
    } catch {
      reasoningCapabilityByModel = {};
    }

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
      reasoningEnabled: localStorage.getItem("steve.reasoningEnabled") !== "0",
      reasoningCapabilityByModel,
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
      runtimeErrorText: "",
      runtimeGpuWarning: "",
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
    this.state.liveMode = true;
    localStorage.setItem("steve.liveMode", "1");

    this.els.baseUrlInput.value = this.state.baseUrl;
    this.els.streamModeToggle.checked = Boolean(this.state.streamMode);
    this.els.ttsToggle.checked = Boolean(this.state.ttsEnabled);
    if (this.els.reasoningToggle) this.els.reasoningToggle.checked = Boolean(this.state.reasoningEnabled);
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
    this.autoSizeComposerInput();
    this.queueReasoningCapabilityProbe();
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

    this.state.reasoningEnabled = this.state.reasoningEnabled !== false;
    if (!this.state.reasoningCapabilityByModel || typeof this.state.reasoningCapabilityByModel !== "object" || Array.isArray(this.state.reasoningCapabilityByModel)) {
      this.state.reasoningCapabilityByModel = {};
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

    this.state.runtimeStatusText = String(this.state.runtimeStatusText || "Runtime ready.");
    this.state.runtimeErrorText = String(this.state.runtimeErrorText || "");
    this.state.runtimeGpuWarning = String(this.state.runtimeGpuWarning || "");

    this.ensureModelProfilesPresent();

    if (!["general", "connectivity", "chat"].includes(this.state.settingsSection)) {
      this.state.settingsSection = "general";
    }
  }

  ensureModelProfilesPresent(runtimeModels = []) {
    const runtime = Array.isArray(runtimeModels) ? runtimeModels : [];
    const profileModels = Object.values(MODEL_PROFILES).map((p) => ({ id: p.id, name: p.name }));
    const existing = Array.isArray(this.state.models) ? this.state.models : [];

    const canonicalKey = (id) => this.shortName(String(id || "")).trim().toLowerCase();

    const merged = [...runtime, ...existing, ...profileModels];
    const byKey = new Map();

    for (const model of merged) {
      const id = String(model?.id || "").trim();
      if (!id) continue;

      const key = canonicalKey(id) || id.toLowerCase();
      const name = String(model?.name || this.shortName(id));
      const normalized = { id, name };

      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, normalized);
        continue;
      }

      // Prefer profile-labelled entries for readability in model picker.
      const prevIsProfileName = /Gemma 3n/i.test(prev.name);
      const nextIsProfileName = /Gemma 3n/i.test(normalized.name);
      if (!prevIsProfileName && nextIsProfileName) {
        byKey.set(key, normalized);
      }
    }

    this.state.models = Array.from(byKey.values());

    const selectedKey = canonicalKey(this.state.selectedModel || "");
    const canonicalSelected = this.state.models.find((m) => canonicalKey(m.id) === selectedKey);
    if (canonicalSelected) {
      this.state.selectedModel = canonicalSelected.id;
      localStorage.setItem("steve.model", this.state.selectedModel);
      return;
    }

    if (this.state.models.length > 0) {
      this.state.selectedModel = this.state.models[0].id;
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
    if (backend !== "regular") this.state.runtimeGpuWarning = "";
    this.renderBackendUi();
    this.renderRuntimeTargetUi();
    this.renderLocalLlamaButton();
    this.renderReasoningToggleAvailability();
    this.queueReasoningCapabilityProbe({ force: true });

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

    if (kind === "error") {
      this.state.runtimeErrorText = String(text || this.state.runtimeStatusText || "Runtime error");
    } else {
      this.state.runtimeErrorText = "";
    }

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

  autoSizeComposerInput() {
    const el = this.els.messageInput;
    if (!el) return;
    el.style.height = "auto";
    const target = Math.max(42, Math.min(150, Number(el.scrollHeight || 42)));
    el.style.height = `${target}px`;
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

    this.els.mockModeBtn?.addEventListener("click", () => this.setMode(false));
    this.els.runtimeModeBtn?.addEventListener("click", () => this.setMode(true));
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
    this.els.reasoningToggle?.addEventListener("change", (e) => {
      this.state.reasoningEnabled = Boolean(e.target.checked);
      localStorage.setItem("steve.reasoningEnabled", this.state.reasoningEnabled ? "1" : "0");
      this.setRuntimeState("idle", this.state.reasoningEnabled
        ? "Reasoning enabled (runtime will emit reasoning when model supports it)."
        : "Reasoning disabled.");
      this.schedulePersist();
      this.renderMessages();
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
      if (e.key !== "Enter") return;
      // ChatGPT-like multiline composer: Enter inserts newline.
      // Use Ctrl/Cmd+Enter to send quickly.
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.onSend();
      }
    });

    this.els.messageInput.addEventListener("input", () => {
      this.autoSizeComposerInput();
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
    let action = null;
    let committed = false;

    const edgeWidth = 36;
    const threshold = 28;

    const isInteractiveTarget = (target) => Boolean(
      target?.closest?.("button,input,select,textarea,a,.chat-item,[role='button']"),
    );

    const finish = () => {
      if (!active) return;
      const pid = pointerId;
      active = false;
      pointerId = null;
      action = null;
      committed = false;
      if (pid != null && host.releasePointerCapture) {
        try { host.releasePointerCapture(pid); } catch { /* ignore */ }
      }
    };

    const resolveAction = (clientX, targetEl = null) => {
      if (isInteractiveTarget(targetEl)) return null;

      const wide = this.isWide();
      const drawerRect = this.els.drawer.getBoundingClientRect();
      const mode = wide
        ? this.getWideDrawerMode()
        : (this.els.drawer.classList.contains("open") ? "open" : "closed");

      const nearLeftEdge = clientX <= edgeWidth;
      const insideDrawer = clientX <= drawerRect.right;

      if (wide) {
        if (mode === "open" && insideDrawer) return "open_to_preview";
        if (mode === "preview" && insideDrawer) return "preview_bidirectional";
        if (mode === "closed" && nearLeftEdge) return "closed_to_open";
        return null;
      }

      if (mode === "open" && insideDrawer) return "mobile_open_to_closed";
      if (mode === "closed" && nearLeftEdge) return "closed_to_open";
      return null;
    };

    const begin = (clientX, clientY, targetEl = null, pid = null) => {
      if (active) return false;
      if (this.els.settingsSheet.classList.contains("show") || this.els.modelSheet.classList.contains("show")) return false;

      const nextAction = resolveAction(clientX, targetEl);
      if (!nextAction) return false;

      active = true;
      pointerId = pid;
      startX = clientX;
      startY = clientY;
      action = nextAction;
      committed = false;

      if (host.setPointerCapture && pointerId != null) {
        try { host.setPointerCapture(pointerId); } catch { /* ignore */ }
      }

      return true;
    };

    const maybeCommit = (clientX, clientY, pid = null) => {
      if (!active || committed) return false;
      if (pointerId != null && pid != null && pid !== pointerId) return false;

      const dx = clientX - startX;
      const dy = clientY - startY;
      const horizontal = Math.abs(dx) >= Math.abs(dy) * 0.45;
      if (!horizontal) return false;

      if (action === "closed_to_open" && dx > threshold) {
        this.toggleDrawer(true);
        committed = true;
        return true;
      }

      if (action === "open_to_preview" && dx < -threshold) {
        this.setWideDrawerMode("preview");
        committed = true;
        return true;
      }

      if (action === "preview_bidirectional") {
        if (dx > threshold) {
          this.setWideDrawerMode("open");
          committed = true;
          return true;
        }
        if (dx < -threshold) {
          this.setWideDrawerMode("closed");
          committed = true;
          return true;
        }
      }

      if (action === "mobile_open_to_closed" && dx < -threshold) {
        this.toggleDrawer(false);
        committed = true;
        return true;
      }

      return false;
    };

    const complete = (clientX, clientY, pid = null) => {
      maybeCommit(clientX, clientY, pid);
      finish();
    };

    const onDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      begin(e.clientX, e.clientY, e.target, e.pointerId);
    };

    const onMove = (e) => {
      maybeCommit(e.clientX, e.clientY, e.pointerId);
    };

    const onUp = (e) => {
      complete(e.clientX, e.clientY, e.pointerId);
    };

    const onTouchStart = (e) => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      begin(t.clientX, t.clientY, e.target, null);
    };

    const onTouchMove = (e) => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      maybeCommit(t.clientX, t.clientY, null);
    };

    const onTouchEnd = (e) => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      complete(t.clientX, t.clientY, null);
    };

    const onCancel = () => finish();

    host.addEventListener("pointerdown", onDown, { passive: true });
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerup", onUp, { passive: true });
    host.addEventListener("pointercancel", onCancel, { passive: true });
    host.addEventListener("lostpointercapture", onCancel, { passive: true });
    host.addEventListener("touchstart", onTouchStart, { passive: true });
    host.addEventListener("touchmove", onTouchMove, { passive: true });
    host.addEventListener("touchend", onTouchEnd, { passive: true });
    host.addEventListener("touchcancel", onCancel, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onCancel, { passive: true });
    window.addEventListener("blur", onCancel, { passive: true });
    document.addEventListener("visibilitychange", onCancel, { passive: true });

    this.drawerDrag = {
      cleanup: () => {
        host.removeEventListener("pointerdown", onDown);
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerup", onUp);
        host.removeEventListener("pointercancel", onCancel);
        host.removeEventListener("lostpointercapture", onCancel);
        host.removeEventListener("touchstart", onTouchStart);
        host.removeEventListener("touchmove", onTouchMove);
        host.removeEventListener("touchend", onTouchEnd);
        host.removeEventListener("touchcancel", onCancel);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", onTouchEnd);
        window.removeEventListener("touchcancel", onCancel);
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
      this.els.drawerCompactBtn.textContent = mode === "open" ? "«" : (mode === "preview" ? "»" : "☰");
      this.els.drawerCompactBtn.title = mode === "open"
        ? "Switch drawer to preview"
        : (mode === "preview" ? "Switch drawer to closed" : "Open full drawer");

      const showHeaderActions = mode === "open";
      this.els.settingsBtn.hidden = !showHeaderActions;
      this.els.archivesBtn.hidden = !showHeaderActions;
      return;
    }

    this.els.drawerCompactBtn.textContent = "☰";
    this.els.drawerCompactBtn.title = "Toggle compact sidebar";
    this.els.settingsBtn.hidden = false;
    this.els.archivesBtn.hidden = false;
  }

  toggleSidebarCollapsed() {
    if (!this.isWide()) return;
    const mode = this.getWideDrawerMode();

    if (mode === "open") {
      this.setWideDrawerMode("preview");
      return;
    }

    if (mode === "preview") {
      this.setWideDrawerMode("open");
      return;
    }

    this.setWideDrawerMode("open");
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
    const mobileDrawerOpen = !this.isWide() && this.els.drawer.classList.contains("open");
    const show = settingsOpen || modelOpen || mobileDrawerOpen;

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

  escapeHtml(raw) {
    return String(raw || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  formatInlineMarkdown(safeText) {
    let out = String(safeText || "");
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s.,!?;:)])/g, "$1<em>$2</em>");
    out = out.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,!?;:)])/g, "$1<em>$2</em>");
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return out;
  }

  renderMarkdownHtml(text) {
    const raw = String(text || "").replace(/\r\n?/g, "\n").trim();
    if (!raw) return "";

    const safe = this.escapeHtml(raw);
    const codeBlocks = [];
    let working = safe.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_m, lang, code) => {
      const idx = codeBlocks.length;
      const cleanLang = String(lang || "").trim();
      codeBlocks.push(`<pre class="md-code"><code${cleanLang ? ` data-lang="${cleanLang}"` : ""}>${code}</code></pre>`);
      return `@@CODE_BLOCK_${idx}@@`;
    });

    const parseCells = (line) => line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => this.formatInlineMarkdown(c.trim()));

    const blocks = working.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    const rendered = [];

    for (const block of blocks) {
      if (/^@@CODE_BLOCK_\d+@@$/.test(block)) {
        rendered.push(block);
        continue;
      }

      const lines = block.split("\n").map((l) => l.trimEnd());
      const unordered = lines.every((l) => /^\s*[-*+]\s+/.test(l));
      const ordered = lines.every((l) => /^\s*\d+\.\s+/.test(l));
      const tableSep = lines.length >= 2 && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[1]) && lines[0].includes("|");

      if (tableSep) {
        const head = parseCells(lines[0]);
        const rows = lines.slice(2).filter((l) => l.includes("|")).map(parseCells);
        const thead = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
        const tbody = rows.length
          ? `<tbody>${rows.map((r) => `<tr>${head.map((_, i) => `<td>${r[i] || ""}</td>`).join("")}</tr>`).join("")}</tbody>`
          : "";
        rendered.push(`<div class="md-table-wrap"><table>${thead}${tbody}</table></div>`);
        continue;
      }

      if (unordered) {
        const items = lines.map((l) => this.formatInlineMarkdown(l.replace(/^\s*[-*+]\s+/, "")));
        rendered.push(`<ul>${items.map((it) => `<li>${it}</li>`).join("")}</ul>`);
        continue;
      }

      if (ordered) {
        const items = lines.map((l) => this.formatInlineMarkdown(l.replace(/^\s*\d+\.\s+/, "")));
        rendered.push(`<ol>${items.map((it) => `<li>${it}</li>`).join("")}</ol>`);
        continue;
      }

      if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0])) {
        const m = lines[0].match(/^(#{1,3})\s+(.*)$/);
        const level = Math.min(3, m?.[1]?.length || 1);
        rendered.push(`<h${level}>${this.formatInlineMarkdown(m?.[2] || "")}</h${level}>`);
        continue;
      }

      rendered.push(`<p>${lines.map((l) => this.formatInlineMarkdown(l)).join("<br>")}</p>`);
    }

    let html = rendered.join("");
    codeBlocks.forEach((codeHtml, idx) => {
      html = html.split(`@@CODE_BLOCK_${idx}@@`).join(codeHtml);
    });

    return html;
  }

  sanitizeModelTemplateSlop(text = "") {
    let out = String(text || "");

    out = out.replace(/<\|im_start\|>|<\|im_end\|>|<im_start>|<im_end>/gi, " ");
    out = out.replace(/<\|START_THINKING\|>|<\|END_THINKING\|>/gi, " ");
    out = out.replace(/<start_of_turn>|<end_of_turn>|<\|start_of_turn\|>|<\|end_of_turn\|>/gi, " ");
    out = out.replace(/<\|eot_id\|>|<\|start_header_id\|>|<\|end_header_id\|>/gi, " ");
    out = out.replace(/(^|\n)\s*(user|assistant|model)\s*:?\s*(?=\n|$)/gi, "$1");

    out = out.replace(/[ \t]+\n/g, "\n");
    out = out.replace(/\n{3,}/g, "\n\n");
    return out.trim();
  }

  composeAssistantParts({ content = "", reasoning = "" } = {}) {
    const cleanContentRaw = String(content || "").trim();
    const cleanReasoningRaw = String(reasoning || "").trim();
    const cleanContent = this.sanitizeModelTemplateSlop(cleanContentRaw);
    const cleanReasoning = this.state.reasoningEnabled
      ? this.sanitizeModelTemplateSlop(cleanReasoningRaw)
      : "";

    return {
      text: cleanContent || (cleanContentRaw ? "(template tokens filtered)" : "(empty reply)"),
      reasoningText: cleanReasoning,
    };
  }

  renderMessages() {
    const messages = this.state.messages[this.state.activeChatId] || [];
    const scroller = this.els.messages;
    const prevScrollTop = scroller.scrollTop;
    const prevScrollHeight = scroller.scrollHeight;
    const distanceFromBottom = prevScrollHeight - (prevScrollTop + scroller.clientHeight);
    const shouldStickBottom = distanceFromBottom <= 72;

    scroller.innerHTML = "";

    messages.forEach((msg, messageIndex) => {
      const row = document.createElement("article");
      row.className = `msg-row ${msg.role}`;

      const swipeCue = document.createElement("div");
      swipeCue.className = "msg-swipe-cue";
      swipeCue.textContent = "← Reply";
      row.appendChild(swipeCue);

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

      if (msg.role === "steve" && this.state.reasoningEnabled && msg.reasoningText) {
        const reasoningWrap = document.createElement("details");
        reasoningWrap.className = "reasoning-block";
        reasoningWrap.open = true;

        const summary = document.createElement("summary");
        summary.textContent = "Reasoning";
        reasoningWrap.appendChild(summary);

        const reasoningBody = document.createElement("div");
        reasoningBody.className = "reasoning-body msg-body";
        reasoningBody.innerHTML = this.renderMarkdownHtml(this.sanitizeModelTemplateSlop(msg.reasoningText));
        reasoningWrap.appendChild(reasoningBody);

        bubble.appendChild(reasoningWrap);
      }

      const body = document.createElement("div");
      body.className = "msg-body";
      const displayText = msg.role === "steve"
        ? this.sanitizeModelTemplateSlop(msg.text)
        : String(msg.text || "");
      body.innerHTML = this.renderMarkdownHtml(displayText);
      bubble.appendChild(body);

      if (msg.role === "steve" && (msg.tps != null || msg.energyMWh != null)) {
        const meta = document.createElement("div");
        meta.className = "msg-tps";

        const bits = [];
        if (msg.tps != null) {
          const n = Number(msg.tps);
          const fixed = Number.isFinite(n) ? (n >= 10 ? n.toFixed(0) : n.toFixed(1)) : "--";
          bits.push(`${fixed} tokens/s`);
        }
        if (msg.energyMWh != null) {
          bits.push(this.formatEnergyMWh(msg.energyMWh));
        }

        meta.textContent = bits.join(" • ");
        bubble.appendChild(meta);
      }

      row.appendChild(avatar);
      row.appendChild(bubble);

      if (!msg.pending) {
        GestureService.bindSwipeAction(row, {
          onLeft: () => this.setReplyTarget(messageIndex, msg),
          threshold: 26,
          previewClassLeft: "swipe-preview-left",
          transformEl: bubble,
          maxTranslate: 64,
        });
      }

      scroller.appendChild(row);
    });

    if (shouldStickBottom) {
      scroller.scrollTop = scroller.scrollHeight;
    } else {
      scroller.scrollTop = Math.min(prevScrollTop, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    }
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
        this.queueReasoningCapabilityProbe({ force: true });

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
    this.renderReasoningToggleAvailability();
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

  persistReasoningCapabilityCache() {
    try {
      localStorage.setItem("steve.reasoningCapabilityByModel", JSON.stringify(this.state.reasoningCapabilityByModel || {}));
    } catch {
      // ignore localStorage write errors
    }
  }

  getReasoningCapabilityKey(modelId = "") {
    return `${this.state.backend || "regular"}::${String(modelId || "").trim()}`;
  }

  getReasoningCapabilityState(modelId = "") {
    const modelKey = String(modelId || "").trim();
    if (!modelKey) return "unknown";
    const key = this.getReasoningCapabilityKey(modelKey);
    const entry = this.state.reasoningCapabilityByModel?.[key];
    if (!entry) return "unknown";
    const state = String(entry.state || "unknown").toLowerCase();
    if (["supported", "unsupported", "checking", "unknown"].includes(state)) return state;
    return "unknown";
  }

  getReasoningCapabilityEntry(modelId = "") {
    const modelKey = String(modelId || "").trim();
    if (!modelKey) return null;
    const key = this.getReasoningCapabilityKey(modelKey);
    const entry = this.state.reasoningCapabilityByModel?.[key];
    return entry && typeof entry === "object" ? entry : null;
  }

  setReasoningCapabilityState(modelId = "", state = "unknown") {
    const modelKey = String(modelId || "").trim();
    if (!modelKey) return;
    const key = this.getReasoningCapabilityKey(modelKey);
    const normalized = ["supported", "unsupported", "checking", "unknown"].includes(String(state))
      ? String(state)
      : "unknown";
    if (!this.state.reasoningCapabilityByModel || typeof this.state.reasoningCapabilityByModel !== "object") {
      this.state.reasoningCapabilityByModel = {};
    }
    this.state.reasoningCapabilityByModel[key] = {
      state: normalized,
      checkedAt: Date.now(),
    };
    this.persistReasoningCapabilityCache();
  }

  renderReasoningToggleAvailability() {
    const input = this.els.reasoningToggle;
    const row = this.els.reasoningToggleRow;
    const hint = this.els.reasoningToggleHint;
    if (!input || !row) return;

    const modelId = String(this.state.selectedModel || "").trim();
    let capability = this.getReasoningCapabilityState(modelId);
    const capEntry = this.getReasoningCapabilityEntry(modelId);

    // Recover from stale checking states (e.g., interrupted probe / runtime stall).
    if (capability === "checking") {
      const checkedAt = Number(capEntry?.checkedAt || 0);
      const ageMs = checkedAt > 0 ? (Date.now() - checkedAt) : Number.POSITIVE_INFINITY;
      if (ageMs > 30000) {
        this.setReasoningCapabilityState(modelId, "unknown");
        capability = "unknown";
      }
    }

    let selectable = true;
    let hintText = "Runtime reasoning output can be toggled when selected model supports it.";

    if (capability === "checking") {
      selectable = false;
      hintText = "Checking reasoning compatibility for selected model…";
    } else if (capability === "unsupported") {
      selectable = false;
      hintText = "Reasoning output unavailable for current model/runtime response mode.";
    } else if (capability === "supported") {
      selectable = true;
      hintText = "Reasoning output available for this model.";
    } else {
      selectable = false;
      hintText = "Reasoning compatibility not verified yet.";
    }

    input.disabled = !selectable;
    row.classList.toggle("disabled", !selectable);
    if (!selectable && this.state.reasoningEnabled) {
      this.state.reasoningEnabled = false;
      localStorage.setItem("steve.reasoningEnabled", "0");
    }
    input.checked = Boolean(this.state.reasoningEnabled && selectable);

    if (hint) hint.textContent = hintText;
  }

  queueReasoningCapabilityProbe({ force = false } = {}) {
    if (!this.state.liveMode) return;

    if (!force && this.state.runtimeState === "working") {
      clearTimeout(this.reasoningProbeTimer);
      this.reasoningProbeTimer = window.setTimeout(() => this.queueReasoningCapabilityProbe(), 1200);
      return;
    }

    const modelId = String(this.state.selectedModel || "").trim();
    if (!modelId) return;

    const state = this.getReasoningCapabilityState(modelId);
    if (!force && (state === "supported" || state === "unsupported")) {
      this.renderReasoningToggleAvailability();
      return;
    }

    if (!force && state === "checking") {
      const entry = this.getReasoningCapabilityEntry(modelId);
      const checkedAt = Number(entry?.checkedAt || 0);
      const ageMs = checkedAt > 0 ? (Date.now() - checkedAt) : Number.POSITIVE_INFINITY;
      if (ageMs < 30000) {
        this.renderReasoningToggleAvailability();
        return;
      }
    }

    clearTimeout(this.reasoningProbeTimer);
    this.reasoningProbeTimer = window.setTimeout(() => {
      this.probeReasoningCapabilityForSelectedModel({ force }).catch(() => {
        // handled in probe
      });
    }, 120);
  }

  async probeReasoningCapabilityForSelectedModel({ force = false } = {}) {
    if (!this.state.liveMode) return;

    if (this.inferenceRunning) {
      this.queueReasoningCapabilityProbe({ force });
      return;
    }

    const modelId = String(this.state.selectedModel || "").trim();
    if (!modelId) return;

    const known = this.getReasoningCapabilityState(modelId);
    if (!force && (known === "supported" || known === "unsupported")) {
      this.renderReasoningToggleAvailability();
      return;
    }

    this.setReasoningCapabilityState(modelId, "checking");
    this.renderReasoningToggleAvailability();

    this.reasoningProbeController?.abort?.();
    this.reasoningProbeController = new AbortController();
    const probeSignal = this.reasoningProbeController.signal;
    const probeTimeout = window.setTimeout(() => {
      this.reasoningProbeController?.abort?.();
    }, 15000);

    try {
      const probe = await this.withRuntimeRetry(() => this.runtimeClient.completeOnce({
        baseUrl: this.state.baseUrl,
        model: modelId,
        messages: [{ role: "user", content: "Solve 19+23 and show short reasoning then final answer." }],
        maxTokens: 96,
        temperature: 0,
        topP: 0.9,
        topK: 24,
        minP: 0.03,
        typicalP: 1,
        repeatPenalty: 1,
        reasoningEnabled: true,
        signal: probeSignal,
      }), {
        signal: probeSignal,
        baseUrl: this.state.baseUrl,
        attempts: 2,
        phaseLabel: "Reasoning capability probe",
        allowAutoRecover: false,
        suppressStatus: true,
      });

      this.updateReasoningCapabilityFromResponse({
        modelId,
        content: probe?.content || probe?.reply,
        reasoning: probe?.reasoning,
      });
    } catch (err) {
      const aborted = err?.name === "AbortError";
      // If probe stalls or runtime is unavailable, fail closed (dim/disabled)
      // so we do not leave UI in perpetual "checking".
      this.setReasoningCapabilityState(modelId, aborted ? "unsupported" : "unknown");
    } finally {
      clearTimeout(probeTimeout);
      this.reasoningProbeController = null;
      this.renderReasoningToggleAvailability();
      this.schedulePersist();
    }
  }

  updateReasoningCapabilityFromResponse({ modelId = "", content = "", reasoning = "" } = {}) {
    const id = String(modelId || this.state.selectedModel || "").trim();
    if (!id) return;

    const body = String(content || "").trim();
    const reason = String(reasoning || "").trim();
    const hasReasoningTag = /<think>|<\|START_THINKING\|>|<\|END_THINKING\|>/i.test(body);
    const supported = Boolean(reason) || hasReasoningTag;

    this.setReasoningCapabilityState(id, supported ? "supported" : "unsupported");
    this.renderReasoningToggleAvailability();
  }

  renderModeUi() {
    this.els.mockModeBtn?.classList.toggle("active", !this.state.liveMode);
    this.els.runtimeModeBtn?.classList.toggle("active", this.state.liveMode);
    if (this.els.streamModeToggle) this.els.streamModeToggle.checked = Boolean(this.state.streamMode);
    if (this.els.ttsToggle) this.els.ttsToggle.checked = Boolean(this.state.ttsEnabled);
    if (this.els.reasoningToggle) this.els.reasoningToggle.checked = Boolean(this.state.reasoningEnabled);
    this.renderReasoningToggleAvailability();

    const chatDefaults = `Temp ${this.state.generation.temperature} • top-k ${this.state.generation.topK} • top-p ${this.state.generation.topP} • min-p ${this.state.generation.minP} • max ${this.state.generation.maxTokens}`;
    this.els.modeHint.textContent = `Local Runtime (${this.getBackendLabel()}) uses chat history with /v1/chat/completions. ${chatDefaults}.`;

    const rawStatus = String(this.state.runtimeStatusText || "Runtime: idle.");
    const clippedStatus = this.state.runtimeState === "error" && rawStatus.length > 140
      ? `${rawStatus.slice(0, 140)}…`
      : rawStatus;
    const gpuNote = this.state.runtimeGpuWarning ? ` ${this.state.runtimeGpuWarning}` : "";
    this.els.runtimeStatus.textContent = `${clippedStatus}${gpuNote}`.trim();

    if (this.els.sessionBackendLabel) {
      const backendName = this.state.backend === "qvac" ? "QVAC" : "Regular";
      this.els.sessionBackendLabel.textContent = `Backend: ${backendName}`;
    }

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
    this.renderRuntimeErrorPanel();
  }

  renderRuntimeErrorPanel() {
    if (!this.els.runtimeErrorPanel || !this.els.runtimeErrorText) return;

    const full = String(this.state.runtimeErrorText || "").trim();
    if (!full) {
      this.els.runtimeErrorPanel.classList.add("hidden");
      this.els.runtimeErrorText.textContent = "";
      return;
    }

    this.els.runtimeErrorPanel.classList.remove("hidden");
    this.els.runtimeErrorText.textContent = full;
  }

  renderLocalLlamaButton() {
    const connected = Boolean(this.state.localLlamaConnected);
    this.els.connectLocalLlamaBtn.classList.toggle("active", connected);
    this.els.connectLocalLlamaBtn.textContent = "Connect";
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
      this.applyRuntimeOutputDiagnostics(switched?.output);

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

      await this.detectModels({
        allowAutoRecover: false,
        warmupTimeoutMs: 28000,
        requestTimeoutMs: 3200,
      });
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

  async detectModels({ allowAutoRecover = true, warmupTimeoutMs = 7000, requestTimeoutMs = 1800 } = {}) {
    this.saveBaseUrl();
    this.setRuntimeState("working", `Detecting models on ${this.state.baseUrl} (waiting for runtime warmup if needed)...`);

    const applyListedModels = (listed, { connectedLabel = null } = {}) => {
      this.ensureModelProfilesPresent(listed);
      this.renderModels();
      this.syncModelLabel();

      const localHit = this.state.baseUrl === this.getBackendEndpoint();
      this.state.localLlamaConnected = localHit;
      this.renderLocalLlamaButton();

      if (connectedLabel) {
        this.setRuntimeState("ok", connectedLabel);
      } else {
        this.setRuntimeState("ok", localHit ? `Connected ${this.getBackendLabel()}` : `Detected ${listed.length} model(s).`);
      }

      this.queueReasoningCapabilityProbe();
      this.notifyGpuFallbackIfNeeded();
      this.schedulePersist();
    };

    try {
      const listed = await this.runtimeClient.fetchModelsWithRetry(this.state.baseUrl, {
        timeoutMs: warmupTimeoutMs,
        intervalMs: 700,
        requestTimeoutMs,
      });

      applyListedModels(listed);
      return;
    } catch (err) {
      this.state.localLlamaConnected = false;
      const msg = String(err?.message || "Unknown error");
      const localEndpoint = this.state.baseUrl === this.getBackendEndpoint();
      const transient = this.isTransientRuntimeError(msg);

      // If model is still loading, wait longer instead of restart loops.
      if (localEndpoint && transient && this.isLoadingModelTransient(msg)) {
        this.setRuntimeState("working", "Runtime is still loading model weights. Waiting for warmup...");
        try {
          const listed = await this.runtimeClient.fetchModelsWithRetry(this.state.baseUrl, {
            timeoutMs: 28000,
            intervalMs: 800,
            requestTimeoutMs: 3200,
          });
          applyListedModels(listed, { connectedLabel: `Connected ${this.getBackendLabel()} (warmup complete).` });
          return;
        } catch (warmErr) {
          const warmMsg = String(warmErr?.message || warmErr || "Unknown warmup error");
          this.setRuntimeState("error", `Runtime warmup timed out: ${warmMsg}`);
          return;
        }
      }

      // Auto-recovery: only for true endpoint/network failures, not loading-model warmups.
      if (localEndpoint && transient && allowAutoRecover && this.shouldAttemptRuntimeAutoRecover(msg)) {
        const profile = MODEL_PROFILES[this.state.modelProfile] || MODEL_PROFILES.e4b;
        const target = this.state.backend === "qvac" ? "qvac-vulkan" : "reg-prebuilt";

        try {
          this.setRuntimeState("working", `Runtime unreachable, attempting auto-start (${this.getBackendLabel()}, ${profile.name})...`);
          const switched = await this.runtimeClient.switchLocalRuntime({
            target,
            modelIndex: profile.modelIndex,
            siteId: "steve-chat",
          });
          this.applyRuntimeOutputDiagnostics(switched?.output);

          const endpoint = switched?.endpoint || this.getBackendEndpoint();
          this.state.baseUrl = endpoint;
          this.els.baseUrlInput.value = endpoint;
          localStorage.setItem("steve.baseUrl", endpoint);

          const listed = await this.runtimeClient.fetchModelsWithRetry(endpoint, {
            timeoutMs: 28000,
            intervalMs: 800,
            requestTimeoutMs: 3500,
          });

          applyListedModels(listed, { connectedLabel: `Connected ${this.getBackendLabel()} (auto-started runtime).` });
          return;
        } catch (autoErr) {
          const autoMsg = String(autoErr?.message || autoErr || "Unknown auto-start error");
          this.setRuntimeState("error", `Detect failed: ${msg}. Auto-start also failed: ${autoMsg}`);
          return;
        }
      }

      if (this.state.backend === "qvac" && /NetworkError|Failed to fetch|fetch|timeout/i.test(msg)) {
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

  isLoadingModelTransient(message = "") {
    const msg = String(message || "");
    return /Loading model|Runtime not ready|No models returned/i.test(msg);
  }

  shouldAttemptRuntimeAutoRecover(message = "") {
    const msg = String(message || "");
    if (this.isLoadingModelTransient(msg)) return false;
    return /Failed to fetch|NetworkError|ECONN|connection|timeout|fetch/i.test(msg);
  }

  applyRuntimeOutputDiagnostics(outputText = "") {
    const out = String(outputText || "");
    const noGpu = /no usable GPU found|compiled without GPU support|GPU offload not active/i.test(out);

    if (noGpu && this.state.backend === "regular") {
      this.state.runtimeGpuWarning = "Regular llama.cpp on this install is CPU-only; use QVAC backend for GPU inference.";
      return;
    }

    if (this.state.backend !== "regular") {
      this.state.runtimeGpuWarning = "";
    }
  }

  async tryAutoRecoverLocalRuntime({ baseUrl = "", signal = null, reason = "" } = {}) {
    const endpoint = String(baseUrl || "").trim();
    if (!endpoint || endpoint !== this.getBackendEndpoint()) return false;

    const profile = MODEL_PROFILES[this.state.modelProfile] || MODEL_PROFILES.e4b;
    const target = this.state.backend === "qvac" ? "qvac-vulkan" : "reg-prebuilt";

    try {
      this.setRuntimeState("working", `Runtime seems down (${reason}). Attempting auto-start on ${this.getBackendLabel()}...`);
      const switched = await this.runtimeClient.switchLocalRuntime({
        target,
        modelIndex: profile.modelIndex,
        siteId: "steve-chat",
      });
      this.applyRuntimeOutputDiagnostics(switched?.output);

      const nextEndpoint = switched?.endpoint || this.getBackendEndpoint();
      this.state.baseUrl = nextEndpoint;
      this.els.baseUrlInput.value = nextEndpoint;
      localStorage.setItem("steve.baseUrl", nextEndpoint);

      const listed = await this.runtimeClient.fetchModelsWithRetry(nextEndpoint, {
        timeoutMs: 22000,
        intervalMs: 800,
        requestTimeoutMs: 3200,
        signal,
      });

      this.ensureModelProfilesPresent(listed);
      this.renderModels();
      this.syncModelLabel();
      this.queueReasoningCapabilityProbe();
      this.state.localLlamaConnected = true;
      this.renderLocalLlamaButton();
      this.setRuntimeState("ok", `Connected ${this.getBackendLabel()} (auto-recovered).`);
      await this.notifyGpuFallbackIfNeeded();
      this.schedulePersist();
      return true;
    } catch {
      return false;
    }
  }

  async withRuntimeRetry(taskFn, {
    signal = null,
    baseUrl = "",
    attempts = 6,
    warmupTimeoutMs = 22000,
    warmupIntervalMs = 700,
    phaseLabel = "Runtime call",
    allowAutoRecover = true,
    suppressStatus = false,
  } = {}) {
    let lastErr = null;
    let attemptedAutoRecover = false;

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

        if (!suppressStatus) {
          this.setRuntimeState("working", `${phaseLabel} hit transient runtime issue (${msg}). Retrying...`);
        }

        if (!attemptedAutoRecover && baseUrl && allowAutoRecover && this.shouldAttemptRuntimeAutoRecover(msg)) {
          attemptedAutoRecover = true;
          await this.tryAutoRecoverLocalRuntime({ baseUrl, signal, reason: msg });
        }

        if (baseUrl) {
          try {
            await this.runtimeClient.fetchModelsWithRetry(baseUrl, {
              timeoutMs: warmupTimeoutMs,
              intervalMs: warmupIntervalMs,
              requestTimeoutMs: 3200,
              signal,
            });
          } catch {
            // ignore warmup failure; we'll still retry task once.
          }
        }

        const loadingModel = /Loading model|HTTP\s*503|Service Unavailable/i.test(msg);
        const backoffMs = loadingModel ? (2200 + attempt * 1800) : 380;
        await this.runtimeClient.sleep(backoffMs, signal);
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
    const mw = Math.max(0, n);
    return `${mw >= 100 ? mw.toFixed(0) : mw.toFixed(1)} mW/s`;
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

    this.els.powerAvgValue.textContent = "--";

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

  isLowSignalAssistantMessage(text = "") {
    const t = String(text || "").trim().toLowerCase();
    if (!t) return true;
    if (/^\(generation stopped\)$/.test(t)) return true;
    if (/^live call failed:/i.test(t)) return true;
    if (/^(hi|ok|live|test|yes|no|done|stop|stopped|generation stopped)$/.test(t)) return true;
    return false;
  }

  buildRuntimeMessages(chatId = this.state.activeChatId) {
    const raw = this.state.messages[chatId] || [];
    const mapped = raw
      .filter((m) => m.role === "user" || m.role === "steve")
      .map((m) => {
        const role = m.role === "steve" ? "assistant" : "user";
        const rawText = String(m.text || "").trim();
        const content = role === "assistant"
          ? this.sanitizeModelTemplateSlop(rawText)
          : rawText;
        return { role, content };
      })
      .filter((m) => m.content.length > 0)
      .filter((m) => {
        if (m.role !== "assistant") return true;
        if (m.content.length <= 20 && this.isLowSignalAssistantMessage(m.content)) return false;
        return true;
      });

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
    const windowed = normalized.slice(-RUNTIME_STABILITY_PROFILE.maxHistoryMessages);
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
    const tokenBudget = RUNTIME_STABILITY_PROFILE.historyTokenBudget;
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
    this.autoSizeComposerInput();

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
    let streamedReasoning = "";

    try {
      let readyModels = [];
      try {
        readyModels = await this.runtimeClient.fetchModelsWithRetry(this.state.baseUrl, {
          timeoutMs: 8000,
          intervalMs: 700,
          requestTimeoutMs: 3000,
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
          reasoningEnabled: this.state.reasoningEnabled,
          onToken: (chunk) => {
            const contentChunk = typeof chunk === "string"
              ? chunk
              : String(chunk?.content || chunk?.text || "");
            const reasoningChunk = typeof chunk === "string"
              ? ""
              : String(chunk?.reasoning || "");

            if (contentChunk) streamedText += contentChunk;
            if (reasoningChunk) streamedReasoning += reasoningChunk;

            chunkCount += 1;
            const combinedOutput = this.state.reasoningEnabled
              ? `${streamedReasoning}\n${streamedText}`.trim()
              : streamedText;
            completionPreviewTokens = Math.max(1, this.estimateTokenCount(combinedOutput));
            const elapsedSec = Math.max(0.2, (performance.now() - startedAt) / 1000);
            liveTps = completionPreviewTokens / elapsedSec;
            livePowerMw = this.estimateAutoPowerMw({ text, tps: liveTps, live: true });
            this.recordPowerSample(livePowerMw);

            const display = this.composeAssistantParts({
              content: streamedText,
              reasoning: streamedReasoning,
            });

            this.patchMessage(chatId, assistantIndex, {
              text: display.text,
              reasoningText: display.reasoningText,
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
          attempts: 6,
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
            reasoningEnabled: this.state.reasoningEnabled,
            signal,
          }), {
            signal,
            baseUrl: this.state.baseUrl,
            attempts: 6,
            phaseLabel: "Fallback completion",
          });

          streamedText = String(retry?.content || retry?.reply || "").trim();
          streamedReasoning = String(retry?.reasoning || "").trim();
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
        const display = this.composeAssistantParts({
          content: streamedText,
          reasoning: streamedReasoning,
        });

        const promptTokens = result?.promptTokens ?? this.estimateTokenCount(text);
        const completionTokens = result?.completionTokens ?? Math.max(1, this.estimateTokenCount(`${display.reasoningText}\n${display.text}`));
        const totalTokens = result?.totalTokens ?? (promptTokens + completionTokens);
        const finalTps = completionTokens / Math.max(0.2, elapsedMs / 1000);
        const finalPowerMw = this.estimateAutoPowerMw({ text, tps: finalTps, live: true });
        const energyMWh = this.addEnergyUsage(finalPowerMw, elapsedMs);
        this.addTokenUsage({ promptTokens, completionTokens, totalTokens });

        this.patchMessage(chatId, assistantIndex, {
          text: display.text,
          reasoningText: display.reasoningText,
          pending: false,
          error: false,
          tps: finalTps ?? null,
          energyMw: finalPowerMw,
          energyMWh,
        });

        this.renderPowerUi();
        this.renderTokenUi();
        this.speakText(display.text);
        this.updateReasoningCapabilityFromResponse({
          modelId: this.state.selectedModel,
          content: streamedText,
          reasoning: streamedReasoning,
        });
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
        reasoningEnabled: this.state.reasoningEnabled,
        signal,
      }), {
        signal,
        baseUrl: this.state.baseUrl,
        attempts: 6,
        phaseLabel: "Completion call",
      });

      const elapsedMs = Math.max(1, performance.now() - startedAt);
      const display = this.composeAssistantParts({
        content: oneShot.content || oneShot.reply,
        reasoning: oneShot.reasoning,
      });

      const promptTokens = oneShot.promptTokens ?? this.estimateTokenCount(text);
      const completionTokens = oneShot.completionTokens ?? this.estimateTokenCount(`${display.reasoningText}\n${display.text}`);
      const totalTokens = oneShot.totalTokens ?? (promptTokens + completionTokens);
      const effectiveTps = completionTokens / Math.max(0.2, elapsedMs / 1000);
      const powerMw = this.estimateAutoPowerMw({ text, tps: effectiveTps, live: true });
      const energyMWh = this.addEnergyUsage(powerMw, elapsedMs);

      this.addTokenUsage({ promptTokens, completionTokens, totalTokens });

      this.patchMessage(chatId, assistantIndex, {
        text: display.text,
        reasoningText: display.reasoningText,
        pending: false,
        error: false,
        tps: effectiveTps,
        energyMw: powerMw,
        energyMWh,
      });
      this.renderPowerUi();
      this.renderTokenUi();
      this.speakText(display.text);
      this.updateReasoningCapabilityFromResponse({
        modelId: this.state.selectedModel,
        content: oneShot.content || oneShot.reply,
        reasoning: oneShot.reasoning,
      });
      this.setRuntimeState("ok", `Live response complete. Session energy ${this.formatEnergyMWh(this.state.power.sessionEnergyMWh)}.`);
    } catch (err) {
      const aborted = err?.name === "AbortError" || /aborted|abort/i.test(String(err?.message || ""));
      if (aborted) {
        const stoppedText = streamedText.trim() || "(generation stopped)";
        const stopped = this.composeAssistantParts({
          content: stoppedText,
          reasoning: streamedReasoning,
        });
        this.patchMessage(chatId, assistantIndex, {
          text: stopped.text,
          reasoningText: stopped.reasoningText,
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
