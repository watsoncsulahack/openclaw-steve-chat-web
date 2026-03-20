const state = {
  baseUrl: localStorage.getItem("steve.baseUrl") || "http://127.0.0.1:18080",
  liveMode: localStorage.getItem("steve.liveMode") === "1",
  sidebarCollapsed: localStorage.getItem("steve.sidebarCollapsed") === "1",
  showArchived: false,
  replyTarget: null,
  mockMicOn: false,
  activeChatId: "steve",
  selectedModel: localStorage.getItem("steve.model") || "gemma-3n-e4b",
  chatFilter: "",
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

const $ = (id) => document.getElementById(id);
const WIDE_QUERY = "(min-width: 700px)";
const identiconCache = new Map();

const els = {
  appShell: document.querySelector(".app-shell"),
  drawer: $("drawer"),
  backdrop: $("backdrop"),
  messages: $("messages"),
  chatList: $("chatList"),
  chatListTitle: $("chatListTitle"),
  chatSearchWrap: $("chatSearchWrap"),
  chatSearchInput: $("chatSearchInput"),
  clearChatSearchBtn: $("clearChatSearchBtn"),
  newChatBtn: $("newChatBtn"),
  archivesBtn: $("archivesBtn"),
  drawerCompactBtn: $("drawerCompactBtn"),
  sidebarRail: $("sidebarRail"),
  modelList: $("modelList"),
  modelSheet: $("modelSheet"),
  settingsSheet: $("settingsSheet"),
  settingsBtn: $("settingsBtn"),
  currentModelLabel: $("currentModelLabel"),
  messageInput: $("messageInput"),
  baseUrlInput: $("baseUrlInput"),
  modeHint: $("modeHint"),
  mockModeBtn: $("mockModeBtn"),
  runtimeModeBtn: $("runtimeModeBtn"),
  statusDot: document.querySelector(".status-dot"),
  tpsBadge: $("tpsBadge"),
  micBtn: $("micBtn"),
  composer: document.querySelector(".composer"),
  replyBanner: $("replyBanner"),
  replyBannerText: $("replyBannerText"),
  clearReplyBtn: $("clearReplyBtn"),
  closeSettingsBtn: $("closeSettingsBtn"),
};

function init() {
  els.baseUrlInput.value = state.baseUrl;
  bindEvents();
  bindViewportFixes();
  syncViewport();
  renderAll();
  setTps(null);
}

function bindEvents() {
  $("menuBtn").addEventListener("click", () => toggleDrawer(true));
  $("closeDrawerBtn").addEventListener("click", () => toggleDrawer(false));
  els.backdrop.addEventListener("click", () => {
    toggleDrawer(false);
    toggleModelSheet(false);
    toggleSettingsSheet(false);
  });

  $("modelPickerBtn").addEventListener("click", () => toggleModelSheet(true));
  $("closeModelSheetBtn").addEventListener("click", () => toggleModelSheet(false));
  els.settingsBtn.addEventListener("click", () => toggleSettingsSheet(true));
  els.closeSettingsBtn.addEventListener("click", () => toggleSettingsSheet(false));

  $("saveBaseUrlBtn").addEventListener("click", saveBaseUrl);
  $("detectModelsBtn").addEventListener("click", detectModels);

  els.chatSearchInput.addEventListener("input", (e) => {
    state.chatFilter = (e.target.value || "").toLowerCase().trim();
    renderChatSearchState();
    renderChats();
  });

  els.clearChatSearchBtn.addEventListener("click", clearChatSearch);

  els.newChatBtn.addEventListener("click", createNewChat);
  els.archivesBtn.addEventListener("click", toggleArchivedView);
  els.drawerCompactBtn.addEventListener("click", toggleSidebarCollapsed);
  els.clearReplyBtn.addEventListener("click", clearReplyTarget);

  els.mockModeBtn.addEventListener("click", () => setMode(false));
  els.runtimeModeBtn.addEventListener("click", () => setMode(true));

  $("sendBtn").addEventListener("click", onSend);
  $("messageInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSend();
  });

  $("plusBtn").addEventListener("click", () => {
    alert("Hook for attachment/actions menu.");
  });

  els.micBtn.addEventListener("click", toggleMockMic);

  els.messageInput.addEventListener("focus", () => {
    window.setTimeout(ensureComposerVisible, 120);
  });
}

