import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";
import { URL } from "node:url";
import { createQrDataUrl } from "./invite-artifacts.js";

const execFileAsync = promisify(execFile);

export function startDashboardServer(options) {
  const server = http.createServer(async (request, response) => {
    try {
      const method = String(request.method || "GET").toUpperCase();
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (method === "GET" && url.pathname === "/api/dashboard") {
        const payload = await buildDashboardPayload(options);
        return sendJson(response, 200, payload);
      }

      if (method === "POST" && url.pathname === "/api/threads") {
        const room = await options.createRoom();
        const payload = await serializeRoom(room);
        return sendJson(response, 201, { room: payload });
      }

      if (method === "POST" && url.pathname === "/api/project") {
        const body = await readJsonBody(request);
        const result = await options.setProjectPath(body?.projectPath || "");
        return sendJson(response, 200, {
          projectPath: result.projectPath,
          primaryRoom: result.primaryRoom ? await serializeRoom(result.primaryRoom) : null,
        });
      }

      if (method === "POST" && url.pathname === "/api/project/pick") {
        const body = await readJsonBody(request);
        const projectPath = await pickProjectFolder(body?.projectPath || "");
        return sendJson(response, 200, { projectPath });
      }

      if (method === "POST" && url.pathname === "/api/runtime-config") {
        const body = await readJsonBody(request);
        const result = await options.setRuntimeConfig(body?.runtimeConfig || {});
        return sendJson(response, 200, {
          runtimeConfig: result.runtimeConfig,
        });
      }

      if (method === "GET" && url.pathname === "/") {
        return sendHtml(response, renderDashboardHtml());
      }

      sendJson(response, 404, { error: { message: "Not found." } });
    } catch (error) {
      sendJson(response, 500, {
        error: {
          message: String(error?.message || error || "Unknown dashboard error."),
        },
      });
    }
  });

  server.listen(options.port, options.host, () => {
    console.log(`[convos-control] dashboard listening on http://${options.host}:${options.port}`);
  });

  return server;
}

async function buildDashboardPayload(options) {
  const runtimeInfo = typeof options.getRuntimeInfo === "function" ? options.getRuntimeInfo() : {};
  const projectPath = typeof options.getProjectPath === "function" ? options.getProjectPath() : "";
  const runtimeConfig = typeof options.getRuntimeConfig === "function"
    ? options.getRuntimeConfig()
    : { approvalPolicy: "never", sandboxMode: "workspace-write" };
  const rooms = projectPath ? options.roomStore.getAll() : [];

  return {
    projectPath,
    setupRequired: !projectPath,
    runtimeConfig,
    bridgeAddress: runtimeInfo.address || "",
    bridgeInboxId: runtimeInfo.inboxId || "",
    primaryRoomConversationId: rooms[0]?.conversationId || "",
    rooms: await Promise.all(rooms.map((room) => serializeRoom(room))),
  };
}

async function serializeRoom(room) {
  return {
    ...room,
    qrDataUrl: await createQrDataUrl(room.qrTarget || room.inviteUrl || room.deepLink || ""),
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function pickProjectFolder(currentPath = "") {
  const prompt = "Choose the local repo for OpenAgent";
  const script = buildFolderPickerScript(prompt, currentPath);

  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    const selected = String(stdout || "").trim();
    if (!selected) {
      throw new Error("No folder was selected.");
    }
    return selected.replace(/\/+$/, "");
  } catch (error) {
    const message = String(error?.stderr || error?.message || error || "");
    if (/User canceled/i.test(message) || /-128/.test(message)) {
      throw new Error("Folder selection was cancelled.");
    }
    throw error;
  }
}

function buildFolderPickerScript(prompt, currentPath) {
  const escapedPrompt = escapeAppleScriptString(prompt);
  const escapedPath = escapeAppleScriptString(String(currentPath || "").trim());

  if (escapedPath) {
    return `
      set defaultFolder to POSIX file "${escapedPath}"
      return POSIX path of (choose folder with prompt "${escapedPrompt}" default location defaultFolder)
    `;
  }

  return `return POSIX path of (choose folder with prompt "${escapedPrompt}")`;
}

function escapeAppleScriptString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
}

function renderDashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenAgent Chats</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f6f3;
      --panel: rgba(255, 255, 255, 0.92);
      --panel-strong: #ffffff;
      --ink: #111111;
      --muted: #6a6a63;
      --line: rgba(17, 17, 17, 0.09);
      --line-strong: rgba(17, 17, 17, 0.14);
      --surface: rgba(17, 17, 17, 0.03);
      --surface-strong: rgba(17, 17, 17, 0.05);
      --shadow: 0 1px 2px rgba(17, 17, 17, 0.04), 0 14px 40px rgba(17, 17, 17, 0.04);
      --radius-lg: 24px;
      --radius-md: 18px;
      --radius-sm: 14px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      min-height: 100vh;
      background-image:
        radial-gradient(circle at top, rgba(17, 17, 17, 0.045), transparent 32%),
        linear-gradient(to bottom, rgba(255, 255, 255, 0.76), rgba(255, 255, 255, 0));
    }
    main {
      max-width: 880px;
      margin: 0 auto;
      padding: 20px 16px 40px;
    }
    .shell {
      background: rgba(255, 255, 255, 0.54);
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 28px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
      overflow: hidden;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.62);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      display: flex;
      gap: 10px;
      min-width: 0;
    }
    .brand-mark {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: #111111;
      color: white;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      flex: none;
    }
    .brand-copy {
      min-width: 0;
    }
    .brand-label {
      font-size: 0.76rem;
      line-height: 1;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
      margin-bottom: 4px;
    }
    .brand-title {
      font-size: 0.96rem;
      line-height: 1.2;
      font-weight: 600;
      letter-spacing: -0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .topbar-actions {
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
      display: flex;
    }
    .content {
      padding: 20px;
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: end;
      margin-bottom: 18px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }
    .hero-copy {
      min-width: 0;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 11px;
      border-radius: 999px;
      background: var(--surface);
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 0.74rem;
      line-height: 1;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 700;
      margin-bottom: 12px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: clamp(1.8rem, 4vw, 2.7rem);
      line-height: 0.96;
      letter-spacing: -0.05em;
      font-weight: 700;
    }
    .sub {
      color: var(--muted);
      font-size: 0.96rem;
      line-height: 1.5;
      max-width: 56ch;
    }
    .hero-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-self: start;
    }
    button {
      appearance: none;
      border: 1px solid transparent;
      border-radius: 999px;
      padding: 11px 16px;
      background: var(--ink);
      color: white;
      font-weight: 600;
      letter-spacing: -0.01em;
      cursor: pointer;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.1) inset;
      transition: transform 120ms ease, background 120ms ease, color 120ms ease, border-color 120ms ease;
    }
    button:hover { transform: translateY(-1px); background: #000; }
    button:disabled { cursor: wait; opacity: 0.7; transform: none; }
    .secondary-button {
      background: var(--panel-strong);
      color: var(--ink);
      border-color: var(--line-strong);
      box-shadow: none;
    }
    .secondary-button:hover {
      background: var(--surface);
      color: var(--ink);
    }
    .status {
      min-height: 21px;
      margin: 0 0 14px;
      color: var(--muted);
      font-size: 0.88rem;
      line-height: 1.45;
    }
    .setup-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow);
      padding: 18px;
      display: grid;
      gap: 14px;
      margin-bottom: 14px;
    }
    .setup-copy {
      color: var(--muted);
      font-size: 0.93rem;
      line-height: 1.5;
    }
    .setup-form {
      display: grid;
      gap: 10px;
    }
    .setup-buttons {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .setup-input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 12px 14px;
      background: var(--panel-strong);
      color: var(--ink);
      font: inherit;
      outline: none;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    .setup-input:focus {
      border-color: rgba(17, 17, 17, 0.2);
      box-shadow: 0 0 0 4px rgba(17, 17, 17, 0.05);
    }
    .setup-input::placeholder {
      color: #909086;
    }
    .project-chip {
      display: inline-flex;
      align-self: flex-start;
      align-items: center;
      padding: 8px 12px;
      border-radius: 999px;
      background: var(--surface);
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .setup-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .runtime-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow);
      padding: 18px;
      display: grid;
      gap: 14px;
      margin-bottom: 14px;
    }
    .runtime-copy {
      color: var(--muted);
      font-size: 0.92rem;
      line-height: 1.5;
    }
    .runtime-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .runtime-button {
      min-width: 148px;
    }
    .runtime-button[aria-pressed="true"] {
      background: var(--ink);
      color: white;
      border-color: var(--ink);
    }
    .rooms {
      display: grid;
      gap: 14px;
    }
    .room {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .room-header {
      padding: 18px 18px 0;
    }
    .room-title {
      margin: 0;
      font-size: 1.12rem;
      line-height: 1.2;
      letter-spacing: -0.03em;
    }
    .room-body {
      padding: 16px 18px 18px;
      display: grid;
      gap: 12px;
    }
    .qr {
      background: linear-gradient(180deg, rgba(255,255,255,0.96), #fbfbf9);
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      padding: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 312px;
    }
    .qr img {
      max-width: 100%;
      width: 284px;
      height: 284px;
      object-fit: contain;
    }
    .room-actions {
      display: flex;
      justify-content: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .empty {
      padding: 24px;
      border: 1px dashed var(--line);
      border-radius: var(--radius-lg);
      text-align: center;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.64);
      line-height: 1.5;
    }
    @media (max-width: 720px) {
      .topbar,
      .hero {
        grid-template-columns: 1fr;
        flex-direction: column;
        align-items: stretch;
      }
      .topbar { padding: 14px 16px; }
      .content { padding: 16px; }
      .topbar-actions,
      .hero-actions {
        width: 100%;
      }
      button { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <section class="shell">
      <div class="topbar">
        <div class="brand">
          <div class="brand-mark">OA</div>
          <div class="brand-copy">
            <div class="brand-label">Local Control</div>
            <div class="brand-title">OpenAgent for Convos</div>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="secondary-button" id="change-project-button">Change Repo</button>
        </div>
      </div>

      <div class="content">
        <section class="hero">
          <div class="hero-copy">
            <div class="eyebrow">Codex Local</div>
            <h1>Chat with your local Codex from Convos.</h1>
            <div class="sub" id="hero-sub">Scan the QR to open the current chat, or create a new thread when you want a fresh context.</div>
          </div>
          <div class="hero-actions">
            <button id="create-button">New Thread</button>
          </div>
        </section>

        <div class="status" id="status"></div>
        <section id="setup"></section>
        <section class="rooms" id="rooms"></section>
      </div>
    </section>
  </main>

  <script>
    const setupNode = document.getElementById("setup");
    const roomsNode = document.getElementById("rooms");
    const statusNode = document.getElementById("status");
    const createButton = document.getElementById("create-button");
    const changeProjectButton = document.getElementById("change-project-button");
    const heroSubNode = document.getElementById("hero-sub");
    let dashboardState = {
      projectPath: "",
      setupRequired: true,
      runtimeConfig: {
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
      },
    };

    async function loadDashboard() {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed loading dashboard");
      }
      const payload = await response.json();
      dashboardState = {
        projectPath: payload.projectPath || "",
        setupRequired: payload.setupRequired === true,
        runtimeConfig: payload.runtimeConfig || {
          approvalPolicy: "never",
          sandboxMode: "workspace-write",
        },
      };
      renderSetup(payload);
      renderRooms(payload.rooms || [], payload.primaryRoomConversationId || "");
    }

    function renderSetup(payload) {
      const projectPath = payload.projectPath || "";
      const setupRequired = payload.setupRequired === true;
      const hasRooms = Array.isArray(payload.rooms) && payload.rooms.length > 0;
      const sandboxMode = payload.runtimeConfig?.sandboxMode || "workspace-write";
      createButton.disabled = setupRequired;
      changeProjectButton.disabled = false;
      heroSubNode.textContent = setupRequired
        ? "Paste the local repo path once, then press New Thread when you want to generate a chat you can scan from Convos."
        : (hasRooms
          ? "Scan the QR to open the current chat, or create a new thread when you want a fresh context."
          : "Your repo is connected. Press New Thread when you want to generate a fresh chat and QR code.");

      if (!setupRequired) {
        const label = projectPath.split(/[\\\\/]/).filter(Boolean).pop() || projectPath;
        setupNode.innerHTML = \`
          <div class="setup-actions">
            <div class="project-chip">Connected to \${escapeHtml(label)}</div>
          </div>
          <article class="runtime-card">
            <div class="runtime-copy">Sandbox mode controls how much filesystem access local Codex gets for future runs from this dashboard.</div>
            <div class="runtime-actions">
              <button
                type="button"
                class="secondary-button runtime-button"
                data-sandbox-mode="workspace-write"
                aria-pressed="\${sandboxMode === "workspace-write" ? "true" : "false"}"
              >Workspace Only</button>
              <button
                type="button"
                class="secondary-button runtime-button"
                data-sandbox-mode="danger-full-access"
                aria-pressed="\${sandboxMode === "danger-full-access" ? "true" : "false"}"
              >Full Access</button>
            </div>
          </article>
        \`;
        bindRuntimeModeButtons();
        return;
      }

      setupNode.innerHTML = \`
        <article class="setup-card">
          <div class="setup-copy">Choose which local repo Codex should control. Paste the absolute path to the repo folder on this machine.</div>
          <form class="setup-form" id="setup-form">
            <input
              class="setup-input"
              id="project-path-input"
              name="projectPath"
              type="text"
              placeholder="/Users/you/path/to/repo"
              autocomplete="off"
              spellcheck="false"
            />
            <div class="setup-buttons">
              <button type="button" class="secondary-button" id="browse-project-button">Browse Folder</button>
              <button type="submit">Use This Repo</button>
            </div>
          </form>
        </article>
      \`;

      const form = document.getElementById("setup-form");
      const input = document.getElementById("project-path-input");
      const browseButton = document.getElementById("browse-project-button");
      const submitButton = form.querySelector('button[type="submit"]');
      if (dashboardState.projectPath) {
        input.value = dashboardState.projectPath;
      }
      browseButton.addEventListener("click", async () => {
        browseButton.disabled = true;
        statusNode.textContent = "Opening folder picker...";
        try {
          const response = await fetch("/api/project/pick", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectPath: (input.value || "").trim() || dashboardState.projectPath || "" }),
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload?.error?.message || "Could not open the folder picker.");
          }
          input.value = payload.projectPath || "";
          statusNode.textContent = "Folder selected. Press Use This Repo to continue.";
        } catch (error) {
          statusNode.textContent = String(error?.message || error);
        } finally {
          browseButton.disabled = false;
        }
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const projectPathInput = (input.value || "").trim();
        if (!projectPathInput) {
          statusNode.textContent = "Paste a local repo path first.";
          return;
        }

        submitButton.disabled = true;
        statusNode.textContent = "Connecting this repo to OpenAgent...";
        try {
          const response = await fetch("/api/project", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectPath: projectPathInput }),
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload?.error?.message || "Could not use that project path.");
          }
          statusNode.textContent = "Project connected. Press New Thread when you want to create a chat.";
          await loadDashboard();
        } catch (error) {
          statusNode.textContent = String(error?.message || error);
          submitButton.disabled = false;
        }
      });
    }

    function bindRuntimeModeButtons() {
      setupNode.querySelectorAll("[data-sandbox-mode]").forEach((button) => {
        button.addEventListener("click", async () => {
          const sandboxMode = button.getAttribute("data-sandbox-mode") || "workspace-write";
          setupNode.querySelectorAll("[data-sandbox-mode]").forEach((entry) => {
            entry.disabled = true;
          });
          statusNode.textContent = sandboxMode === "danger-full-access"
            ? "Switching Codex to full access..."
            : "Switching Codex to workspace-only access...";
          try {
            const response = await fetch("/api/runtime-config", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                runtimeConfig: {
                  approvalPolicy: dashboardState.runtimeConfig?.approvalPolicy || "never",
                  sandboxMode,
                },
              }),
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error?.message || "Could not update runtime mode.");
            }
            dashboardState.runtimeConfig = payload.runtimeConfig || dashboardState.runtimeConfig;
            statusNode.textContent = sandboxMode === "danger-full-access"
              ? "Full access enabled for future runs."
              : "Workspace-only access enabled for future runs.";
            await loadDashboard();
          } catch (error) {
            statusNode.textContent = String(error?.message || error);
            setupNode.querySelectorAll("[data-sandbox-mode]").forEach((entry) => {
              entry.disabled = false;
            });
          }
        });
      });
    }

    function renderRooms(rooms, primaryRoomConversationId) {
      if (!rooms.length) {
        roomsNode.innerHTML = '<div class="empty">No chats yet. Press <strong>New Thread</strong> when you want to create the first QR chat for this repo.</div>';
        return;
      }

      roomsNode.innerHTML = rooms.map(room => \`
        <article class="room">
          <div class="room-header">
            <h2 class="room-title">\${escapeHtml(room.name || room.conversationId)}</h2>
          </div>
          <div class="room-body">
            <div class="qr">
              \${room.qrDataUrl ? \`<img alt="QR code for \${escapeHtml(room.name || room.conversationId)}" src="\${room.qrDataUrl}" />\` : '<span>No QR available</span>'}
            </div>
            <div class="room-actions">
              <button class="secondary-button" data-copy-invite="\${escapeAttribute(room.inviteUrl || "")}">Copy Invite</button>
            </div>
          </div>
        </article>
      \`).join("");

      roomsNode.querySelectorAll("[data-copy-invite]").forEach((button) => {
        button.addEventListener("click", async () => {
          const invite = button.getAttribute("data-copy-invite") || "";
          if (!invite) {
            statusNode.textContent = "Invite is not ready yet.";
            return;
          }
          try {
            await navigator.clipboard.writeText(invite);
            statusNode.textContent = "Invite copied.";
          } catch {
            statusNode.textContent = "Could not copy invite.";
          }
        });
      });
    }

    async function createThread() {
      createButton.disabled = true;
      statusNode.textContent = "Creating a fresh chat room...";
      try {
        const response = await fetch("/api/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error?.message || "Failed creating thread");
        }
        statusNode.textContent = "New chat ready.";
        await loadDashboard();
      } catch (error) {
        statusNode.textContent = String(error?.message || error);
      } finally {
        createButton.disabled = false;
      }
    }

    async function openProjectSetup() {
      const payload = {
        projectPath: dashboardState.projectPath || "",
        setupRequired: true,
      };
      renderSetup(payload);
      roomsNode.innerHTML = dashboardState.projectPath
        ? '<div class="empty">Changing repo will switch Codex to a different local project. Create a thread after that when you are ready.</div>'
        : '<div class="empty">Pick a repo above to create your first chat.</div>';
      statusNode.textContent = "Choose the local repo you want Codex to control.";
      const input = document.getElementById("project-path-input");
      if (input) {
        input.focus();
        input.select();
      }
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function escapeAttribute(value) {
      return escapeHtml(value);
    }

    createButton.addEventListener("click", createThread);
    changeProjectButton.addEventListener("click", async () => {
      openProjectSetup();
      const browseButton = document.getElementById("browse-project-button");
      if (browseButton) {
        browseButton.click();
      }
    });
    loadDashboard().catch((error) => {
      statusNode.textContent = String(error?.message || error);
    });
    setInterval(() => {
      loadDashboard().catch(() => {});
    }, 10000);
  </script>
</body>
</html>`;
}
