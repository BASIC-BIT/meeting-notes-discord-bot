import { ChatEntry } from "../types/chat";
import { formatParticipantLabel } from "./participants";

export function renderChatEntryLine(entry: ChatEntry): string {
  const name = formatParticipantLabel(entry.user, { includeUsername: true });
  const time = new Date(entry.timestamp).toLocaleString();

  if (entry.type === "message") {
    return `[${name} @ ${time}]: ${entry.content ?? ""}`;
  }

  const action = entry.type === "join" ? "joined" : "left";
  return `[${name}] ${action} the channel at ${time}`;
}
