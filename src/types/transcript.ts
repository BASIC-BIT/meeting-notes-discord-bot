export type TranscriptSegmentSource = "voice" | "chat_tts" | "bot";

export type TranscriptSegment = {
  userId: string;
  username?: string;
  displayName?: string;
  serverNickname?: string;
  tag?: string;
  startedAt: string;
  text?: string;
  source?: TranscriptSegmentSource;
  messageId?: string;
};

export type TranscriptPayload = {
  generatedAt?: string;
  segments?: TranscriptSegment[];
  text?: string;
};
