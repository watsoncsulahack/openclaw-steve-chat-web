export class StorageService {
  constructor(key = "steve.state.v2") {
    this.key = key;
  }

  load(defaultState) {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return defaultState;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return defaultState;

      const merged = {
        ...defaultState,
        ...this.pickScalars(data),
      };

      if (Array.isArray(data.models) && data.models.length) merged.models = data.models;
      if (Array.isArray(data.chats) && data.chats.length) merged.chats = data.chats;
      if (data.messages && typeof data.messages === "object") merged.messages = data.messages;

      if (!merged.chats.some((c) => c.id === merged.activeChatId)) {
        merged.activeChatId = merged.chats[0]?.id || defaultState.activeChatId;
      }

      return merged;
    } catch {
      return defaultState;
    }
  }

  save(state) {
    const snapshot = {
      backend: state.backend,
      baseUrl: state.baseUrl,
      liveMode: state.liveMode,
      sidebarCollapsed: state.sidebarCollapsed,
      theme: state.theme,
      showArchived: state.showArchived,
      activeChatId: state.activeChatId,
      selectedModel: state.selectedModel,
      chatFilter: state.chatFilter,
      streamMode: state.streamMode,
      ttsEnabled: state.ttsEnabled,
      runtimeState: state.runtimeState,
      runtimeStatusText: state.runtimeStatusText,
      localLlamaConnected: state.localLlamaConnected,
      models: state.models,
      chats: state.chats,
      messages: state.messages,
    };

    localStorage.setItem(this.key, JSON.stringify(snapshot));
  }

  pickScalars(data) {
    const out = {};
    const keys = [
      "backend",
      "baseUrl",
      "liveMode",
      "sidebarCollapsed",
      "theme",
      "showArchived",
      "replyTarget",
      "mockMicOn",
      "activeChatId",
      "selectedModel",
      "chatFilter",
      "streamMode",
      "ttsEnabled",
      "runtimeState",
      "runtimeStatusText",
      "localLlamaConnected",
    ];

    keys.forEach((k) => {
      if (k in data) out[k] = data[k];
    });

    return out;
  }
}
