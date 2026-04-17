import path from "node:path";

export function renderHelp() {
  return [
    "Plain text sends a prompt to OpenAgent.",
    "Commands: /status, /new, /stop, /help",
  ].join("\n");
}

export function renderRunStarted(projectPath) {
  return `Running in ${path.basename(projectPath)}...`;
}

export function renderStillWorking() {
  return "Still working...";
}

export function renderJoinAccepted(projectPath) {
  return `Connected to OpenAgent for ${path.basename(projectPath)}. Send plain text to prompt it, or use /help.`;
}

export function renderNewThread() {
  return "Started a fresh OpenAgent thread for the next prompt.";
}

export function renderStopResult(didInterrupt) {
  return didInterrupt ? "Stopped the active OpenAgent run." : "No active OpenAgent run to stop.";
}

export function renderBusyStatus() {
  return "OpenAgent is already running. Wait for it to finish or use /stop.";
}

export function renderStatus(input) {
  return [
    `Project: ${input.projectPath}`,
    `Conversation: ${input.conversationId ?? "not ready"}`,
    `Invite URL: ${input.inviteUrl ?? "not ready"}`,
    `Invite Deep Link: ${input.deepLink ?? "not ready"}`,
    `Invite QR PNG: ${input.qrPngPath ?? "not ready"}`,
    `Daemon: ${input.daemonBaseUrl}`,
    `Task: ${input.taskId ?? "none"}`,
    `Thread: ${input.threadId ?? "none"}`,
    `Run: ${input.status ?? "idle"}`,
  ].join("\n");
}

export function renderFinalOutput(output) {
  const trimmed = String(output || "").trim();
  return trimmed || "OpenAgent finished without a text reply.";
}

export function renderError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return `OpenAgent error: ${message}`;
}
