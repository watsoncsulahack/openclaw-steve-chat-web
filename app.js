const state = {
  baseUrl: localStorage.getItem("steve.baseUrl") || "http://127.0.0.1:18080",
  liveMode: localStorage.getItem("steve.liveMode") === "1",
  sidebarCollapsed: localStorage.getItem("steve.sidebarCollapsed") === "1",
  mockMicOn: false,
  activeChatId: "steve",
  selectedModel: localStorage.getItem("steve.model") || "gemma-3n-e4b",
  chatFilter: "",
  models: [
    { id: "gemma-3n-e4b", name: "Gemma 3N E4B" },
    { id: "gemma-3n-e2b", name: "Gemma 3N E2B" },
  ],
  chats: [
    { id: "steve", title: "Steve", subtitle: "Main thread" },
    { id: "ops", title: "Ops Notes", subtitle: "Build + test" },
    { id: "ideas", title: "Feature Ideas", subtitle: "Voice + gestures" },
    { id: "bugs", title: "Bug Triage", subtitle: "Keyboard / viewport" },
    { id: "models", title: "Model Bench", subtitle: "E2B vs E4B" },
    { id: "ui", title: "UI Polish", subtitle: "Fold + portrait" },
    { id: "roadmap", title: "Roadmap", subtitle: "Phase checklist" },
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
  chatSearchWrap: $("chatSearchWrap"),
  chatSearchInput: $("chatSearchInput"),
  clearChatSearchBtn: $("clearChatSearchBtn"),
  newChatBtn: $("newChatBtn"),
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
  els.drawerCompactBtn.addEventListener("click", toggleSidebarCollapsed);

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
  renderChatSearchState();
  renderChats();
  renderSidebarRail();
  renderMessages();
  renderModels();
  syncModelLabel();
  renderModeUi();
}

function renderChatSearchState() {
  const hasText = (els.chatSearchInput.value || "").trim().length > 0;
  els.chatSearchWrap?.classList.toggle("has-text", hasText);
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
  state.chats.unshift({ id, title, subtitle: "Just now" });
  state.messages[id] = [{ role: "steve", text: "New thread ready." }];
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
  toggleDrawer(false);
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

  state.chats.slice(0, 8).forEach((chat) => {
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
  const items = state.chatFilter
    ? state.chats.filter((c) => `${c.title} ${c.subtitle}`.toLowerCase().includes(state.chatFilter))
    : state.chats;

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "chat-item";
    empty.textContent = "No chats match your search.";
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

    div.appendChild(row);
    div.addEventListener("click", () => switchChat(chat.id));
    els.chatList.appendChild(div);
  });
}

function renderMessages() {
  const messages = state.messages[state.activeChatId] || [];
  els.messages.innerHTML = "";

  messages.forEach((msg) => {
    const row = document.createElement("article");
    row.className = `msg-row ${msg.role}`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = msg.role === "user" ? "🙂" : "🤖";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = msg.text;

    row.appendChild(avatar);
    row.appendChild(bubble);
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

function appendMessage(role, text) {
  if (!state.messages[state.activeChatId]) {
    state.messages[state.activeChatId] = [];
  }
  state.messages[state.activeChatId].push({ role, text });
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
  appendMessage("user", text);

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