function bindViewportFixes() {
  window.addEventListener("resize", syncViewport, { passive: true });
  window.addEventListener("orientationchange", syncViewport, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncViewport, { passive: true });
    window.visualViewport.addEventListener("scroll", syncViewport, { passive: true });
  }
}

function isWide() {
  return window.matchMedia(WIDE_QUERY).matches;
}

function applySidebarLayoutState() {
  const wide = isWide();
  const collapsed = wide && state.sidebarCollapsed;
  els.appShell.classList.toggle("sidebar-collapsed", collapsed);
  els.drawerCompactBtn.textContent = collapsed ? "»" : "«";
  els.drawerCompactBtn.title = collapsed ? "Expand sidebar" : "Collapse to sidebar";
  els.settingsBtn.hidden = collapsed;
  els.archivesBtn.hidden = collapsed;
}

function toggleSidebarCollapsed() {
  if (!isWide()) return;
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem("steve.sidebarCollapsed", state.sidebarCollapsed ? "1" : "0");
  applySidebarLayoutState();
  renderSidebarRail();
}

function syncViewport() {
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  const top = vv ? vv.offsetTop : 0;

  document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
  document.documentElement.style.setProperty("--vv-top", `${Math.round(top)}px`);

  if (isWide()) {
    els.drawer.classList.add("open");
  }
  applySidebarLayoutState();
  syncBackdrop();
}

function ensureComposerVisible() {
  els.composer?.scrollIntoView({ block: "end", behavior: "auto" });
}

function toggleDrawer(open) {
  const wide = isWide();
  if (wide) {
    els.drawer.classList.add("open");
  } else {
    els.drawer.classList.toggle("open", open);
  }
  syncBackdrop();
}

function toggleModelSheet(open) {
  if (open) {
    els.settingsSheet.classList.remove("show");
  }
  els.modelSheet.classList.toggle("show", open);
  syncBackdrop();
}

function toggleSettingsSheet(open) {
  if (open) {
    els.modelSheet.classList.remove("show");
  }
  els.settingsSheet.classList.toggle("show", open);
  syncBackdrop();
}

function syncBackdrop() {
  const wide = isWide();
  const settingsOpen = els.settingsSheet.classList.contains("show");
  const show = settingsOpen || (!wide && (
    els.drawer.classList.contains("open") ||
    els.modelSheet.classList.contains("show")
  ));
  els.backdrop.classList.toggle("show", show);
  els.backdrop.classList.toggle("settings-dim", settingsOpen);
}

function renderAll() {
  applySidebarLayoutState();
  renderArchiveState();
  renderChatSearchState();
  renderChats();
  renderSidebarRail();
  renderMessages();
  renderReplyBanner();
  renderModels();
  syncModelLabel();
  renderModeUi();
}

function renderChatSearchState() {
  const hasText = (els.chatSearchInput.value || "").trim().length > 0;
  els.chatSearchWrap?.classList.toggle("has-text", hasText);
}

function renderArchiveState() {
  els.archivesBtn.classList.toggle("active", state.showArchived);
  els.archivesBtn.setAttribute("aria-pressed", String(state.showArchived));
  els.archivesBtn.title = state.showArchived ? "Showing archived chats (tap to return)" : "Show archived chats";
  if (els.chatListTitle) {
    els.chatListTitle.textContent = state.showArchived ? "Archived (tap 🗃 to return)" : "All chats";
  }
}

function toggleArchivedView() {
  state.showArchived = !state.showArchived;

  if (state.showArchived) {
    const firstArchived = state.chats.find((c) => c.archived);
    if (firstArchived) state.activeChatId = firstArchived.id;
  } else {
    const firstMain = state.chats.find((c) => !c.archived);
    if (firstMain) state.activeChatId = firstMain.id;
  }

  ensureActiveChatVisible();
  renderArchiveState();
  renderChats();
  renderSidebarRail();
  renderMessages();
  renderReplyBanner();
}

function getVisibleChats() {
  const filtered = state.showArchived
    ? state.chats.filter((c) => c.archived)
    : state.chats.filter((c) => !c.archived);

  if (!state.chatFilter) return filtered;
  return filtered.filter((c) => `${c.title} ${c.subtitle}`.toLowerCase().includes(state.chatFilter));
}

