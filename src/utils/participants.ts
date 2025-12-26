import { Guild, GuildMember, User } from "discord.js";
import { Participant } from "../types/participants";

export async function buildParticipantSnapshot(
  guild: Guild,
  userId: string,
): Promise<Participant | undefined> {
  try {
    const member =
      guild.members.cache.get(userId) || (await guild.members.fetch(userId));
    return fromMember(member);
  } catch (error) {
    // Fallback to user cache if member fetch fails (e.g., user left)
    const user = guild.client.users.cache.get(userId);
    if (user) {
      return fromUser(user);
    }
    console.warn(`Could not resolve participant for userId=${userId}`, error);
    return undefined;
  }
}

export function getParticipantPreferredName(
  participant?: Participant,
  fallback?: string,
): string | undefined {
  return (
    participant?.serverNickname ||
    participant?.displayName ||
    participant?.username ||
    participant?.tag ||
    fallback
  );
}

export function getParticipantUsername(
  participant?: Participant,
  fallback?: string,
): string | undefined {
  return participant?.username || participant?.tag || fallback;
}

export function formatParticipantLabel(
  participant?: Participant,
  options?: {
    includeUsername?: boolean;
    fallbackName?: string;
    fallbackUsername?: string;
  },
): string {
  const name = getParticipantPreferredName(participant, options?.fallbackName);
  const username = getParticipantUsername(
    participant,
    options?.fallbackUsername,
  );
  if (options?.includeUsername && username) {
    const handle = username.startsWith("@") ? username.slice(1) : username;
    if (name && handle && name.toLowerCase() !== handle.toLowerCase()) {
      return `${name} (@${handle})`;
    }
    return name ?? `@${handle}`;
  }
  return name ?? username ?? "Unknown";
}

export function fromMember(member: GuildMember): Participant {
  return {
    id: member.user.id,
    username: member.user.username,
    displayName: member.user.globalName ?? undefined,
    serverNickname: member.nickname ?? undefined,
    tag: member.user.tag,
  };
}

export function fromUser(user: User): Participant {
  return {
    id: user.id,
    username: user.username,
    displayName: user.globalName ?? undefined,
    tag: user.tag,
  };
}
