import { apiFetch } from "../shared/apiClient.js";

async function readPayload(response) {
  const type = response.headers?.get?.("content-type") || "";
  if (type.includes("application/json")) {
    try { return await response.json(); } catch (_) { return {}; }
  }
  return { message: await response.text() };
}

async function requestJson(url, options = {}) {
  const response = await apiFetch(url, { ...options, handleHttpErrors: false });
  const payload = await readPayload(response);
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || "Yêu cầu trợ lý thất bại.");
    error.code = payload?.code || "AI_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const assistantApi = {
  getConfig() { return requestJson("/api/ai/config", { method: "GET", timeoutMs: 10000, retries: 0 }); },
  listConversations() { return requestJson("/api/ai/conversations", { method: "GET", timeoutMs: 15000, retries: 0 }); },
  createConversation(mode) { return requestJson("/api/ai/conversations", { method: "POST", body: JSON.stringify({ mode }), headers: { "Content-Type": "application/json" }, timeoutMs: 15000, retries: 0 }); },
  getConversation(id) { return requestJson(`/api/ai/conversations/${encodeURIComponent(id)}`, { method: "GET", timeoutMs: 15000, retries: 0 }); },
  listMessages(id, { limit = 40, offset = 0 } = {}) { return requestJson(`/api/ai/conversations/${encodeURIComponent(id)}/messages?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`, { method: "GET", timeoutMs: 15000, retries: 0 }); },
  deleteConversation(id) { return requestJson(`/api/ai/conversations/${encodeURIComponent(id)}`, { method: "DELETE", timeoutMs: 15000, retries: 0 }); },
  getSuggestedQuestions(route) { return requestJson(`/api/ai/suggested-questions?route=${encodeURIComponent(route || "/")}`, { method: "GET", timeoutMs: 10000, retries: 0 }); },
  sendMessage(id, content, signal) {
    return apiFetch(`/api/ai/conversations/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      timeoutMs: 120000,
      retries: 0,
      handleHttpErrors: false,
      signal
    });
  },
  feedback(messageId, rating, category = "other", comment = null) {
    return requestJson("/api/ai/feedback", { method: "POST", body: JSON.stringify({ messageId, rating, category, comment }), headers: { "Content-Type": "application/json" }, timeoutMs: 15000, retries: 0 });
  }
};

export async function consumeAssistantStream(response, onEvent, signal) {
  if (!response.ok) {
    const payload = await readPayload(response);
    const error = new Error(payload?.message || payload?.error || "Không thể kết nối trợ lý.");
    error.code = payload?.code || "AI_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  if (!response.body?.getReader) throw new Error("Trình duyệt không hỗ trợ streaming trợ lý.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const dispatch = (block) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    try { onEvent(JSON.parse(data)); } catch (_) { /* Ignore malformed provider data. */ }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    blocks.forEach(dispatch);
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }
  }
  if (buffer) dispatch(buffer);
}
