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

export function fromMember(member: GuildMember): Participant {
  return {
    id: member.user.id,
    tag: member.user.tag,
    nickname: member.nickname ?? member.displayName ?? undefined,
    globalName: member.user.globalName ?? undefined,
  };
}

export function fromUser(user: User): Participant {
  return {
    id: user.id,
    tag: user.tag,
    globalName: user.globalName ?? undefined,
  };
}
