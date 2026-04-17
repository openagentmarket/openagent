import fs from "node:fs";
import path from "node:path";

const STATE_FILENAME = "control-room.json";

export async function ensureControlRoom(runtime, options) {
  fs.mkdirSync(options.dataDir, { recursive: true });

  const existingState = loadControlRoomState(options.dataDir);
  if (existingState?.conversationId) {
    const existingConversation = await getConversation(runtime, existingState.conversationId);
    if (existingConversation) {
      const inviteUrl = await createInviteUrl(runtime, existingConversation, options);
      const reusedState = {
        ...existingState,
        name: options.name,
        description: options.description,
        inviteUrl,
        updatedAt: new Date().toISOString(),
      };
      saveControlRoomState(options.dataDir, reusedState);
      return reusedState;
    }
  }

  const createdGroup = await runtime.createGroup({
    name: options.name,
    description: options.description,
  });
  const createdState = {
    name: options.name,
    description: options.description,
    conversationId: createdGroup.conversationId,
    inviteUrl: createdGroup.inviteUrl,
    updatedAt: new Date().toISOString(),
  };
  saveControlRoomState(options.dataDir, createdState);
  return createdState;
}

export function loadControlRoomState(dataDir) {
  const statePath = path.join(dataDir, STATE_FILENAME);
  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.conversationId !== "string"
      || typeof parsed.inviteUrl !== "string"
      || typeof parsed.name !== "string"
      || typeof parsed.description !== "string"
      || typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function saveControlRoomState(dataDir, state) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, STATE_FILENAME),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

async function getConversation(runtime, conversationId) {
  const client = runtime?.agent?.client;
  const getter = client?.conversations?.getConversationById;
  if (!getter) {
    return null;
  }
  return getter.call(client.conversations, conversationId);
}

async function createInviteUrl(runtime, conversation, options) {
  const group = runtime.convos.group(conversation);
  const invite = await Promise.resolve(group.createInvite({
    name: options.name,
    description: options.description,
  }));
  return invite.url;
}
