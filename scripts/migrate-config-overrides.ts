import {
  scanAutoRecordSettings,
  scanChannelContexts,
  scanServerContexts,
} from "../src/db";
import { getConfigOverridesRepository } from "../src/repositories/configOverridesRepository";
import type {
  AutoRecordSettings,
  ChannelContext,
  ConfigOverrideRecord,
  ServerContext,
} from "../src/types/db";
import { normalizeTags } from "../src/utils/tags";
import { nowIso } from "../src/utils/time";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const guildArgIndex = args.indexOf("--guild");
const guildFilter = guildArgIndex >= 0 ? args[guildArgIndex + 1] : undefined;

const repo = getConfigOverridesRepository();

const scopeIdForServer = (guildId: string) => `server#${guildId}`;
const scopeIdForChannel = (guildId: string, channelId: string) =>
  `channel#${guildId}#${channelId}`;

const SERVER_KEYS = {
  context: "context.instructions",
  defaultNotesChannelId: "notes.channelId",
  defaultTags: "notes.tags",
  liveVoiceEnabled: "liveVoice.enabled",
  liveVoiceCommandsEnabled: "liveVoice.commands.enabled",
  liveVoiceTtsVoice: "liveVoice.ttsVoice",
  chatTtsEnabled: "chatTts.enabled",
  chatTtsVoice: "chatTts.voice",
  askMembersEnabled: "ask.members.enabled",
  askSharingPolicy: "ask.sharing.policy",
  experimentalEnabled: "features.experimental",
  autoRecordEnabled: "autorecord.enabled",
} as const;

const CHANNEL_KEYS = {
  context: "context.instructions",
  liveVoiceEnabled: "liveVoice.enabled",
  liveVoiceCommandsEnabled: "liveVoice.commands.enabled",
  chatTtsEnabled: "chatTts.enabled",
} as const;

const AUTO_RECORD_KEYS = {
  enabled: "autorecord.enabled",
  notesChannelId: "notes.channelId",
  notesTags: "notes.tags",
} as const;

const REQUIRED_SERVER_DEFAULTS: Array<{ key: string; value: unknown }> = [
  { key: SERVER_KEYS.experimentalEnabled, value: false },
  { key: SERVER_KEYS.autoRecordEnabled, value: false },
  { key: SERVER_KEYS.liveVoiceEnabled, value: false },
  { key: SERVER_KEYS.liveVoiceCommandsEnabled, value: false },
  { key: SERVER_KEYS.chatTtsEnabled, value: false },
  { key: SERVER_KEYS.askMembersEnabled, value: true },
  { key: SERVER_KEYS.askSharingPolicy, value: "server" },
];

const shouldProcessGuild = (guildId: string) =>
  !guildFilter || guildId === guildFilter;

const stats = {
  planned: 0,
  skipped: 0,
  written: 0,
};

const writeOverride = async (
  record: ConfigOverrideRecord,
  options: { skipIfExists?: boolean } = {},
) => {
  const skipIfExists = options.skipIfExists ?? true;
  if (skipIfExists) {
    const existing = await repo.get(record.scopeId, record.configKey);
    if (existing) {
      stats.skipped += 1;
      console.log(
        `skip existing ${record.scopeId} ${record.configKey} -> ${JSON.stringify(
          existing.value,
        )}`,
      );
      return;
    }
  }
  stats.planned += 1;
  if (!apply) {
    console.log(
      `plan ${record.scopeId} ${record.configKey} = ${JSON.stringify(
        record.value,
      )}`,
    );
    return;
  }
  await repo.write(record);
  stats.written += 1;
  console.log(
    `write ${record.scopeId} ${record.configKey} = ${JSON.stringify(
      record.value,
    )}`,
  );
};

