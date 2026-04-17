export function snapshotMessageIds(task) {
  return new Set(readMessages(task).map((message) => String(message.id || "")));
}

export function collectNewOutput(task, previousMessageIds) {
  const newMessages = readMessages(task).filter((message) => !previousMessageIds.has(String(message.id || "")));
  const assistantText = joinMessageText(newMessages.filter((message) => message.role === "assistant"));
  if (assistantText) {
    return assistantText;
  }

  const toolText = joinMessageText(newMessages.filter((message) => message.kind === "tool"));
  if (toolText) {
    return toolText;
  }

  return "";
}

function readMessages(task) {
  return Array.isArray(task?.messages) ? task.messages : [];
}

function joinMessageText(messages) {
  return messages
    .map((message) => String(message?.text || "").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
