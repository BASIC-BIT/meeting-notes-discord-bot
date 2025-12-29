import { Participant } from "./participants";

export type ChatEntryType = "message" | "join" | "leave";
export type ChatEntrySource = "chat" | "chat_tts";

export interface ChatEntry {
  type: ChatEntryType;
  source?: ChatEntrySource;
  user: Participant;
  channelId: string;
  content?: string;
  messageId?: string;
  timestamp: string; // ISO string
}