function clearChatSearch() {
  els.chatSearchInput.value = "";
  state.chatFilter = "";
  renderChatSearchState();
  renderChats();
  els.chatSearchInput.focus();
}

function createNewChat() {
  const id = `chat-${Date.now()}`;
  const title = `New chat ${state.chats.length - 1}`;
  state.chats.unshift({ id, title, subtitle: "Just now", archived: false });
  state.messages[id] = [{ role: "steve", text: "New thread ready." }];
  if (state.showArchived) {
    state.showArchived = false;
    renderArchiveState();
  }
  switchChat(id);
  state.chatFilter = "";
  if (els.chatSearchInput) els.chatSearchInput.value = "";
  renderChatSearchState();
  renderChats();
  renderSidebarRail();
  renderMessages();
}

function switchChat(chatId) {
  state.activeChatId = chatId;
  renderChats();
  renderSidebarRail();
  renderMessages();
  renderReplyBanner();
  toggleDrawer(false);
}

function ensureActiveChatVisible() {
  const visible = state.showArchived
    ? state.chats.filter((c) => c.archived)
    : state.chats.filter((c) => !c.archived);

  if (visible.find((c) => c.id === state.activeChatId)) return;

  if (state.showArchived) {
    // In archive view, allow empty list without forcing chat creation.
    if (visible[0]) state.activeChatId = visible[0].id;
    return;
  }

  const firstUnarchived = state.chats.find((c) => !c.archived);
  if (firstUnarchived) {
    state.activeChatId = firstUnarchived.id;
    return;
  }

  if (state.chats[0]) {
    state.activeChatId = state.chats[0].id;
  }
}

function renderSidebarRail() {
  if (!els.sidebarRail) return;
  els.sidebarRail.innerHTML = "";

  const newBtn = document.createElement("button");
  newBtn.className = "rail-btn rail-action";
  newBtn.textContent = "+";
  newBtn.title = "New chat";
  newBtn.addEventListener("click", createNewChat);
  els.sidebarRail.appendChild(newBtn);

  const settingsRailBtn = document.createElement("button");
  settingsRailBtn.className = "rail-btn rail-action";
  settingsRailBtn.textContent = "⚙";
  settingsRailBtn.title = "Settings";
  settingsRailBtn.addEventListener("click", () => toggleSettingsSheet(true));
  els.sidebarRail.appendChild(settingsRailBtn);

  const archiveRailBtn = document.createElement("button");
  archiveRailBtn.className = `rail-btn rail-action ${state.showArchived ? "active" : ""}`;
  archiveRailBtn.textContent = "🗄";
  archiveRailBtn.title = "Archives";
  archiveRailBtn.addEventListener("click", toggleArchivedView);
  els.sidebarRail.appendChild(archiveRailBtn);

  getVisibleChats().slice(0, 8).forEach((chat) => {
    const b = document.createElement("button");
    b.className = `rail-btn ${chat.id === state.activeChatId ? "active" : ""}`;
    b.title = chat.title;
    paintIdenticon(b, chat.id, 48, 14);
    b.addEventListener("click", () => switchChat(chat.id));
    els.sidebarRail.appendChild(b);
  });
}

function renderChats() {
  els.chatList.innerHTML = "";
  const items = getVisibleChats();

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "chat-item";
    empty.textContent = state.showArchived ? "No archived chats." : "No chats match your search.";
    els.chatList.appendChild(empty);
    return;
  }

  items.forEach((chat) => {
    const div = document.createElement("div");
    div.className = `chat-item ${chat.id === state.activeChatId ? "active" : ""}`;

    const icon = document.createElement("div");
    icon.className = "chat-identicon";
    paintIdenticon(icon, chat.id, 30, 8);

    const text = document.createElement("div");
    text.innerHTML = `<strong>${chat.title}</strong><br /><small>${chat.subtitle}</small>`;

    const row = document.createElement("div");
    row.className = "chat-item-inner";
    row.appendChild(icon);
    row.appendChild(text);

    const cueRight = document.createElement("div");
    cueRight.className = "swipe-cue swipe-cue-right";
    cueRight.textContent = "↳ Archive";

    const cueLeft = document.createElement("div");
    cueLeft.className = "swipe-cue swipe-cue-left";
    cueLeft.textContent = "Delete 🗑";

    div.appendChild(cueRight);
    div.appendChild(cueLeft);
    div.appendChild(row);

    bindSwipeAction(div, {
      onLeft: () => deleteChat(chat.id),
      onRight: () => toggleArchiveChat(chat.id),
      previewClassRight: "swipe-preview-right",
      previewClassLeft: "swipe-preview-left",
      threshold: 96,
    });

    div.addEventListener("click", () => switchChat(chat.id));

    els.chatList.appendChild(div);
  });
}

