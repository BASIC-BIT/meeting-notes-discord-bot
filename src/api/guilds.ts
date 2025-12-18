import express from "express";
import {
  clearServerContextService,
  fetchServerContext,
  setServerContext,
} from "../services/appContextService";
import {
  listAutoRecordSettings,
  removeAutoRecordSetting,
  saveAutoRecordSetting,
} from "../services/autorecordService";
import {
  ensureBotInGuild,
  ensureManageGuildWithUserToken,
} from "../services/guildAccessService";
import { answerQuestionService } from "../services/askService";
import { config } from "../services/configService";

type AuthedUser = {
  accessToken?: string;
  id?: string;
};

export function registerGuildRoutes(app: express.Express) {
  // Context routes
  app.get(
    "/api/guilds/:guildId/context",
    requireAuth,
    async (req, res): Promise<void> => {
      const guildId = req.params.guildId;
      const user = req.user as AuthedUser;
      if (!(await ensureManageGuildWithUserToken(user.accessToken, guildId))) {
        res.status(403).json({ error: "Manage Guild required" });
        return;
      }
      if (!(await ensureBotInGuild(guildId))) {
        res.status(400).json({ error: "Bot is not in that guild" });
        return;
      }
      const ctx = await fetchServerContext(guildId);
      res.json({ context: ctx?.context ?? "" });
    },
  );

  app.post(
    "/api/guilds/:guildId/context",
    requireAuth,
    async (req, res): Promise<void> => {
      const guildId = req.params.guildId;
      const user = req.user as AuthedUser & { id: string };
      if (!(await ensureManageGuildWithUserToken(user.accessToken, guildId))) {
        res.status(403).json({ error: "Manage Guild required" });
        return;
      }
      const { context } = req.body as { context?: string };
      if (!context) {
        res.status(400).json({ error: "context is required" });
        return;
      }
      await setServerContext(guildId, user.id, context);
      res.json({ ok: true });
    },
  );

  app.delete(
    "/api/guilds/:guildId/context",
    requireAuth,
    async (req, res): Promise<void> => {
      const guildId = req.params.guildId;
      const user = req.user as AuthedUser;
      if (!(await ensureManageGuildWithUserToken(user.accessToken, guildId))) {
        res.status(403).json({ error: "Manage Guild required" });
        return;
      }
      await clearServerContextService(guildId);
      res.json({ ok: true });
    },
  );

  // Autorecord routes
  app.get(
    "/api/guilds/:guildId/autorecord",
    requireAuth,
    async (req, res): Promise<void> => {
      const guildId = req.params.guildId;
      const user = req.user as AuthedUser & { id: string };
      if (!(await ensureManageGuildWithUserToken(user.accessToken, guildId))) {
        res.status(403).json({ error: "Manage Guild required" });
        return;
      }
      const rules = await listAutoRecordSettings(guildId);
      res.json({ rules });
    },
  );

  app.post(
    "/api/guilds/:guildId/autorecord",
    requireAuth,
    async (req, res): Promise<void> => {
      const guildId = req.params.guildId;
      const user = req.user as AuthedUser & { id: string };
      if (!(await ensureManageGuildWithUserToken(user.accessToken, guildId))) {
        res.status(403).json({ error: "Manage Guild required" });
        return;
      }
      const { mode, voiceChannelId, textChannelId, tags } = req.body as {
        mode: "one" | "all";
        voiceChannelId?: string;
        textChannelId?: string;
        tags?: string[];
      };
      if (!textChannelId) {
        res.status(400).json({ error: "textChannelId is required" });
        return;
      }
      if (mode === "one" && !voiceChannelId) {
        res.status(400).json({ error: "voiceChannelId required for mode=one" });
        return;
      }
      const rule = await saveAutoRecordSetting({
        guildId,
        channelId: mode === "all" ? "ALL" : voiceChannelId!,
        textChannelId,
        enabled: true,
        recordAll: mode === "all",
        createdBy: user.id,
        tags,
      });
      res.json({ rule });
    },
  );

  app.delete(
    "/api/guilds/:guildId/autorecord",
    requireAuth,
    async (req, res): Promise<void> => {
      const guildId = req.params.guildId;
      const user = req.user as AuthedUser;
      if (!(await ensureManageGuildWithUserToken(user.accessToken, guildId))) {
        res.status(403).json({ error: "Manage Guild required" });
        return;
      }
      const { channelId } = req.body as { channelId?: string };
      if (!channelId) {
        res.status(400).json({ error: "channelId is required" });
        return;
      }
      await removeAutoRecordSetting(guildId, channelId);
      res.json({ ok: true });
    },
  );

  // Ask route
  app.post(
    "/api/guilds/:guildId/ask",
    requireAuth,
    async (req, res): Promise<void> => {
      const guildId = req.params.guildId;
      const user = req.user as AuthedUser;
      if (!user?.accessToken) {
        res.status(401).json({ error: "No access token. Please re-login." });
        return;
      }
      if (!(await ensureManageGuildWithUserToken(user.accessToken, guildId))) {
        res.status(403).json({ error: "Manage Guild required" });
        return;
      }
      const { question, tags, scope, channelId } = req.body as {
        question?: string;
        tags?: string[];
        scope?: "guild" | "channel";
        channelId?: string;
      };
      if (!question) {
        res.status(400).json({ error: "question is required" });
        return;
      }
      const { answer } = await answerQuestionService({
        guildId,
        channelId: channelId || "",
        question,
        tags,
        scope,
      });
      res.json({ answer });
    },
  );

  // Guild list (manage-guild intersection)
  app.get("/api/guilds", requireAuth, async (req, res): Promise<void> => {
    const user = req.user as AuthedUser;
    if (!user.accessToken) {
      res.status(401).json({ error: "No access token. Please re-login." });
      return;
    }
    try {
      const userGuildsResp = await fetch(
        "https://discord.com/api/users/@me/guilds",
        {
          headers: { Authorization: `Bearer ${user.accessToken}` },
        },
      );
      if (!userGuildsResp.ok) {
        res.status(500).json({ error: "Unable to fetch user guilds" });
        return;
      }
      const userGuilds = (await userGuildsResp.json()) as Array<{
        id: string;
        name: string;
        icon?: string;
        permissions: string;
      }>;

      const botGuildsResp = await fetch(
        "https://discord.com/api/users/@me/guilds",
        {
          headers: { Authorization: `Bot ${config.discord.botToken}` },
        },
      );
      if (!botGuildsResp.ok) {
        res.status(500).json({ error: "Unable to fetch bot guilds" });
        return;
      }
      const botGuilds = (await botGuildsResp.json()) as Array<{ id: string }>;
      const botGuildIds = new Set(botGuilds.map((g) => g.id));

      const MANAGE_GUILD = 1 << 5;
      const ADMIN = 1 << 3;

      const eligible = userGuilds
        .filter((g) => botGuildIds.has(g.id))
        .filter((g) => {
          const perms = BigInt(g.permissions);
          return (
            (perms & BigInt(MANAGE_GUILD)) !== BigInt(0) ||
            (perms & BigInt(ADMIN)) !== BigInt(0)
          );
        })
        .map((g) => ({
          id: g.id,
          name: g.name,
          icon: g.icon,
        }));

      res.json({ guilds: eligible });
    } catch (err) {
      console.error("Guild list error", err);
      res.status(500).json({ error: "Failed to load guilds" });
    }
  });
}

function requireAuth(
  req: express.Request & { isAuthenticated?: () => boolean },
  res: express.Response,
  next: express.NextFunction,
): void {
  if (req.isAuthenticated && req.isAuthenticated()) {
    next();
    return;
  }
  res.status(401).json({ error: "Not authenticated" });
}
