export type AskMessageRole = "user" | "chronote";

export interface AskConversation {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface AskMessage {
  id: string;
  role: AskMessageRole;
  text: string;
  createdAt: string;
  sourceMeetingIds?: string[];
}
