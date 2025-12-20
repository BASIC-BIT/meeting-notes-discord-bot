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
  ensureUserInGuild,
} from "../services/guildAccessService";
import { answerQuestionService } from "../services/askService";
import { config } from "../services/configService";

type AuthedUser = {
  accessToken?: string;
  id?: string;
};

export function registerGuildRoutes(app: express.Express) {
  const ensureBotPresence = async (
    req: express.Request,
    res: express.Response,
    guildId: string,
  ): Promise<boolean> => {
    const sessionData = req.session as typeof req.session & {
      botGuildIds?: string[];
      botGuildIdsFetchedAt?: number;
    };
    const cachedBotGuilds = sessionData.botGuildIds;
    const cacheAgeMs =
      sessionData.botGuildIdsFetchedAt != null
        ? Date.now() - sessionData.botGuildIdsFetchedAt
        : Number.POSITIVE_INFINITY;
    const cacheFresh = cacheAgeMs < 5 * 60 * 1000;
    if (cacheFresh && Array.isArray(cachedBotGuilds)) {
      if (cachedBotGuilds.includes(guildId)) {
        return true;
      }
      res.status(400).json({ error: "Bot is not in that guild" });
      return false;
    }
    const botCheck = await ensureBotInGuild(guildId);
    if (botCheck === null) {
      res.status(429).json({ error: "Discord rate limited. Please retry." });
      return false;
    }
    if (!botCheck) {
      res.status(400).json({ error: "Bot is not in that guild" });
      return false;
    }
    sessionData.botGuildIds = Array.from(
      new Set([...(cachedBotGuilds ?? []), guildId]),
    );
    sessionData.botGuildIdsFetchedAt = Date.now();
    return true;
  };

  // Context routes
  app.get(
    "/api/guilds/:guildId/context",
    requireAuth,
    async (req, res): Promise<void> => {
      const guildId = req.params.guildId;
      const user = req.user as AuthedUser;
      if (!(await ensureManageGuildWithUserToken(user.accessToken, guildId))) {
        console.warn("Context 403: missing Manage Guild", {
          guildId,
          userId: user?.id,
        });
        res.status(403).json({ error: "Manage Guild required" });
        return;
      }
      if (!(await ensureBotPresence(req, res, guildId))) {
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
      if (!(await ensureBotPresence(req, res, guildId))) {
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
      if (!(await ensureBotPresence(req, res, guildId))) {
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

  // Channel list (text + voice)
  app.get(
    "/api/guilds/:guildId/channels",
    requireAuth,
    async (req, res): Promise<void> => {
      const guildId = req.params.guildId;
      const user = req.user as AuthedUser;
      if (!user?.accessToken) {
        res.status(401).json({ error: "No access token. Please re-login." });
        return;
      }
      const sessionData = req.session as typeof req.session & {
        guildIds?: string[];
        guildIdsFetchedAt?: number;
        botGuildIds?: string[];
        botGuildIdsFetchedAt?: number;
      };
      const cachedGuilds = sessionData.guildIds ?? [];
      const cachedHasGuild = cachedGuilds.includes(guildId);
      if (!cachedHasGuild) {
        const accessCheck = await ensureUserInGuild(user.accessToken, guildId);
        if (accessCheck === null) {
          res
            .status(429)
            .json({ error: "Discord rate limited. Please retry." });
          return;
        }
        if (!accessCheck) {
          console.warn("Channels 403: user not in guild", {
            guildId,
            userId: user?.id,
          });
          res.status(403).json({ error: "Guild access required" });
          return;
        }
      }
      if (!(await ensureBotPresence(req, res, guildId))) {
        return;
      }
      try {
        const resp = await fetch(
          `https://discord.com/api/guilds/${guildId}/channels`,
          {
            headers: { Authorization: `Bot ${config.discord.botToken}` },
          },
        );
        if (!resp.ok) {
          res.status(500).json({ error: "Unable to fetch guild channels" });
          return;
        }
        const channels = (await resp.json()) as Array<{
          id: string;
          name: string;
          type: number;
          position?: number;
        }>;
        const voiceTypes = new Set([2, 13]);
        const textTypes = new Set([0, 5]);
        const byPosition = (
          a: { position?: number },
          b: { position?: number },
        ) => (a.position ?? 0) - (b.position ?? 0);
        const voiceChannels = channels
          .filter((channel) => voiceTypes.has(channel.type))
          .sort(byPosition)
          .map((channel) => ({ id: channel.id, name: channel.name }));
        const textChannels = channels
          .filter((channel) => textTypes.has(channel.type))
          .sort(byPosition)
          .map((channel) => ({ id: channel.id, name: channel.name }));
        res.json({ voiceChannels, textChannels });
      } catch (err) {
        console.error("Channel list error", err);
        res.status(500).json({ error: "Failed to load guild channels" });
      }
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
        owner?: boolean;
      }>;

      const sessionData = req.session as typeof req.session & {
        guildIds?: string[];
        guildIdsFetchedAt?: number;
        botGuildIds?: string[];
        botGuildIdsFetchedAt?: number;
      };
      sessionData.guildIds = userGuilds.map((guild) => guild.id);
      sessionData.guildIdsFetchedAt = Date.now();

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
      sessionData.botGuildIds = botGuilds.map((guild) => guild.id);
      sessionData.botGuildIdsFetchedAt = Date.now();

      const MANAGE_GUILD = 1 << 5;
      const ADMIN = 1 << 3;

      const eligible = userGuilds
        .filter((g) => botGuildIds.has(g.id))
        .filter((g) => {
          const perms = BigInt(g.permissions);
          return (
            g.owner ||
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
