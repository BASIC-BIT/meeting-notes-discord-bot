import express from "express";
import { getMeeting } from "../meetings";
import { ensureUserInGuild } from "../services/guildAccessService";
import { ensureUserCanConnectChannel } from "../services/discordPermissionsService";
import {
  buildLiveMeetingMeta,
  buildLiveMeetingSegments,
} from "../services/liveMeetingService";
import type { AuthedProfile } from "../trpc/context";
import type {
  LiveMeetingInitPayload,
  LiveMeetingSegmentsPayload,
  LiveMeetingStatusPayload,
} from "../types/liveMeeting";

type SessionGuildCache = {
  guildIds?: string[];
  guildIdsFetchedAt?: number;
};

const GUILD_CACHE_TTL_MS = 60_000;

export function registerLiveMeetingRoutes(app: express.Express) {
  app.get(
    "/api/live/:guildId/:meetingId/stream",
    requireAuth,
    async (req, res): Promise<void> => {
      const user = req.user as AuthedProfile;
      const { guildId, meetingId } = req.params;
      const meeting = getMeeting(guildId);
      if (!meeting || meeting.meetingId !== meetingId) {
        res.status(404).json({ error: "Meeting not found" });
        return;
      }
      const sessionData = req.session as typeof req.session & SessionGuildCache;
      const cacheAgeMs =
        sessionData.guildIdsFetchedAt != null
          ? Date.now() - sessionData.guildIdsFetchedAt
          : Number.POSITIVE_INFINITY;
      const cacheFresh = cacheAgeMs < GUILD_CACHE_TTL_MS;
      const cachedGuilds = sessionData.guildIds ?? [];
      const cachedHasGuild = cacheFresh && cachedGuilds.includes(guildId);
      if (!cachedHasGuild) {
        const inGuild = await ensureUserInGuild(user.accessToken, guildId);
        if (inGuild === null) {
          res
            .status(429)
            .json({ error: "Discord rate limited. Please retry." });
          return;
        }
        if (!inGuild) {
          res.status(403).json({ error: "Guild access required" });
          return;
        }
        sessionData.guildIds = Array.from(
          new Set([...(sessionData.guildIds ?? []), guildId]),
        );
        sessionData.guildIdsFetchedAt = Date.now();
      }
      const canConnect = await ensureUserCanConnectChannel({
        guildId,
        channelId: meeting.voiceChannel.id,
        userId: user.id,
      });
      if (canConnect === null) {
        res.status(429).json({ error: "Discord rate limited. Please retry." });
        return;
      }
      if (!canConnect) {
        res.status(403).json({ error: "Channel access required" });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      req.socket.setTimeout(0);

      const seen = new Set<string>();

      const sendEvent = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const emitSegments = (
        segments: ReturnType<typeof buildLiveMeetingSegments>,
      ) => {
        const fresh = segments.filter((segment) => {
          if (seen.has(segment.id)) return false;
          seen.add(segment.id);
          return true;
        });
        if (fresh.length === 0) return;
        const payload: LiveMeetingSegmentsPayload = { segments: fresh };
        sendEvent("segments", payload);
      };

      const initPayload: LiveMeetingInitPayload = {
        meeting: buildLiveMeetingMeta(meeting),
        segments: [],
      };
      const initialSegments = buildLiveMeetingSegments(meeting);
      for (const segment of initialSegments) {
        seen.add(segment.id);
      }
      initPayload.segments = initialSegments;
      sendEvent("init", initPayload);

      const tick = () => {
        emitSegments(buildLiveMeetingSegments(meeting));
        if (meeting.finished) {
          const payload: LiveMeetingStatusPayload = {
            status: "complete",
            endedAt: meeting.endTime?.toISOString(),
          };
          sendEvent("status", payload);
          cleanup();
        }
      };

      const interval = setInterval(tick, 2000);
      const ping = setInterval(() => {
        res.write(": ping\n\n");
      }, 15000);

      const cleanup = () => {
        clearInterval(interval);
        clearInterval(ping);
        res.end();
      };

      req.on("close", cleanup);
    },
  );
}

function requireAuth(
  req: express.Request & { isAuthenticated?: () => boolean },
  res: express.Response,
  next: express.NextFunction,
): void {
  if (req.isAuthenticated?.()) {
    next();
    return;
  }
  res.status(401).json({ error: "Not authenticated" });
}
