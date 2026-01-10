import { TRPCError } from "@trpc/server";
import {
  ensureManageGuildWithUserToken,
  type GuildSessionCache,
} from "../services/guildAccessService";

export const PERMISSION_REASONS = {
  manageGuildRequired: "MANAGE_GUILD_REQUIRED",
  discordRateLimited: "DISCORD_RATE_LIMIT",
  guildIdRequired: "GUILD_ID_REQUIRED",
  guildMemberRequired: "GUILD_MEMBER_REQUIRED",
  askMembersDisabled: "ASK_MEMBERS_DISABLED",
  askSharingDisabled: "ASK_SHARING_DISABLED",
  superAdminRequired: "SUPER_ADMIN_REQUIRED",
} as const;

export type PermissionReason =
  (typeof PERMISSION_REASONS)[keyof typeof PERMISSION_REASONS];

const toPermissionError = (params: {
  code: "FORBIDDEN" | "TOO_MANY_REQUESTS" | "BAD_REQUEST";
  message: string;
  reason: PermissionReason;
}) =>
  new TRPCError({
    code: params.code,
    message: params.message,
    cause: { reason: params.reason },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasStringProp = (
  value: unknown,
  key: "serverId" | "guildId",
): value is Record<typeof key, string> => {
  if (!isRecord(value)) return false;
  const prop = value[key];
  return typeof prop === "string" && prop.length > 0;
};

export const getGuildIdFromInput = (input: unknown): string | null => {
  if (hasStringProp(input, "serverId")) return input.serverId;
  if (hasStringProp(input, "guildId")) return input.guildId;
  return null;
};

export const requireManageGuild = async (params: {
  accessToken?: string;
  guildId: string;
  userId?: string;
  session?: GuildSessionCache;
}) => {
  const allowed = await ensureManageGuildWithUserToken(
    params.accessToken,
    params.guildId,
    { userId: params.userId, session: params.session },
  );
  if (allowed === null) {
    throw toPermissionError({
      code: "TOO_MANY_REQUESTS",
      message: "Discord rate limited. Please retry.",
      reason: PERMISSION_REASONS.discordRateLimited,
    });
  }
  if (!allowed) {
    throw toPermissionError({
      code: "FORBIDDEN",
      message: "Manage Guild required",
      reason: PERMISSION_REASONS.manageGuildRequired,
    });
  }
};

export const requireGuildId = (input: unknown): string => {
  const guildId = getGuildIdFromInput(input);
  if (!guildId) {
    throw toPermissionError({
      code: "BAD_REQUEST",
      message: "serverId required",
      reason: PERMISSION_REASONS.guildIdRequired,
    });
  }
  return guildId;
};

const permissionReasonSet = new Set<string>(Object.values(PERMISSION_REASONS));

export const getPermissionReason = (
  cause: unknown,
): PermissionReason | null => {
  if (!isRecord(cause)) return null;
  const reason = cause.reason;
  if (typeof reason !== "string") return null;
  return permissionReasonSet.has(reason) ? (reason as PermissionReason) : null;
};
