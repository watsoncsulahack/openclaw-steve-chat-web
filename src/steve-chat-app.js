import { getDomRefs } from "./dom.js";
import { IdenticonService } from "./services/identicon-service.js";
import { GestureService } from "./services/gesture-service.js";
import { RuntimeClient } from "./services/runtime-client.js";
import { StorageService } from "./services/storage-service.js";

const WIDE_QUERY = "(min-width: 700px)";
const ARCHIVE_ICON_SVG = '<svg class="archive-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16"/><rect x="5" y="6" width="14" height="13" rx="2"/><path d="M9 11h6"/><path d="M9 14h6"/></svg>';
const BACKEND_ENDPOINTS = {
  regular: "http://127.0.0.1:18080",
  qvac: "http://127.0.0.1:18081",
};

export class SteveChatApp {
  constructor() {
    this.els = getDomRefs();
    this.identicons = new IdenticonService();
    this.runtimeClient = new RuntimeClient();
    this.storage = new StorageService("steve.state.v2");
    this.persistTimer = null;
    this.recognition = null;

    this.state = this.storage.load(this.createInitialState());
  }

  createInitialState() {
    const backend = localStorage.getItem("steve.backend") || "regular";
    const baseUrl = localStorage.getItem("steve.baseUrl") || BACKEND_ENDPOINTS[backend] || BACKEND_ENDPOINTS.regular;

    return {
      backend,
      baseUrl,
      liveMode: localStorage.getItem("steve.liveMode") === "1",
      sidebarCollapsed: localStorage.getItem("steve.sidebarCollapsed") === "1",
      theme: localStorage.getItem("steve.theme") || "dark",
      showArchived: false,
      replyTarget: null,
      mockMicOn: false,
      activeChatId: "steve",
      selectedModel: localStorage.getItem("steve.model") || "gemma-3n-e4b",
      chatFilter: "",
      streamMode: true,
      ttsEnabled: false,
      runtimeState: "idle",
      runtimeStatusText: "Runtime ready.",
      localLlamaConnected: false,
      models: [
        { id: "gemma-3n-e4b", name: "Gemma 3N E4B" },
        { id: "gemma-3n-e2b", name: "Gemma 3N E2B" },
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
    if (!BACKEND_ENDPOINTS[this.state.backend]) {
      this.state.backend = "regular";
    }

    this.els.baseUrlInput.value = this.state.baseUrl;
    this.els.streamModeToggle.checked = Boolean(this.state.streamMode);
    this.els.ttsToggle.checked = Boolean(this.state.ttsEnabled);
    this.applyTheme();
    this.bindEvents();
    this.bindViewportFixes();
    this.syncViewport();
    this.renderAll();
  }

  getBackendEndpoint() {
    return BACKEND_ENDPOINTS[this.state.backend] || BACKEND_ENDPOINTS.regular;
  }

  getBackendLabel() {
    return this.state.backend === "qvac" ? "qvac llama.cpp" : "llama.cpp";
  }

  setBackend(backend) {
    if (!BACKEND_ENDPOINTS[backend]) return;
    this.state.backend = backend;
    localStorage.setItem("steve.backend", backend);
    this.state.baseUrl = this.getBackendEndpoint();
    this.els.baseUrlInput.value = this.state.baseUrl;
    localStorage.setItem("steve.baseUrl", this.state.baseUrl);
    this.state.localLlamaConnected = false;
    this.renderBackendUi();
    this.renderLocalLlamaButton();
    this.setRuntimeState("idle", `Selected backend: ${backend}. Endpoint set to ${this.state.baseUrl}`);
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

  bindEvents() {
    this.els.menuBtn.addEventListener("click", () => this.toggleDrawer(true));
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

    this.els.backendRegularBtn.addEventListener("click", () => this.setBackend("regular"));
    this.els.backendQvacBtn.addEventListener("click", () => this.setBackend("qvac"));

    this.els.mockModeBtn.addEventListener("click", () => this.setMode(false));
    this.els.runtimeModeBtn.addEventListener("click", () => this.setMode(true));
    this.els.streamModeToggle.addEventListener("change", (e) => {
      this.state.streamMode = Boolean(e.target.checked);
      this.setRuntimeState("idle", this.state.streamMode ? "Streaming enabled." : "Streaming disabled.");
      this.schedulePersist();
    });
    this.els.ttsToggle.addEventListener("change", (e) => {
      this.state.ttsEnabled = Boolean(e.target.checked);
      this.setRuntimeState("idle", this.state.ttsEnabled ? "Text-to-speech enabled." : "Text-to-speech disabled.");
      this.schedulePersist();
    });

    this.els.sendBtn.addEventListener("click", () => this.onSend());
    this.els.messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.onSend();
    });

    this.els.plusBtn.addEventListener("click", () => {
      this.els.modeHint.textContent = "Attachment/actions menu hook (non-modal).";
    });

    this.els.micBtn.addEventListener("click", () => this.toggleSpeechInput());

    this.els.messageInput.addEventListener("focus", () => {
      window.setTimeout(() => this.ensureComposerVisible(), 120);
    });
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

  applySidebarLayoutState() {
    const collapsed = this.isWide() && this.state.sidebarCollapsed;
    this.els.appShell.classList.toggle("sidebar-collapsed", collapsed);
    this.els.drawerCompactBtn.textContent = collapsed ? "»" : "«";
    this.els.drawerCompactBtn.title = collapsed ? "Expand sidebar" : "Collapse to sidebar";
    this.els.settingsBtn.hidden = collapsed;
    this.els.archivesBtn.hidden = collapsed;
  }

  toggleSidebarCollapsed() {
    if (!this.isWide()) return;
    this.state.sidebarCollapsed = !this.state.sidebarCollapsed;
    localStorage.setItem("steve.sidebarCollapsed", this.state.sidebarCollapsed ? "1" : "0");
    this.applySidebarLayoutState();
    this.renderSidebarRail();
    this.schedulePersist();
  }

  syncViewport() {
    const vv = window.visualViewport;
    const height = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;

    document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
    document.documentElement.style.setProperty("--vv-top", `${Math.round(top)}px`);

    if (this.isWide()) {
      this.els.drawer.classList.add("open");
    }

    this.applySidebarLayoutState();
    this.syncBackdrop();
  }

  ensureComposerVisible() {
    this.els.composer?.scrollIntoView({ block: "end", behavior: "auto" });
  }

  toggleDrawer(open) {
    if (this.isWide()) {
      this.els.drawer.classList.add("open");
    } else {
      this.els.drawer.classList.toggle("open", open);
    }
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
    this.syncBackdrop();
  }

  syncBackdrop() {
    const settingsOpen = this.els.settingsSheet.classList.contains("show");
    const show = settingsOpen || (!this.isWide() && (
      this.els.drawer.classList.contains("open") ||
      this.els.modelSheet.classList.contains("show")
    ));

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
    this.renderModeUi();
    this.renderLocalLlamaButton();
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
    this.toggleDrawer(false);
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

    messages.forEach((msg, idx) => {
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

        meta.textContent = bits.join(" • ");
        bubble.appendChild(meta);
      }

      row.appendChild(avatar);
      row.appendChild(bubble);

      const cue = document.createElement("div");
      cue.className = "msg-swipe-cue";
      cue.textContent = "↩ Reply";
      row.appendChild(cue);

      GestureService.bindSwipeAction(row, {
        onRight: () => this.setReplyTarget(idx, msg),
        threshold: 88,
        previewClassRight: "swipe-preview-right",
        maxTranslate: 92,
      });

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
      btn.addEventListener("click", () => {
        this.state.selectedModel = model.id;
        localStorage.setItem("steve.model", model.id);
        this.syncModelLabel();
        this.renderModels();
        this.toggleModelSheet(false);
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
    this.els.backendRegularBtn.classList.toggle("active", this.state.backend === "regular");
    this.els.backendQvacBtn.classList.toggle("active", this.state.backend === "qvac");
  }

  renderModeUi() {
    this.els.mockModeBtn.classList.toggle("active", !this.state.liveMode);
    this.els.runtimeModeBtn.classList.toggle("active", this.state.liveMode);
    this.els.streamModeToggle.checked = Boolean(this.state.streamMode);
    this.els.ttsToggle.checked = Boolean(this.state.ttsEnabled);

    this.els.modeHint.textContent = this.state.liveMode
      ? "Local Runtime mode sends prompts with chat history to /v1/chat/completions."
      : "UI Demo mode uses mock Steve replies for flow testing.";

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
    this.renderLocalLlamaButton();
  }

  renderLocalLlamaButton() {
    const connected = Boolean(this.state.localLlamaConnected);
    const label = this.state.backend === "qvac" ? "local qvac llama.cpp" : "local llama.cpp";
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

  saveBaseUrl() {
    this.state.baseUrl = (this.els.baseUrlInput.value || "").trim().replace(/\/$/, "");
    localStorage.setItem("steve.baseUrl", this.state.baseUrl);

    const isSelectedBackendEndpoint = this.state.baseUrl === this.getBackendEndpoint();
    if (!isSelectedBackendEndpoint) this.state.localLlamaConnected = false;

    this.setRuntimeState("idle", `Endpoint saved: ${this.state.baseUrl}`);
    this.schedulePersist();
  }

  async detectModels() {
    this.saveBaseUrl();
    try {
      const listed = await this.runtimeClient.fetchModels(this.state.baseUrl);
      if (!listed.length) throw new Error("No models returned");

      this.state.models = listed;
      if (!this.state.models.some((m) => m.id === this.state.selectedModel)) {
        this.state.selectedModel = this.state.models[0].id;
        localStorage.setItem("steve.model", this.state.selectedModel);
      }

      this.renderModels();
      this.syncModelLabel();

      const localHit = this.state.baseUrl === this.getBackendEndpoint();
      this.state.localLlamaConnected = localHit;
      this.setRuntimeState("ok", localHit ? `Connected ${this.getBackendLabel()}` : `Detected ${listed.length} model(s).`);
      this.schedulePersist();
    } catch (err) {
      this.state.localLlamaConnected = false;
      const msg = String(err?.message || "Unknown error");

      if (this.state.backend === "qvac" && /NetworkError|Failed to fetch|fetch/i.test(msg)) {
        this.setRuntimeState(
          "error",
          "Detect failed: qvac backend not reachable on 127.0.0.1:18081. Start qvac server first (set QVAC_LLAMA_BIN, then scripts/llama_cpp_local.sh start --backend qvac --index 1).",
        );
      } else {
        this.setRuntimeState("error", `Detect failed: ${msg}`);
      }
    }
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

    return normalized.slice(-24);
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
      this.appendMessage("steve", this.mockReplyForChat(chatId, text), {
        tps: simTps,
        energyMw: this.estimateAutoPowerMw({ text, tps: simTps, live: false }),
      }, chatId);
      this.setRuntimeState("idle", "UI Demo response generated.");
    }, delayMs);
  }

  async sendLive(text, chatId = this.state.activeChatId) {
    this.setRuntimeState("working", this.state.streamMode ? "Streaming response…" : "Waiting for live response…");

    const assistantIndex = this.appendMessage("steve", "", { pending: true }, chatId);
    const messages = this.buildRuntimeMessages(chatId);

    try {
      if (this.state.streamMode) {
        let streamedText = "";
        let chunkCount = 0;
        let liveTps = null;
        const startedAt = performance.now();

        const result = await this.runtimeClient.streamChat({
          baseUrl: this.state.baseUrl,
          model: this.state.selectedModel,
          messages,
          onToken: (token) => {
            streamedText += token;
            chunkCount += 1;
            const elapsedSec = Math.max(0.2, (performance.now() - startedAt) / 1000);
            liveTps = chunkCount / elapsedSec;

            this.patchMessage(chatId, assistantIndex, {
              text: streamedText,
              pending: true,
              error: false,
              tps: liveTps,
              energyMw: this.estimateAutoPowerMw({ text, tps: liveTps, live: true }),
            });
          },
        });

        if (!streamedText.trim()) {
          streamedText = "(empty reply)";
        }

        const finalTps = result?.tps ?? liveTps;
        this.patchMessage(chatId, assistantIndex, {
          text: streamedText,
          pending: false,
          error: false,
          tps: finalTps ?? null,
          energyMw: this.estimateAutoPowerMw({ text, tps: finalTps, live: true }),
        });

        this.speakText(streamedText);
        this.setRuntimeState("ok", "Live stream complete.");
        return;
      }

      const oneShot = await this.runtimeClient.completeOnce({
        baseUrl: this.state.baseUrl,
        model: this.state.selectedModel,
        messages,
        maxTokens: 300,
        temperature: 0.4,
      });

      this.patchMessage(chatId, assistantIndex, {
        text: oneShot.reply,
        pending: false,
        error: false,
        tps: oneShot.tps ?? null,
        energyMw: this.estimateAutoPowerMw({ text, tps: oneShot.tps, live: true }),
      });
      this.speakText(oneShot.reply);
      this.setRuntimeState("ok", "Live response complete.");
    } catch (err) {
      this.patchMessage(chatId, assistantIndex, {
        text: `Live call failed: ${err.message}`,
        pending: false,
        error: true,
      });
      this.setRuntimeState("error", `Live call failed: ${err.message}`);
    }
  }
}
