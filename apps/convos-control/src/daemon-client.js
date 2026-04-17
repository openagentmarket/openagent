export class OpenAgentDaemonClient {
  constructor(options) {
    this.baseUrl = String(options.baseUrl || "").replace(/\/+$/, "");
    this.token = String(options.token || "").trim();
    this.cwd = String(options.cwd || "").trim();
    this.runtimeConfig = options.runtimeConfig || {};
  }

  async getHealth() {
    return this.request("GET", "/health");
  }

  async getTask(taskId) {
    return this.request("GET", `/tasks/${encodeURIComponent(taskId)}`);
  }

  async getConversationBinding(conversationId) {
    return this.request("GET", `/channels/xmtp/${encodeURIComponent(conversationId)}`);
  }

  async ensureConversationTask(conversationId, options = {}) {
    return this.request("POST", `/channels/xmtp/${encodeURIComponent(conversationId)}/task`, {
      cwd: options.cwd || this.cwd,
      title: options.title || "",
      forceNewTask: options.forceNewTask === true,
      runtimeConfig: options.runtimeConfig || this.runtimeConfig,
    });
  }

  async interruptTask(taskId) {
    return this.request("POST", `/tasks/${encodeURIComponent(taskId)}/interrupt`, {});
  }

  async sendMessage(taskId, text) {
    return this.request("POST", `/tasks/${encodeURIComponent(taskId)}/messages`, {
      text,
      runtimeConfig: this.runtimeConfig,
    });
  }

  async waitForTaskCompletion(taskId, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    const startedAt = Date.now();

    while (true) {
      const result = await this.getTask(taskId);
      const task = result.task;
      const status = String(task?.status || "");
      if (status === "idle") {
        return result;
      }
      if (status === "error") {
        throw new Error(String(task?.lastError || "OpenAgent task failed."));
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error("Timed out waiting for OpenAgent to finish the run.");
      }
      await delay(pollIntervalMs);
    }
  }

  async request(method, pathname, body) {
    if (!this.baseUrl) {
      throw new Error("OpenAgent daemon URL is not configured.");
    }

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-openagent-token": this.token,
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(payload?.error?.message || `OpenAgent request failed with ${response.status}.`));
    }
    return payload;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
