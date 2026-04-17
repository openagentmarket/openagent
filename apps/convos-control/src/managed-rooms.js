import fs from "node:fs";
import path from "node:path";
import { createCompatibleInviteUrl } from "./convos-cli-invite.js";
import { enrichRoomInvite } from "./invite-artifacts.js";

const MANAGED_ROOMS_FILENAME = "managed-rooms.json";

export class ManagedRoomStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, MANAGED_ROOMS_FILENAME);
    this.roomsByConversationId = new Map();
    this.load();
  }

  load() {
    this.roomsByConversationId.clear();
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const rooms = Array.isArray(parsed?.rooms) ? parsed.rooms : [];
      for (const room of rooms) {
        const normalized = normalizeManagedRoom(room);
        if (normalized) {
          this.roomsByConversationId.set(normalized.conversationId, normalized);
        }
      }
    } catch {
      // Ignore corrupt local state and rebuild on next save.
    }
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const rooms = this.getAll();
    fs.writeFileSync(this.filePath, JSON.stringify({ rooms }, null, 2), "utf8");
  }

  getAll() {
    return Array.from(this.roomsByConversationId.values())
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  }

  getByConversationId(conversationId) {
    const key = String(conversationId || "").trim();
    return key ? this.roomsByConversationId.get(key) || null : null;
  }

  hasConversation(conversationId) {
    return Boolean(this.getByConversationId(conversationId));
  }

  removeByKind(kind) {
    const normalizedKind = String(kind || "").trim();
    if (!normalizedKind) {
      return 0;
    }

    let removed = 0;
    for (const [conversationId, room] of this.roomsByConversationId.entries()) {
      if (room?.kind === normalizedKind) {
        this.roomsByConversationId.delete(conversationId);
        removed += 1;
      }
    }

    if (removed > 0) {
      this.save();
    }

    return removed;
  }

  upsert(room) {
    const previous = this.getByConversationId(room?.conversationId);
    const normalized = normalizeManagedRoom({
      ...previous,
      ...room,
      createdAt: room?.createdAt || previous?.createdAt || nowIso(),
      updatedAt: nowIso(),
    });
    if (!normalized) {
      throw new Error("Managed room requires a conversationId.");
    }

    this.roomsByConversationId.set(normalized.conversationId, normalized);
    this.save();
    return normalized;
  }

  updateBinding(conversationId, binding) {
    const existing = this.getByConversationId(conversationId);
    if (!existing) {
      return null;
    }

    return this.upsert({
      ...existing,
      taskId: binding?.task?.taskId || existing.taskId,
      threadId: binding?.task?.threadId || binding?.channel?.threadId || existing.threadId,
      runStatus: binding?.task?.status || existing.runStatus,
    });
  }
}

export async function createManagedRoom(runtime, daemon, config, roomStore, options = {}) {
  const name = String(options.name || "").trim() || defaultRoomName(config.projectPath);
  const description = String(options.description || "").trim()
    || `Fresh OpenAgent thread for ${path.basename(config.projectPath)}.`;

  const createdGroup = await runtime.createGroup({ name, description });
  const conversation = await getConversation(runtime, createdGroup.conversationId);
  const inviteUrl = conversation
    ? await createCompatibleInviteUrl(runtime, conversation, {
      dataDir: config.dataDir,
      env: config.xmtpEnv,
      name,
      description,
    })
    : createdGroup.inviteUrl;

  const binding = await daemon.ensureConversationTask(createdGroup.conversationId, {
    title: name,
    forceNewTask: true,
  });

  const room = enrichRoomInvite({
    kind: String(options.kind || "thread-room"),
    conversationId: createdGroup.conversationId,
    name,
    description,
    inviteUrl,
    taskId: binding?.task?.taskId || "",
    threadId: binding?.task?.threadId || binding?.channel?.threadId || "",
    runStatus: binding?.task?.status || "idle",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }, config.dataDir);

  roomStore.upsert(room);
  return room;
}

function normalizeManagedRoom(room) {
  const conversationId = String(room?.conversationId || "").trim();
  if (!conversationId) {
    return null;
  }

  return {
    kind: String(room?.kind || "thread-room").trim() || "thread-room",
    conversationId,
    name: String(room?.name || "").trim(),
    description: String(room?.description || "").trim(),
    inviteUrl: String(room?.inviteUrl || "").trim(),
    deepLink: String(room?.deepLink || "").trim(),
    qrTarget: String(room?.qrTarget || "").trim(),
    qrPngPath: String(room?.qrPngPath || "").trim(),
    taskId: String(room?.taskId || "").trim(),
    threadId: String(room?.threadId || "").trim(),
    runStatus: String(room?.runStatus || "idle").trim() || "idle",
    createdAt: String(room?.createdAt || "").trim() || nowIso(),
    updatedAt: String(room?.updatedAt || "").trim() || nowIso(),
  };
}

function defaultRoomName(projectPath) {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  return `${path.basename(projectPath)} ${stamp}`;
}

async function getConversation(runtime, conversationId) {
  const client = runtime?.agent?.client;
  const getter = client?.conversations?.getConversationById;
  if (!getter) {
    return null;
  }
  return getter.call(client.conversations, conversationId);
}

function nowIso() {
  return new Date().toISOString();
}
