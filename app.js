const state = {
  baseUrl: localStorage.getItem("steve.baseUrl") || "http://127.0.0.1:18080",
  liveMode: localStorage.getItem("steve.liveMode") === "1",
  mockMicOn: false,
  activeChatId: "steve",
  selectedModel: localStorage.getItem("steve.model") || "gemma-3n-e4b",
  models: [
    { id: "gemma-3n-e4b", name: "Gemma 3N E4B" },
    { id: "gemma-3n-e2b", name: "Gemma 3N E2B" },
  ],
  chats: [
    { id: "steve", title: "Steve", subtitle: "Main thread" },
    { id: "ops", title: "Ops Notes", subtitle: "Build + test" },
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
const els = {
  drawer: $("drawer"),
  backdrop: $("backdrop"),
  messages: $("messages"),
  chatList: $("chatList"),
  modelList: $("modelList"),
  modelSheet: $("modelSheet"),
  currentModelLabel: $("currentModelLabel"),
  messageInput: $("messageInput"),
  baseUrlInput: $("baseUrlInput"),
  modeHint: $("modeHint"),
  mockModeBtn: $("mockModeBtn"),
  runtimeModeBtn: $("runtimeModeBtn"),
  statusDot: document.querySelector(".status-dot"),
  micBtn: $("micBtn"),
  composer: document.querySelector(".composer"),
};

function init() {
  els.baseUrlInput.value = state.baseUrl;
  bindEvents();
  bindViewportFixes();
  syncViewport();
  renderAll();
}

function bindEvents() {
  $("menuBtn").addEventListener("click", () => toggleDrawer(true));
  $("closeDrawerBtn").addEventListener("click", () => toggleDrawer(false));
  els.backdrop.addEventListener("click", () => {
    toggleDrawer(false);
    toggleModelSheet(false);
  });

  $("modelPickerBtn").addEventListener("click", () => toggleModelSheet(true));
  $("closeModelSheetBtn").addEventListener("click", () => toggleModelSheet(false));

  $("saveBaseUrlBtn").addEventListener("click", saveBaseUrl);
  $("detectModelsBtn").addEventListener("click", detectModels);

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

function syncViewport() {
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  const top = vv ? vv.offsetTop : 0;

  document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
  document.documentElement.style.setProperty("--vv-top", `${Math.round(top)}px`);
}

function ensureComposerVisible() {
  els.composer?.scrollIntoView({ block: "end", behavior: "auto" });
}

function toggleDrawer(open) {
  els.drawer.classList.toggle("open", open);
  syncBackdrop();
}

function toggleModelSheet(open) {
  els.modelSheet.classList.toggle("show", open);
  syncBackdrop();
}

function syncBackdrop() {
  const show = els.drawer.classList.contains("open") || els.modelSheet.classList.contains("show");
  els.backdrop.classList.toggle("show", show);
}

function renderAll() {
  renderChats();
  renderMessages();
  renderModels();
  syncModelLabel();
  renderModeUi();
}

function renderChats() {
  els.chatList.innerHTML = "";
  state.chats.forEach((chat) => {
    const div = document.createElement("div");
    div.className = `chat-item ${chat.id === state.activeChatId ? "active" : ""}`;
    div.innerHTML = `<strong>${chat.title}</strong><br /><small>${chat.subtitle}</small>`;
    div.addEventListener("click", () => {
      state.activeChatId = chat.id;
      renderChats();
      renderMessages();
      toggleDrawer(false);
    });
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

async function onSend() {
  const text = (els.messageInput.value || "").trim();
  if (!text) return;
  els.messageInput.value = "";
  appendMessage("user", text);

  if (state.liveMode) {
    await sendLive(text);
    return;
  }

  window.setTimeout(() => {
    appendMessage("steve", `UI mock reply: got “${text}”.\n(Enable live mode when ready.)`);
  }, 280);
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
    appendMessage("steve", reply);
  } catch (err) {
    appendMessage("steve", `Live call failed: ${err.message}`);
  }
}

init();
