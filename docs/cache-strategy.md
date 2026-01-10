# Cache strategy and Redis plan

## Goals

- Reduce Discord API pressure and rate limit risk.
- Share cache across processes and instances when Redis is enabled.
- Keep cache behavior predictable with TTLs, size limits, and explicit invalidation.

## Current implementation

- `async-cache-dedupe` provides single flight per key and TTL based caching.
- Cache storage is memory by default and switches to Redis when `REDIS_URL` is set.
- Discord reads are routed through cached wrappers in `src/services/discordCacheService.ts`.
- Session level caching still exists for quick per user lookups.

## Cache capabilities

- Single item cache and list cache entries with per entry TTLs.
- Tag based invalidation using references for guild and user scopes.
- Manual invalidation helpers for Discord caches:
  - `invalidateDiscordGuildCache(guildId)`
  - `invalidateDiscordUserCache(userId)`

## Key and reference patterns

- Key namespace examples:
  - `discord:userGuilds:{userKey}`
  - `discord:botGuilds`
  - `discord:guildChannels:{guildId}`
  - `discord:guildRoles:{guildId}`
  - `discord:guildMember:{guildId}:{userId}`
- Reference tags for invalidation:
  - `discord:guild:{guildId}`
  - `discord:guild:{guildId}:channels`
  - `discord:guild:{guildId}:roles`
  - `discord:guild:{guildId}:member:{userId}`
  - `discord:user:{userKey}`

## TTL guidance

- User guilds: 60 seconds.
- Bot guilds: 300 seconds.
- Roles and channels: 60 seconds.
- Members: 30 seconds.

## Mutation flow

- When we write to Discord or another external service, prefer updating cached entries after a successful response.
- If the updated object is returned, update the cache directly instead of invalidating.
- If no updated object is returned, invalidate relevant tags and allow the next read to refresh.

## Configuration

- `REDIS_URL` enables Redis caching. Leave it empty to stay in memory mode.
- `CACHE_ENABLED` can disable caching entirely.
- `CACHE_KEY_PREFIX` scopes keys between environments.
- `CACHE_MEMORY_SIZE` caps the in process cache size.
- `CACHE_DISCORD_*` envs tune TTLs per Discord cache.

## Local dev

- `docker-compose.yml` now includes a Redis service for local use.
- `REDIS_URL=redis://localhost:6379` works for a host running the bot.
- AWS Redis uses TLS, so the ECS task is configured with a `rediss://` URL.

## Next steps

- Add cached wrappers for Dynamo and LLM calls when needed.
- Introduce lightweight metrics for hit, miss, and dedupe counts.