const migrateServerContext = async (context: ServerContext) => {
  if (!shouldProcessGuild(context.guildId)) return;
  const scopeId = scopeIdForServer(context.guildId);
  const updatedAt = context.updatedAt;
  const updatedBy = context.updatedBy;

  if (context.context?.trim()) {
    await writeOverride({
      scopeId,
      configKey: SERVER_KEYS.context,
      value: context.context.trim(),
      updatedAt,
      updatedBy,
    });
  }

  if (context.defaultNotesChannelId) {
    await writeOverride({
      scopeId,
      configKey: SERVER_KEYS.defaultNotesChannelId,
      value: context.defaultNotesChannelId,
      updatedAt,
      updatedBy,
    });
  }

  if (context.defaultTags && context.defaultTags.length > 0) {
    const normalized = normalizeTags(context.defaultTags);
    if (normalized) {
      await writeOverride({
        scopeId,
        configKey: SERVER_KEYS.defaultTags,
        value: normalized.join(", "),
        updatedAt,
        updatedBy,
      });
    }
  }

  if (context.liveVoiceEnabled !== undefined) {
    await writeOverride({
      scopeId,
      configKey: SERVER_KEYS.liveVoiceEnabled,
      value: context.liveVoiceEnabled,
      updatedAt,
      updatedBy,
    });
  }

  if (context.liveVoiceCommandsEnabled !== undefined) {
    await writeOverride({
      scopeId,
      configKey: SERVER_KEYS.liveVoiceCommandsEnabled,
      value: context.liveVoiceCommandsEnabled,
      updatedAt,
      updatedBy,
    });
  }

  if (context.liveVoiceTtsVoice) {
    await writeOverride({
      scopeId,
      configKey: SERVER_KEYS.liveVoiceTtsVoice,
      value: context.liveVoiceTtsVoice,
      updatedAt,
      updatedBy,
    });
  }

  if (context.chatTtsEnabled !== undefined) {
    await writeOverride({
      scopeId,
      configKey: SERVER_KEYS.chatTtsEnabled,
      value: context.chatTtsEnabled,
      updatedAt,
      updatedBy,
    });
  }

  if (context.chatTtsVoice) {
    await writeOverride({
      scopeId,
      configKey: SERVER_KEYS.chatTtsVoice,
      value: context.chatTtsVoice,
      updatedAt,
      updatedBy,
    });
  }

  if (context.askMembersEnabled !== undefined) {
    await writeOverride({
      scopeId,
      configKey: SERVER_KEYS.askMembersEnabled,
      value: context.askMembersEnabled,
      updatedAt,
      updatedBy,
    });
  }

  if (context.askSharingPolicy) {
    await writeOverride({
      scopeId,
      configKey: SERVER_KEYS.askSharingPolicy,
      value: context.askSharingPolicy,
      updatedAt,
      updatedBy,
    });
  }
};

const migrateChannelContext = async (context: ChannelContext) => {
  if (!shouldProcessGuild(context.guildId)) return;
  const scopeId = scopeIdForChannel(context.guildId, context.channelId);
  const updatedAt = context.updatedAt;
  const updatedBy = context.updatedBy;

  if (context.context?.trim()) {
    await writeOverride({
      scopeId,
      configKey: CHANNEL_KEYS.context,
      value: context.context.trim(),
      updatedAt,
      updatedBy,
    });
  }

  if (context.liveVoiceEnabled !== undefined) {
    await writeOverride({
      scopeId,
      configKey: CHANNEL_KEYS.liveVoiceEnabled,
      value: context.liveVoiceEnabled,
      updatedAt,
      updatedBy,
    });
  }

  if (context.liveVoiceCommandsEnabled !== undefined) {
    await writeOverride({
      scopeId,
      configKey: CHANNEL_KEYS.liveVoiceCommandsEnabled,
      value: context.liveVoiceCommandsEnabled,
      updatedAt,
      updatedBy,
    });
  }

  if (context.chatTtsEnabled !== undefined) {
    await writeOverride({
      scopeId,
      configKey: CHANNEL_KEYS.chatTtsEnabled,
      value: context.chatTtsEnabled,
      updatedAt,
      updatedBy,
    });
  }
};

