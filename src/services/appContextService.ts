import {
  deleteServerContext,
  getServerContext,
  writeServerContext,
} from "../db";
import { nowIso } from "../utils/time";

export async function setServerContext(
  guildId: string,
  userId: string,
  context: string,
) {
  await writeServerContext({
    guildId,
    context,
    updatedAt: nowIso(),
    updatedBy: userId,
  });
}

export async function clearServerContextService(guildId: string) {
  await deleteServerContext(guildId);
}

export async function fetchServerContext(guildId: string) {
  return getServerContext(guildId);
}
