import { config } from "./configService";
import type { MeetingHistory } from "../types/db";

export type MeetingCleanupNotifier = {
  notifyCleanup: (meeting: MeetingHistory, reason: string) => Promise<void>;
};

type DiscordMessagePayload = {
  content?: string;
  embeds?: Array<Record<string, unknown>>;
};

type DiscordChannelResponse = {
  id: string;
};

const buildHeaders = () => ({
  Authorization: `Bot ${config.discord.botToken}`,
  "Content-Type": "application/json",
});

export async function sendDiscordMessage(
  channelId: string,
  payload: DiscordMessagePayload,
): Promise<void> {
  const resp = await fetch(
    `https://discord.com/api/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    },
  );
  if (!resp.ok) {
    throw new Error(`Discord message send failed (${resp.status})`);
  }
}

export async function createDmChannel(userId: string): Promise<string> {
  const resp = await fetch("https://discord.com/api/users/@me/channels", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!resp.ok) {
    throw new Error(`Discord DM channel creation failed (${resp.status})`);
  }
  const data = (await resp.json()) as DiscordChannelResponse;
  return data.id;
}

const resolveMeetingLabel = (meeting: MeetingHistory) => {
  const meetingName = meeting.meetingName?.trim();
  if (meetingName) return meetingName;
  const summaryLabel = meeting.summaryLabel?.trim();
  if (summaryLabel) return summaryLabel;
  return `Meeting ${meeting.meetingId}`;
};

class DiscordCleanupNotifier implements MeetingCleanupNotifier {
  async notifyCleanup(meeting: MeetingHistory, reason: string): Promise<void> {
    const content = [
      "Chronote marked a meeting as failed during cleanup because it appeared stuck.",
      `Meeting: ${resolveMeetingLabel(meeting)}`,
      `Meeting ID: ${meeting.meetingId}`,
      `Reason: ${reason}`,
    ].join("\n");

    if (meeting.textChannelId) {
      await sendDiscordMessage(meeting.textChannelId, { content });
      return;
    }

    if (!meeting.meetingCreatorId) {
      return;
    }

    const dmChannelId = await createDmChannel(meeting.meetingCreatorId);
    await sendDiscordMessage(dmChannelId, { content });
  }
}

class CompositeCleanupNotifier implements MeetingCleanupNotifier {
  constructor(private readonly notifiers: MeetingCleanupNotifier[]) {}

  async notifyCleanup(meeting: MeetingHistory, reason: string): Promise<void> {
    for (const notifier of this.notifiers) {
      await notifier.notifyCleanup(meeting, reason);
    }
  }
}

export const buildMeetingCleanupNotifier = (): MeetingCleanupNotifier => {
  const notifiers: MeetingCleanupNotifier[] = [];
  if (process.env.MEETING_CLEANUP_NOTIFY_DISCORD !== "false") {
    notifiers.push(new DiscordCleanupNotifier());
  }
  return new CompositeCleanupNotifier(notifiers);
};
