export class RuntimeClient {
  async fetchModels(baseUrl) {
    const res = await fetch(`${baseUrl}/v1/models`);
    if (!res.ok) throw await this.httpError(res);

    const data = await res.json();
    return (data?.data || [])
      .map((m) => ({ id: String(m.id), name: this.shortName(String(m.id)) }))
      .filter((m) => m.id);
  }

  async completeOnce({ baseUrl, model, messages, maxTokens = 300, temperature = 0.4 }) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!res.ok) throw await this.httpError(res);

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "(empty reply)";
    const tps = data?.timings?.predicted_per_second ?? data?.usage?.tokens_per_second ?? null;
    return { reply, tps, raw: data };
  }

  async streamChat({
    baseUrl,
    model,
    messages,
    onToken,
    maxTokens = 300,
    temperature = 0.4,
  }) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!res.ok) throw await this.httpError(res);
    if (!res.body) throw new Error("Streaming body unavailable");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalTps = null;

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
          if (payload === "[DONE]") return { tps: finalTps };

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

          if (token) onToken?.(token);

          const tps = json?.timings?.predicted_per_second ?? json?.usage?.tokens_per_second;
          if (tps != null) finalTps = tps;
        }
      }
    }

    return { tps: finalTps };
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
