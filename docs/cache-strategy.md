# Caching strategy, Redis plan

## Goals

- Reduce Discord API pressure and rate limit risk.
- Share cache across processes and instances.
- Keep cache behavior predictable with TTLs and size limits.

## Scope

- Discord data: user guilds, bot guilds, guild roles, guild channels, guild members.
- Application data that is derived from or adjacent to Discord data.

## Proposed Redis layers

- **Shared cache:** Redis as the primary cache with per key TTLs.
- **In-process hot cache:** small LRU for per request burst smoothing.
- **In-flight de-duplication:** single flight per key for high fan-out requests.

## Key namespaces

- `discord:userGuilds:{userId}`
- `discord:botGuilds`
- `discord:guildRoles:{guildId}`
- `discord:guildChannels:{guildId}`
- `discord:guildMember:{guildId}:{userId}`
- `discord:manageGuild:{guildId}:{userId}`

## TTL guidance

- User guilds: 60 seconds.
- Bot guilds: 5 minutes.
- Roles and channels: 60 seconds.
- Members and manage checks: 30 to 60 seconds.

## Invalidation

- Prefer TTL driven expiry for Discord data.
- For app authored writes, update caches after the write completes.

## Observability

- Track cache hit and miss rates, and measure rate limit responses over time.
- Log slow upstream calls and count in-flight de-duplication wins.

## Rollout notes

- Add Redis locally in docker-compose and in AWS managed service.
- Introduce a cache interface that can be backed by memory or Redis.
- Migrate existing caches behind the interface in small batches.
