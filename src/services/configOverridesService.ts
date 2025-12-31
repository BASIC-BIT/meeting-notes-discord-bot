import { getConfigOverridesRepository } from "../repositories/configOverridesRepository";
import type { ConfigOverrideRecord } from "../types/db";
import type { ConfigScope } from "../config/types";
import { nowIso } from "../utils/time";

export type ConfigOverrideScopeContext = {
  scope: ConfigScope;
  guildId?: string;
  channelId?: string;
  userId?: string;
  meetingId?: string;
};

export function buildScopeId(context: ConfigOverrideScopeContext): string {
  const { scope } = context;
  if (scope === "global") {
    return "global#default";
  }
  if (scope === "server") {
    if (!context.guildId) {
      throw new Error("guildId is required for server scope.");
    }
    return `server#${context.guildId}`;
  }
  if (scope === "channel") {
    if (!context.guildId || !context.channelId) {
      throw new Error("guildId and channelId are required for channel scope.");
    }
    return `channel#${context.guildId}#${context.channelId}`;
  }
  if (scope === "user") {
    if (!context.guildId || !context.userId) {
      throw new Error("guildId and userId are required for user scope.");
    }
    return `user#${context.guildId}#${context.userId}`;
  }
  if (scope === "meeting") {
    if (!context.meetingId) {
      throw new Error("meetingId is required for meeting scope.");
    }
    return `meeting#${context.meetingId}`;
  }
  return "global#default";
}

export async function listConfigOverridesForScope(
  context: ConfigOverrideScopeContext,
): Promise<ConfigOverrideRecord[]> {
  const scopeId = buildScopeId(context);
  return getConfigOverridesRepository().listByScope(scopeId);
}

export async function getConfigOverrideForScope(
  context: ConfigOverrideScopeContext,
  configKey: string,
): Promise<ConfigOverrideRecord | undefined> {
  const scopeId = buildScopeId(context);
  return getConfigOverridesRepository().get(scopeId, configKey);
}

export async function setConfigOverrideForScope(
  context: ConfigOverrideScopeContext,
  configKey: string,
  value: unknown,
  userId: string,
): Promise<void> {
  const scopeId = buildScopeId(context);
  const record: ConfigOverrideRecord = {
    scopeId,
    configKey,
    value,
    updatedAt: nowIso(),
    updatedBy: userId,
  };
  await getConfigOverridesRepository().write(record);
}

export async function clearConfigOverrideForScope(
  context: ConfigOverrideScopeContext,
  configKey: string,
): Promise<void> {
  const scopeId = buildScopeId(context);
  await getConfigOverridesRepository().remove(scopeId, configKey);
}
