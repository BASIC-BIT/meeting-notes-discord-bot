import { ChatEntry } from "../types/chat";

export function renderChatEntryLine(entry: ChatEntry): string {
  const name =
    entry.user.nickname ||
    entry.user.globalName ||
    entry.user.tag ||
    entry.user.id;
  const time = new Date(entry.timestamp).toLocaleString();

  if (entry.type === "message") {
    return `[${name} @ ${time}]: ${entry.content ?? ""}`;
  }

  const action = entry.type === "join" ? "joined" : "left";
  return `[${name}] ${action} the channel at ${time}`;
}
