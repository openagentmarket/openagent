import http from "node:http";
import { URL } from "node:url";
import { createQrDataUrl } from "./invite-artifacts.js";

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
  const rooms = options.roomStore.getAll();

  return {
    projectPath: options.projectPath,
    bridgeAddress: runtimeInfo.address || "",
    bridgeInboxId: runtimeInfo.inboxId || "",
    rooms: await Promise.all(rooms.map((room) => serializeRoom(room))),
  };
}

async function serializeRoom(room) {
  return {
    ...room,
    qrDataUrl: await createQrDataUrl(room.qrTarget || room.inviteUrl || room.deepLink || ""),
  };
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
  <title>OpenAgent Convos</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4efe6;
      --panel: #fffaf2;
      --ink: #131313;
      --muted: #6f675b;
      --accent: #d95c2b;
      --accent-strong: #b7481d;
      --line: #e6dac9;
      --shadow: 0 12px 40px rgba(21, 14, 7, 0.10);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(217,92,43,0.14), transparent 28%),
        linear-gradient(180deg, #f8f2e8 0%, var(--bg) 100%);
      color: var(--ink);
      min-height: 100vh;
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 40px 20px 72px;
    }
    .hero {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: flex-start;
      margin-bottom: 28px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: clamp(2rem, 5vw, 3.5rem);
      line-height: 0.95;
      letter-spacing: -0.04em;
    }
    .sub {
      max-width: 640px;
      color: var(--muted);
      font-size: 1rem;
      line-height: 1.5;
    }
    button {
      appearance: none;
      border: 0;
      border-radius: 999px;
      padding: 14px 22px;
      background: var(--ink);
      color: white;
      font-weight: 700;
      cursor: pointer;
      box-shadow: var(--shadow);
      transition: transform 120ms ease, background 120ms ease;
    }
    button:hover { transform: translateY(-1px); background: #000; }
    button:disabled { cursor: wait; opacity: 0.7; transform: none; }
    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }
    .meta-card, .room {
      background: rgba(255,250,242,0.9);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }
    .meta-card {
      padding: 18px 20px;
    }
    .meta-label {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 8px;
    }
    .meta-value {
      font-size: 0.95rem;
      word-break: break-word;
    }
    .rooms {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 18px;
    }
    .room {
      overflow: hidden;
    }
    .room-header {
      padding: 18px 20px 8px;
    }
    .room-kind {
      display: inline-flex;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(217,92,43,0.12);
      color: var(--accent-strong);
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 10px;
    }
    .room-title {
      margin: 0;
      font-size: 1.15rem;
      line-height: 1.2;
    }
    .room-description {
      color: var(--muted);
      font-size: 0.95rem;
      line-height: 1.45;
      margin: 10px 0 0;
    }
    .room-body {
      padding: 0 20px 20px;
      display: grid;
      gap: 14px;
    }
    .qr {
      background: white;
      border-radius: 18px;
      border: 1px solid var(--line);
      padding: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 268px;
    }
    .qr img {
      max-width: 100%;
      width: 240px;
      height: 240px;
      object-fit: contain;
    }
    .facts {
      display: grid;
      gap: 8px;
      font-size: 0.88rem;
      color: var(--muted);
    }
    .facts strong {
      color: var(--ink);
      font-weight: 700;
    }
    .link {
      display: block;
      color: var(--accent-strong);
      text-decoration: none;
      word-break: break-all;
      line-height: 1.4;
    }
    .empty {
      padding: 28px;
      border: 1px dashed var(--line);
      border-radius: 24px;
      text-align: center;
      color: var(--muted);
      background: rgba(255,250,242,0.55);
    }
    .status {
      min-height: 24px;
      margin: 10px 0 18px;
      color: var(--accent-strong);
      font-weight: 600;
    }
    @media (max-width: 720px) {
      .hero { flex-direction: column; }
      button { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <h1>OpenAgent Convos</h1>
        <div class="sub">Create a fresh Convos group that already includes the local Codex bridge, pre-bind it to a new OpenAgent task, then let someone scan the QR from the Convos iPhone app and start chatting.</div>
      </div>
      <button id="create-button">New Thread</button>
    </section>

    <section class="meta" id="meta"></section>
    <div class="status" id="status"></div>
    <section class="rooms" id="rooms"></section>
  </main>

  <script>
    const metaNode = document.getElementById("meta");
    const roomsNode = document.getElementById("rooms");
    const statusNode = document.getElementById("status");
    const createButton = document.getElementById("create-button");

    async function loadDashboard() {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed loading dashboard");
      }
      const payload = await response.json();
      renderMeta(payload);
      renderRooms(payload.rooms || []);
    }

    function renderMeta(payload) {
      const cards = [
        { label: "Project", value: payload.projectPath || "unknown" },
        { label: "Bridge Address", value: payload.bridgeAddress || "not ready" },
        { label: "Bridge Inbox", value: payload.bridgeInboxId || "not ready" },
      ];
      metaNode.innerHTML = cards.map(card => \`
        <article class="meta-card">
          <div class="meta-label">\${escapeHtml(card.label)}</div>
          <div class="meta-value">\${escapeHtml(card.value)}</div>
        </article>
      \`).join("");
    }

    function renderRooms(rooms) {
      if (!rooms.length) {
        roomsNode.innerHTML = '<div class="empty">No Convos rooms yet. Press <strong>New Thread</strong> to mint one.</div>';
        return;
      }

      roomsNode.innerHTML = rooms.map(room => \`
        <article class="room">
          <div class="room-header">
            <div class="room-kind">\${escapeHtml(room.kind || "thread-room")}</div>
            <h2 class="room-title">\${escapeHtml(room.name || room.conversationId)}</h2>
            <p class="room-description">\${escapeHtml(room.description || "OpenAgent room")}</p>
          </div>
          <div class="room-body">
            <div class="qr">
              \${room.qrDataUrl ? \`<img alt="QR code for \${escapeHtml(room.name || room.conversationId)}" src="\${room.qrDataUrl}" />\` : '<span>No QR available</span>'}
            </div>
            <div class="facts">
              <div><strong>Conversation</strong><br />\${escapeHtml(room.conversationId || "")}</div>
              <div><strong>Task</strong><br />\${escapeHtml(room.taskId || "not bound")}</div>
              <div><strong>Thread</strong><br />\${escapeHtml(room.threadId || "created on first prompt")}</div>
              <div><strong>Invite URL</strong><br /><a class="link" href="\${escapeAttribute(room.inviteUrl || "#")}" target="_blank" rel="noreferrer">\${escapeHtml(room.inviteUrl || "not ready")}</a></div>
              <div><strong>Deep Link</strong><br /><span class="link">\${escapeHtml(room.deepLink || "not ready")}</span></div>
            </div>
          </div>
        </article>
      \`).join("");
    }

    async function createThread() {
      createButton.disabled = true;
      statusNode.textContent = "Creating a fresh Convos room and binding it to OpenAgent...";
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
        statusNode.textContent = "New Convos thread ready. Scan the QR from the app.";
        await loadDashboard();
      } catch (error) {
        statusNode.textContent = String(error?.message || error);
      } finally {
        createButton.disabled = false;
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