function bindSwipeAction(el, {
  onLeft,
  onRight,
  threshold = 72,
  previewClassRight,
  previewClassLeft,
}) {
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let dy = 0;
  let active = false;
  let dragAxis = "none";

  const resetVisual = () => {
    el.style.transition = "transform 140ms ease, opacity 140ms ease";
    el.style.transform = "translateX(0)";
    el.style.opacity = "1";
    if (previewClassRight) el.classList.remove(previewClassRight);
    if (previewClassLeft) el.classList.remove(previewClassLeft);
  };

  const start = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    active = true;
    dragAxis = "none";
    sx = e.clientX;
    sy = e.clientY;
    dx = 0;
    dy = 0;
    el.style.transition = "none";
  };

  const move = (e) => {
    if (!active) return;
    dx = e.clientX - sx;
    dy = e.clientY - sy;

    if (dragAxis === "none") {
      if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.35) {
        dragAxis = "x";
      } else {
        dragAxis = "y";
        active = false;
        resetVisual();
        return;
      }
    }

    if (dragAxis !== "x") return;

    const clamped = Math.max(-108, Math.min(108, dx));
    el.style.transform = `translateX(${clamped}px)`;
    el.style.opacity = "0.92";

    if (previewClassRight || previewClassLeft) {
      const dir = clamped > 26 ? "right" : clamped < -26 ? "left" : "none";
      if (previewClassRight) el.classList.toggle(previewClassRight, dir === "right");
      if (previewClassLeft) el.classList.toggle(previewClassLeft, dir === "left");
    }
  };

  const finish = (shouldTrigger) => {
    if (!active && dragAxis === "none") return;

    const finalDx = dx;
    const horizontalDrag = dragAxis === "x";

    active = false;
    dragAxis = "none";
    sx = 0;
    sy = 0;
    dx = 0;
    dy = 0;

    resetVisual();

    if (!shouldTrigger || !horizontalDrag) return;
    if (Math.abs(finalDx) < threshold) return;

    if (finalDx > 0) onRight?.();
    else onLeft?.();
  };

  el.addEventListener("pointerdown", start);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", () => finish(true));
  el.addEventListener("pointercancel", () => finish(false));
  el.addEventListener("lostpointercapture", () => finish(false));
}

function deleteChat(chatId) {
  state.chats = state.chats.filter((c) => c.id !== chatId);
  delete state.messages[chatId];
  if (state.replyTarget?.chatId === chatId) {
    clearReplyTarget();
  }
  ensureActiveChatVisible();
  renderChats();
  renderSidebarRail();
  renderMessages();
}

function toggleArchiveChat(chatId) {
  const chat = state.chats.find((c) => c.id === chatId);
  if (!chat) return;
  chat.archived = !chat.archived;
  if (chat.id === state.activeChatId && chat.archived && !state.showArchived) {
    ensureActiveChatVisible();
  }
  renderChats();
  renderSidebarRail();
  renderMessages();
}

function setReplyTarget(messageIndex, msg) {
  state.replyTarget = {
    chatId: state.activeChatId,
    index: messageIndex,
    text: msg.text,
    role: msg.role,
  };
  renderReplyBanner();
}

function clearReplyTarget() {
  state.replyTarget = null;
  renderReplyBanner();
}

function renderReplyBanner() {
  const t = state.replyTarget;
  if (!t || t.chatId !== state.activeChatId) {
    els.replyBanner.classList.add("hidden");
    els.replyBannerText.textContent = "";
    return;
  }

  els.replyBanner.classList.remove("hidden");
  const snippet = (t.text || "").replace(/\s+/g, " ").slice(0, 80);
  els.replyBannerText.textContent = `Replying to ${t.role}: ${snippet}`;
}

