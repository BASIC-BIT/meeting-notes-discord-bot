export type AskMessageRole = "user" | "chronote";

export type AskConversationVisibility = "private" | "server" | "public";

export interface AskConversation {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  visibility?: AskConversationVisibility;
  sharedAt?: string;
  sharedByUserId?: string;
  sharedByTag?: string;
  archivedAt?: string;
  archivedByUserId?: string;
}

export interface AskMessage {
  id: string;
  role: AskMessageRole;
  text: string;
  createdAt: string;
  sourceMeetingIds?: string[];
}

export interface AskSharedConversation {
  conversationId: string;
  title: string;
  summary: string;
  updatedAt: string;
  sharedAt?: string;
  ownerUserId: string;
  ownerTag?: string;
  archivedAt?: string;
}
