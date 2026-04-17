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
  const rooms = projectPath ? options.roomStore.getAll() : [];

  return {
    projectPath,
    setupRequired: !projectPath,
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
      --bg: #f5f2ec;
      --panel: #fffdf9;
      --ink: #171717;
      --muted: #746b5f;
      --line: #e5dccf;
      --shadow: 0 8px 24px rgba(21, 14, 7, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      min-height: 100vh;
    }
    main {
      max-width: 760px;
      margin: 0 auto;
      padding: 24px 16px 40px;
    }
    .hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    .hero-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    h1 {
      margin: 0 0 4px;
      font-size: clamp(1.6rem, 4vw, 2.2rem);
      line-height: 1;
      letter-spacing: -0.04em;
    }
    .sub {
      color: var(--muted);
      font-size: 0.92rem;
      line-height: 1.4;
    }
    button {
      appearance: none;
      border: 1px solid var(--ink);
      border-radius: 999px;
      padding: 11px 16px;
      background: var(--ink);
      color: white;
      font-weight: 700;
      cursor: pointer;
      transition: transform 120ms ease, background 120ms ease, color 120ms ease;
    }
    button:hover { transform: translateY(-1px); background: #000; }
    button:disabled { cursor: wait; opacity: 0.7; transform: none; }
    .secondary-button {
      background: transparent;
      color: var(--ink);
    }
    .secondary-button:hover {
      background: var(--ink);
      color: white;
    }
    .status {
      min-height: 22px;
      margin: 0 0 14px;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .setup-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 22px;
      box-shadow: var(--shadow);
      padding: 18px 16px;
      display: grid;
      gap: 12px;
      margin-bottom: 14px;
    }
    .setup-copy {
      color: var(--muted);
      font-size: 0.92rem;
      line-height: 1.45;
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
      border-radius: 16px;
      padding: 12px 14px;
      background: white;
      color: var(--ink);
      font: inherit;
    }
    .setup-input::placeholder {
      color: #9a907f;
    }
    .project-chip {
      display: inline-flex;
      align-self: flex-start;
      padding: 6px 10px;
      border-radius: 999px;
      background: #f1e9dc;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .setup-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .rooms {
      display: grid;
      gap: 14px;
    }
    .room {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 22px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .room-header {
      padding: 16px 16px 0;
    }
    .room-kind {
      display: inline-flex;
      padding: 5px 9px;
      border-radius: 999px;
      background: #f1e9dc;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 10px;
    }
    .room-title {
      margin: 0;
      font-size: 1.05rem;
      line-height: 1.2;
    }
    .room-description {
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.4;
      margin: 8px 0 0;
    }
    .room-body {
      padding: 14px 16px 16px;
      display: grid;
      gap: 12px;
    }
    .qr {
      background: white;
      border-radius: 18px;
      border: 1px solid var(--line);
      padding: 10px;
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
      border-radius: 22px;
      text-align: center;
      color: var(--muted);
      background: rgba(255, 253, 249, 0.7);
    }
    @media (max-width: 720px) {
      .hero { flex-direction: column; align-items: stretch; }
      button { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <h1>OpenAgent Chats</h1>
        <div class="sub" id="hero-sub">Scan the QR to open the current chat, or create a new thread when you want a fresh context.</div>
      </div>
      <div class="hero-actions">
        <button class="secondary-button" id="change-project-button">Change Repo</button>
        <button id="create-button">New Thread</button>
      </div>
    </section>

    <div class="status" id="status"></div>
    <section id="setup"></section>
    <section class="rooms" id="rooms"></section>
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
      };
      renderSetup(payload);
      renderRooms(payload.rooms || [], payload.primaryRoomConversationId || "");
    }

    function renderSetup(payload) {
      const projectPath = payload.projectPath || "";
      const setupRequired = payload.setupRequired === true;
      const hasRooms = Array.isArray(payload.rooms) && payload.rooms.length > 0;
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
        \`;
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

        form.querySelector("button").disabled = true;
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
          statusNode.textContent = "Project connected. Your first chat is ready.";
          await loadDashboard();
        } catch (error) {
          statusNode.textContent = String(error?.message || error);
          form.querySelector("button").disabled = false;
        }
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
            <div class="room-kind">\${escapeHtml(room.conversationId === primaryRoomConversationId ? "current chat" : "recent chat")}</div>
            <h2 class="room-title">\${escapeHtml(room.name || room.conversationId)}</h2>
            <p class="room-description">\${escapeHtml(room.description || "OpenAgent chat room")}</p>
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
        ? '<div class="empty">Changing repo will create a fresh chat for the new project.</div>'
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
