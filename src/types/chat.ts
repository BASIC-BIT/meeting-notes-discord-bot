import { Participant } from "./participants";

export type ChatEntryType = "message" | "join" | "leave";

export interface ChatEntry {
  type: ChatEntryType;
  user: Participant;
  channelId: string;
  content?: string;
  timestamp: string; // ISO string
}
