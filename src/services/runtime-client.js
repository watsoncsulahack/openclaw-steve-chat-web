export class RuntimeClient {
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async fetchLlamaRuntimeStatus(port) {
    const p = Number(port);
    if (!Number.isFinite(p) || p <= 0) return null;

    try {
      const res = await fetch(`http://127.0.0.1:8099/v0/llama_runtime_status?port=${p}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data?.data || null;
    } catch {
      return null;
    }
  }

  async fetchModels(baseUrl) {
    const res = await fetch(`${baseUrl}/v1/models`);
    if (!res.ok) throw await this.httpError(res);

    const data = await res.json();
    return (data?.data || [])
      .map((m) => ({ id: String(m.id), name: this.shortName(String(m.id)) }))
      .filter((m) => m.id);
  }

  async fetchModelsWithRetry(baseUrl, { timeoutMs = 45000, intervalMs = 900 } = {}) {
    const started = Date.now();
    let lastErr = null;

    while ((Date.now() - started) < timeoutMs) {
      try {
        const models = await this.fetchModels(baseUrl);
        if (models.length > 0) return models;
        lastErr = new Error("No models returned (runtime may still be loading)");
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || "");
        const transient = /HTTP\s*503|Loading model|No models returned|Failed to fetch|NetworkError|Empty reply/i.test(msg);
        if (!transient) throw err;
      }
      await this.sleep(intervalMs);
    }

    const suffix = lastErr?.message ? `: ${lastErr.message}` : "";
    throw new Error(`Runtime not ready on ${baseUrl}${suffix}`);
  }

  buildRequestBody({
    model,
    messages,
    maxTokens,
    temperature,
    topP,
    topK,
    minP,
    typicalP,
    repeatPenalty,
    stream = false,
    customJson = "",
  }) {
    const body = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      stream,
    };

    if (topK != null) body.top_k = topK;
    if (minP != null) body.min_p = minP;
    if (typicalP != null) body.typical_p = typicalP;
    if (repeatPenalty != null) body.repeat_penalty = repeatPenalty;

    const extra = String(customJson || "").trim();
    if (extra) {
      const parsed = JSON.parse(extra);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(body, parsed);
      }
    }

    return body;
  }

  async completeOnce({
    baseUrl,
    model,
    messages,
    maxTokens = 300,
    temperature = 0.4,
    topP = 0.95,
    topK = 40,
    minP = 0.05,
    typicalP = 1,
    repeatPenalty = 1,
    customJson = "",
  }) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.buildRequestBody({
        model,
        messages,
        maxTokens,
        temperature,
        topP,
        topK,
        minP,
        typicalP,
        repeatPenalty,
        stream: false,
        customJson,
      })),
    });

    if (!res.ok) throw await this.httpError(res);

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "(empty reply)";
    const tps = data?.timings?.predicted_per_second ?? data?.usage?.tokens_per_second ?? null;
    const promptTokens = data?.usage?.prompt_tokens ?? null;
    const completionTokens = data?.usage?.completion_tokens ?? null;
    const totalTokens = data?.usage?.total_tokens ?? null;
    return { reply, tps, promptTokens, completionTokens, totalTokens, raw: data };
  }

  async streamChat({
    baseUrl,
    model,
    messages,
    onToken,
    maxTokens = 300,
    temperature = 0.4,
    topP = 0.95,
    topK = 40,
    minP = 0.05,
    typicalP = 1,
    repeatPenalty = 1,
    customJson = "",
  }) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.buildRequestBody({
        model,
        messages,
        maxTokens,
        temperature,
        topP,
        topK,
        minP,
        typicalP,
        repeatPenalty,
        stream: true,
        customJson,
      })),
    });

    if (!res.ok) throw await this.httpError(res);
    if (!res.body) throw new Error("Streaming body unavailable");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalTps = null;
    let promptTokens = null;
    let completionTokens = null;
    let totalTokens = null;
    let tokenEvents = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const lines = event
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === "[DONE]") {
            return { tps: finalTps, promptTokens, completionTokens, totalTokens, tokenEvents };
          }

          let json;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }

          const token =
            json?.choices?.[0]?.delta?.content ??
            json?.choices?.[0]?.text ??
            "";

          if (token) {
            tokenEvents += 1;
            onToken?.(token);
          }

          const tps = json?.timings?.predicted_per_second ?? json?.usage?.tokens_per_second;
          if (tps != null) finalTps = tps;

          if (json?.usage) {
            if (json.usage.prompt_tokens != null) promptTokens = json.usage.prompt_tokens;
            if (json.usage.completion_tokens != null) completionTokens = json.usage.completion_tokens;
            if (json.usage.total_tokens != null) totalTokens = json.usage.total_tokens;
          }
        }
      }
    }

    return { tps: finalTps, promptTokens, completionTokens, totalTokens, tokenEvents };
  }

  async httpError(res) {
    let details = "";
    try {
      const text = await res.text();
      if (text) {
        try {
          const json = JSON.parse(text);
          details = json?.error?.message || json?.message || text;
        } catch {
          details = text;
        }
      }
    } catch {
      // ignore
    }

    details = String(details || "").replace(/\s+/g, " ").trim();
    const clipped = details ? `: ${details.slice(0, 180)}` : "";
    return new Error(`HTTP ${res.status}${clipped}`);
  }

  shortName(full) {
    const cleaned = full.split("/").pop() || full;
    return cleaned.replace(/\.gguf$/i, "");
  }
}
