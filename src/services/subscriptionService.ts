import { getRecentMeetingsForGuild, getGuildSubscription } from "../db";
import { config } from "./configService";

export type Tier = "free" | "basic";

export interface TierLimits {
  maxMeetingsPerDayPerGuild?: number;
  maxMeetingDurationMs?: number;
  maxMeetingDurationPretty?: string;
  maxAskMeetings?: number;
  liveVoiceEnabled: boolean;
  imagesEnabled: boolean;
}

export interface ResolvedSubscription {
  tier: Tier;
  status: string; // raw Stripe status or "free"
  source: "stripe" | "forced" | "default";
}

const DEFAULT_LIMITS: Record<Tier, TierLimits> = {
  free: {
    maxMeetingsPerDayPerGuild: 3,
    maxMeetingDurationMs: 90 * 60 * 1000, // 90 minutes
    maxMeetingDurationPretty: "90 minutes",
    maxAskMeetings: 5,
    liveVoiceEnabled: false,
    imagesEnabled: false,
  },
  basic: {
    maxMeetingsPerDayPerGuild: undefined,
    maxMeetingDurationMs: 7_200_000,
    maxMeetingDurationPretty: "2 hours",
    maxAskMeetings: 25,
    liveVoiceEnabled: true,
    imagesEnabled: true,
  },
};

type CacheEntry = { sub: ResolvedSubscription; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function isCacheValid(entry?: CacheEntry) {
  return !!entry && entry.expiresAt > Date.now();
}

export function getLimitsForTier(tier: Tier): TierLimits {
  return DEFAULT_LIMITS[tier];
}

export async function resolveGuildSubscription(
  guildId: string,
): Promise<ResolvedSubscription> {
  const forced = config.subscription.forceTier;
  if (forced === "free" || forced === "basic") {
    return { tier: forced, status: forced, source: "forced" };
  }

  const cached = cache.get(guildId);
  if (isCacheValid(cached)) return cached!.sub;

  // If Stripe is disabled, everyone is free
  if (
    !config.stripe.secretKey ||
    config.subscription.stripeMode === "disabled"
  ) {
    const sub: ResolvedSubscription = {
      tier: "free",
      status: "free",
      source: "default",
    };
    cache.set(guildId, { sub, expiresAt: Date.now() + CACHE_TTL_MS });
    return sub;
  }

  const subscription = await getGuildSubscription(guildId);
  const status = subscription?.status || "free";
  const paidStatuses = new Set(["active", "trialing", "past_due"]);
  const tier: Tier = paidStatuses.has(status) ? "basic" : "free";

  const sub: ResolvedSubscription = {
    tier,
    status,
    source: "stripe",
  };
  cache.set(guildId, { sub, expiresAt: Date.now() + CACHE_TTL_MS });
  return sub;
}

export async function getGuildLimits(guildId: string | null): Promise<{
  subscription: ResolvedSubscription;
  limits: TierLimits;
}> {
  if (!guildId) {
    return {
      subscription: { tier: "free", status: "free", source: "default" },
      limits: DEFAULT_LIMITS.free,
    };
  }
  const subscription = await resolveGuildSubscription(guildId);
  const limits = getLimitsForTier(subscription.tier);
  return { subscription, limits };
}

export async function getTodayMeetingCount(
  guildId: string,
  lookback: number,
): Promise<number> {
  const recent = await getRecentMeetingsForGuild(
    guildId,
    Math.max(lookback, 10),
  );
  const now = new Date();
  const startOfDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
  return recent.filter((m) => {
    if (!m.timestamp) return false;
    const ts = Date.parse(m.timestamp);
    return ts >= startOfDay && ts < endOfDay;
  }).length;
}
