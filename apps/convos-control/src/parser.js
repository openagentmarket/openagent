export function parseMessageContent(content) {
  return parseMessageText(coerceMessageText(content));
}

export function parseMessageText(rawText) {
  const text = rawText.trim();
  if (!text) {
    return { kind: "ignore" };
  }

  const normalized = text.toLowerCase();
  if (normalized === "/help") {
    return { kind: "help" };
  }
  if (normalized === "/status") {
    return { kind: "status" };
  }
  if (normalized === "/new") {
    return { kind: "new-thread" };
  }
  if (normalized === "/stop") {
    return { kind: "stop" };
  }

  return { kind: "prompt", text };
}

function coerceMessageText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (
    content
    && typeof content === "object"
    && "content" in content
    && typeof content.content === "string"
  ) {
    return content.content;
  }

  if (content == null) {
    return "";
  }

  try {
    return JSON.stringify(content, (_, value) => {
      return typeof value === "bigint" ? value.toString() : value;
    });
  } catch {
    return String(content);
  }
}