function renderMessages() {
  const messages = state.messages[state.activeChatId] || [];
  els.messages.innerHTML = "";

  messages.forEach((msg, idx) => {
    const row = document.createElement("article");
    row.className = `msg-row ${msg.role}`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = msg.role === "user" ? "🙂" : "🤖";

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (msg.replyTo?.text) {
      const reply = document.createElement("div");
      reply.className = "bubble-reply";
      reply.textContent = `${msg.replyTo.role}: ${msg.replyTo.text}`;
      bubble.appendChild(reply);
    }

    const body = document.createElement("div");
    body.textContent = msg.text;
    bubble.appendChild(body);

    row.appendChild(avatar);
    row.appendChild(bubble);

    const cue = document.createElement("div");
    cue.className = "msg-swipe-cue";
    cue.textContent = "↩ Reply";
    row.appendChild(cue);

    bindSwipeAction(row, {
      onRight: () => setReplyTarget(idx, msg),
      threshold: 88,
      previewClassRight: "swipe-preview-right",
    });

    els.messages.appendChild(row);
  });

  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderModels() {
  els.modelList.innerHTML = "";
  state.models.forEach((model) => {
    const btn = document.createElement("button");
    btn.className = `model-item ${model.id === state.selectedModel ? "active" : ""}`;
    btn.textContent = model.name;
    btn.addEventListener("click", () => {
      state.selectedModel = model.id;
      localStorage.setItem("steve.model", model.id);
      syncModelLabel();
      renderModels();
      toggleModelSheet(false);
    });
    els.modelList.appendChild(btn);
  });
}

function syncModelLabel() {
  const model = state.models.find((m) => m.id === state.selectedModel);
  els.currentModelLabel.textContent = model?.name || state.selectedModel;
}

function setMode(live) {
  state.liveMode = live;
  localStorage.setItem("steve.liveMode", state.liveMode ? "1" : "0");
  setTps(null);
  renderModeUi();
}

function renderModeUi() {
  els.mockModeBtn.classList.toggle("active", !state.liveMode);
  els.runtimeModeBtn.classList.toggle("active", state.liveMode);
  els.modeHint.textContent = state.liveMode
    ? "Local Runtime mode sends prompts to your selected /v1/chat/completions model endpoint."
    : "UI Demo mode uses mock Steve replies for flow testing.";
  if (els.statusDot) {
    els.statusDot.style.background = state.liveMode ? "#3ad06b" : "#6d7cb4";
  }
}

async function sha256Bytes(text) {
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf));
  }

  // fallback (non-cryptographic) for older environments
  let h = 2166136261;
  const out = new Array(32).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
    out[i % 32] = (out[i % 32] + (h >>> ((i % 4) * 8))) & 255;
  }
  return out;
}