const migrateAutoRecordSetting = async (setting: AutoRecordSettings) => {
  if (!shouldProcessGuild(setting.guildId)) return;
  const updatedAt = setting.createdAt;
  const updatedBy = setting.createdBy;
  const isRecordAll = setting.recordAll || setting.channelId === "ALL";

  if (isRecordAll) {
    const scopeId = scopeIdForServer(setting.guildId);
    await writeOverride({
      scopeId,
      configKey: AUTO_RECORD_KEYS.enabled,
      value: setting.enabled,
      updatedAt,
      updatedBy,
    });
    if (setting.enabled && setting.textChannelId) {
      await writeOverride({
        scopeId,
        configKey: AUTO_RECORD_KEYS.notesChannelId,
        value: setting.textChannelId,
        updatedAt,
        updatedBy,
      });
    }
    if (setting.enabled && setting.tags && setting.tags.length > 0) {
      const normalized = normalizeTags(setting.tags);
      if (normalized) {
        await writeOverride({
          scopeId,
          configKey: AUTO_RECORD_KEYS.notesTags,
          value: normalized.join(", "),
          updatedAt,
          updatedBy,
        });
      }
    }
    return;
  }

  const scopeId = scopeIdForChannel(setting.guildId, setting.channelId);
  await writeOverride({
    scopeId,
    configKey: AUTO_RECORD_KEYS.enabled,
    value: setting.enabled,
    updatedAt,
    updatedBy,
  });
  if (setting.enabled && setting.textChannelId) {
    await writeOverride({
      scopeId,
      configKey: AUTO_RECORD_KEYS.notesChannelId,
      value: setting.textChannelId,
      updatedAt,
      updatedBy,
    });
  }
  if (setting.enabled && setting.tags && setting.tags.length > 0) {
    const normalized = normalizeTags(setting.tags);
    if (normalized) {
      await writeOverride({
        scopeId,
        configKey: AUTO_RECORD_KEYS.notesTags,
        value: normalized.join(", "),
        updatedAt,
        updatedBy,
      });
    }
  }
};

const ensureRequiredServerDefaults = async (guildId: string) => {
  const overrides = await repo.listByScope(scopeIdForServer(guildId));
  const existing = new Set(overrides.map((record) => record.configKey));
  await Promise.all(
    REQUIRED_SERVER_DEFAULTS.filter((entry) => !existing.has(entry.key)).map(
      (entry) =>
        writeOverride(
          {
            scopeId: scopeIdForServer(guildId),
            configKey: entry.key,
            value: entry.value,
            updatedAt: nowIso(),
            updatedBy: "system",
          },
          { skipIfExists: false },
        ),
    ),
  );
};

const main = async () => {
  console.log(
    `migrate-config-overrides ${apply ? "(apply)" : "(dry-run)"}` +
      (guildFilter ? ` guild=${guildFilter}` : ""),
  );

  const guildIds = new Set<string>();

  const serverContexts = await scanServerContexts();
  for (const context of serverContexts) {
    guildIds.add(context.guildId);
    await migrateServerContext(context);
  }

  const channelContexts = await scanChannelContexts();
  for (const context of channelContexts) {
    guildIds.add(context.guildId);
    await migrateChannelContext(context);
  }

  const autoRecordSettings = await scanAutoRecordSettings();
  for (const setting of autoRecordSettings) {
    guildIds.add(setting.guildId);
    await migrateAutoRecordSetting(setting);
  }

  for (const guildId of guildIds) {
    if (!shouldProcessGuild(guildId)) continue;
    await ensureRequiredServerDefaults(guildId);
  }

  console.log(
    `migration complete planned=${stats.planned} written=${stats.written} skipped=${stats.skipped}`,
  );
};

main().catch((err) => {
  console.error("migration failed", err);
  process.exit(1);
});
