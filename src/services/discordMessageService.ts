import { config } from "./configService";

type DiscordMessage = {
  id: string;
  embeds?: Array<Record<string, unknown>>;
};

const buildHeaders = () => ({
  Authorization: `Bot ${config.discord.botToken}`,
  "Content-Type": "application/json",
});

export async function fetchDiscordMessage(
  channelId: string,
  messageId: string,
): Promise<DiscordMessage | null> {
  const resp = await fetch(
    `https://discord.com/api/channels/${channelId}/messages/${messageId}`,
    { headers: buildHeaders() },
  );
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`Discord message fetch failed (${resp.status})`);
  }
  return (await resp.json()) as DiscordMessage;
}

export async function updateDiscordMessageEmbeds(
  channelId: string,
  messageId: string,
  embeds: Array<Record<string, unknown>>,
): Promise<boolean> {
  const resp = await fetch(
    `https://discord.com/api/channels/${channelId}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify({ embeds }),
    },
  );
  if (resp.status === 404) return false;
  if (!resp.ok) {
    throw new Error(`Discord message update failed (${resp.status})`);
  }
  return true;
}