async function identiconSvg(seed, size = 42, radius = 10) {
  const bytes = await sha256Bytes(seed);

  // More expressive (still readable) hash palette.
  const hue = Math.round((bytes[0] / 255) * 360);
  const hue2 = (hue + 170 + (bytes[1] % 60)) % 360;
  const fg = `hsl(${hue} ${62 + (bytes[2] % 18)}% ${56 + (bytes[3] % 10)}%)`;
  const bg = `hsl(${hue2} ${34 + (bytes[4] % 14)}% ${14 + (bytes[5] % 7)}%)`;

  const n = 5;
  const pad = Math.max(2, Math.floor(size * 0.12));
  const usable = size - pad * 2;
  const cell = usable / n;
  const offsetX = (size - cell * n) / 2;
  const offsetY = offsetX;

  let rects = "";
  let bit = 0;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < Math.ceil(n / 2); x += 1) {
      const on = ((bytes[6 + (bit % 24)] >> (bit % 8)) & 1) === 1;
      bit += 1;
      if (!on) continue;

      const x1 = offsetX + x * cell;
      const xm = offsetX + (n - 1 - x) * cell;
      const y1 = offsetY + y * cell;
      rects += `<rect x="${x1.toFixed(2)}" y="${y1.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${fg}" rx="1.2"/>`;
      if (xm !== x1) {
        rects += `<rect x="${xm.toFixed(2)}" y="${y1.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${fg}" rx="1.2"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>${rects}</svg>`;
}

function paintIdenticon(el, seed, size = 42, radius = 10) {
  const key = `${seed}:${size}:${radius}`;
  const cached = identiconCache.get(key);
  if (cached) {
    el.style.backgroundImage = `url("${cached}")`;
    return;
  }

  identiconSvg(seed, size, radius)
    .then((svg) => {
      const data = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
      identiconCache.set(key, data);
      el.style.backgroundImage = `url("${data}")`;
    })
    .catch(() => {
      el.style.backgroundImage = "none";
    });
}

function toggleMockMic() {
  state.mockMicOn = !state.mockMicOn;
  els.micBtn.classList.toggle("active", state.mockMicOn);
  els.micBtn.setAttribute("aria-pressed", String(state.mockMicOn));
  els.modeHint.textContent = state.mockMicOn
    ? "Mock mic armed (wireframe only)."
    : state.liveMode
      ? "Local Runtime mode sends prompts to your selected /v1/chat/completions model endpoint."
      : "UI Demo mode uses mock Steve replies for flow testing.";
}

function saveBaseUrl() {
  state.baseUrl = (els.baseUrlInput.value || "").trim().replace(/\/$/, "");
  localStorage.setItem("steve.baseUrl", state.baseUrl);
  els.modeHint.textContent = `Endpoint saved: ${state.baseUrl}`;
}

async function detectModels() {
  saveBaseUrl();
  try {
    const res = await fetch(`${state.baseUrl}/v1/models`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const listed = (data?.data || [])
      .map((m) => ({ id: String(m.id), name: shortName(String(m.id)) }))
      .filter((m) => m.id);

    if (!listed.length) throw new Error("No models returned");

    state.models = listed;
    if (!state.models.some((m) => m.id === state.selectedModel)) {
      state.selectedModel = state.models[0].id;
      localStorage.setItem("steve.model", state.selectedModel);
    }

    renderModels();
    syncModelLabel();
    els.modeHint.textContent = `Detected ${listed.length} model(s).`;
  } catch (err) {
    els.modeHint.textContent = `Detect failed: ${err.message}`;
  }
}

function shortName(full) {
  const cleaned = full.split("/").pop() || full;
  return cleaned.replace(/\.gguf$/i, "");
}

function appendMessage(role, text, options = {}) {
  if (!state.messages[state.activeChatId]) {
    state.messages[state.activeChatId] = [];
  }
  state.messages[state.activeChatId].push({ role, text, ...options });
  renderMessages();
}

function setTps(value, isLive = false) {
  if (!els.tpsBadge) return;
  if (value == null || Number.isNaN(Number(value))) {
    els.tpsBadge.textContent = "TPS: --";
    return;
  }
  const n = Number(value);
  const fixed = n >= 10 ? n.toFixed(0) : n.toFixed(1);
  els.tpsBadge.textContent = `${isLive ? "LIVE" : "SIM"} TPS ${fixed}`;
}

function mockReplyForChat(chatId, userText) {
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

async function onSend() {
  const text = (els.messageInput.value || "").trim();
  if (!text) return;
  els.messageInput.value = "";

  const replyTo = state.replyTarget?.chatId === state.activeChatId
    ? { role: state.replyTarget.role, text: state.replyTarget.text }
    : null;

  appendMessage("user", text, replyTo ? { replyTo } : {});
  clearReplyTarget();

  setTps(null);

  if (state.liveMode) {
    await sendLive(text);
    return;
  }

  const delayMs = 220 + Math.floor(Math.random() * 700);
  const simTps = 9 + Math.random() * 22;

  window.setTimeout(() => {
    appendMessage("steve", mockReplyForChat(state.activeChatId, text));
    setTps(simTps, false);
  }, delayMs);
}

async function sendLive(text) {
  try {
    const res = await fetch(`${state.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: state.selectedModel,
        messages: [{ role: "user", content: text }],
        max_tokens: 120,
        temperature: 0.4,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "(empty reply)";
    const tps = data?.timings?.predicted_per_second ?? data?.usage?.tokens_per_second ?? null;
    appendMessage("steve", reply);
    setTps(tps, true);
  } catch (err) {
    const simTps = 8 + Math.random() * 20;
    appendMessage("steve", `Live call failed: ${err.message}`);
    appendMessage("steve", `[Simulated fallback] ${mockReplyForChat(state.activeChatId, text)}`);
    setTps(simTps, false);
  }
}

init();
