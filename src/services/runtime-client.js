export class RuntimeClient {
  sleep(ms, signal = null) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };
      const cleanup = () => signal?.removeEventListener?.("abort", onAbort);
      signal?.addEventListener?.("abort", onAbort, { once: true });
    });
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

  async fetchModels(baseUrl, { signal = null, requestTimeoutMs = 3500 } = {}) {
    const controller = new AbortController();
    const timeout = Math.max(800, Number(requestTimeoutMs) || 3500);
    const timer = setTimeout(() => controller.abort(), timeout);

    const onAbort = () => controller.abort();
    signal?.addEventListener?.("abort", onAbort, { once: true });

    let res;
    try {
      res = await fetch(`${baseUrl}/v1/models`, { signal: controller.signal });
    } catch (err) {
      const abortedByCaller = Boolean(signal?.aborted);
      if (err?.name === "AbortError" && !abortedByCaller) {
        throw new Error(`Model list request timeout (${timeout}ms)`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }

    if (!res.ok) throw await this.httpError(res);

    const data = await res.json();
    const openaiList = Array.isArray(data?.data) ? data.data : [];
    const legacyList = Array.isArray(data?.models) ? data.models : [];

    const mapped = [
      ...openaiList.map((m) => ({ id: String(m?.id || ""), name: this.shortName(String(m?.id || "")) })),
      ...legacyList.map((m) => {
        const id = String(m?.model || m?.name || "");
        return { id, name: this.shortName(id) };
      }),
    ];

    const dedup = [];
    const seen = new Set();
    for (const item of mapped) {
      if (!item?.id) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      dedup.push(item);
    }

    return dedup;
  }

  async fetchModelsWithRetry(baseUrl, { timeoutMs = 45000, intervalMs = 900, requestTimeoutMs = 3500, signal = null } = {}) {
    const started = Date.now();
    let lastErr = null;

    while ((Date.now() - started) < timeoutMs) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const models = await this.fetchModels(baseUrl, { signal, requestTimeoutMs });
        if (models.length > 0) return models;
        lastErr = new Error("No models returned (runtime may still be loading)");
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || "");
        const transient = /HTTP\s*503|Loading model|No models returned|Failed to fetch|NetworkError|Empty reply/i.test(msg);
        if (!transient) throw err;
      }
      await this.sleep(intervalMs, signal);
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
    reasoningEnabled = true,
  }) {
    const body = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      stream,
      // Stability-first default on mobile: avoid stale prefix cache interactions
      // across rapid model switches and aborted runs.
      cache_prompt: false,
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

    const kwargs = (body.chat_template_kwargs && typeof body.chat_template_kwargs === "object" && !Array.isArray(body.chat_template_kwargs))
      ? { ...body.chat_template_kwargs }
      : {};
    kwargs.enable_thinking = Boolean(reasoningEnabled);
    body.chat_template_kwargs = kwargs;

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
    reasoningEnabled = true,
    signal = null,
  }) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
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
        reasoningEnabled,
      })),
    });

    if (!res.ok) throw await this.httpError(res);

    const data = await res.json();
    const message = data?.choices?.[0]?.message || {};
    const content = String(message?.content || "").trim();
    const reasoning = String(message?.reasoning_content ?? message?.thinking ?? "").trim();
    const reply = content || "(empty reply)";
    const tps = data?.timings?.predicted_per_second ?? data?.usage?.tokens_per_second ?? null;
    const promptTokens = data?.usage?.prompt_tokens ?? null;
    const completionTokens = data?.usage?.completion_tokens ?? null;
    const totalTokens = data?.usage?.total_tokens ?? null;
    return { reply, content, reasoning, tps, promptTokens, completionTokens, totalTokens, raw: data };
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
    reasoningEnabled = true,
    signal = null,
  }) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
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
        reasoningEnabled,
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

    const throwIfAborted = () => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    };

    const onAbort = async () => {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });

    try {
      while (true) {
        throwIfAborted();
        const { done, value } = await reader.read();
        throwIfAborted();
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
            throwIfAborted();
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

            const contentToken =
              json?.choices?.[0]?.delta?.content ??
              json?.choices?.[0]?.text ??
              "";
            const reasoningToken =
              json?.choices?.[0]?.delta?.reasoning_content ??
              json?.choices?.[0]?.delta?.thinking ??
              "";

            if (contentToken || reasoningToken) {
              tokenEvents += 1;
              onToken?.({
                content: contentToken,
                reasoning: reasoningToken,
                text: contentToken || reasoningToken,
              });
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
    } finally {
      signal?.removeEventListener?.("abort", onAbort);
    }
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

  async switchLocalRuntime({ target, modelIndex = 1, siteId = "steve-chat", timeoutMs = 45000 }) {
    const controller = new AbortController();
    const timeout = Math.max(5000, Number(timeoutMs) || 45000);
    const timer = setTimeout(() => controller.abort(), timeout);

    let res;
    try {
      res = await fetch("http://127.0.0.1:8099/v0/llama_runtime_switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: siteId, target, modelIndex }),
        signal: controller.signal,
      });
    } catch (err) {
      const guessedPort = String(target || "").startsWith("reg") ? 18080 : 18084;
      const guessedEndpoint = `http://127.0.0.1:${guessedPort}`;
      const fetchLike = /Failed to fetch|NetworkError|fetch|ECONN|connection/i.test(String(err?.message || ""));
      const shouldProbeFallback = err?.name === "AbortError" || fetchLike;

      if (shouldProbeFallback) {
        // Fallback: supervisor request may timeout/fail while runtime still starts in background.
        try {
          await this.fetchModelsWithRetry(guessedEndpoint, {
            timeoutMs: 18000,
            intervalMs: 700,
            requestTimeoutMs: 2500,
          });
          return {
            siteId,
            target,
            modelIndex,
            endpoint: guessedEndpoint,
            port: guessedPort,
            recoveredAfterTimeout: err?.name === "AbortError",
            recoveredAfterFetchError: fetchLike,
          };
        } catch {
          if (err?.name === "AbortError") {
            throw new Error(`Runtime switch timed out after ${timeout}ms`);
          }
          throw err;
        }
      }

      throw err;
    } finally {
      clearTimeout(timer);
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok || !payload?.ok) {
      const msg = payload?.error?.message || `Runtime switch failed (HTTP ${res.status})`;
      throw new Error(msg);
    }

    return payload.data || null;
  }

  shortName(full) {
    const cleaned = full.split("/").pop() || full;
    return cleaned.replace(/\.gguf$/i, "");
  }
}
