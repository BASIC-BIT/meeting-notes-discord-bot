import { getAutoRecordRepository } from "../repositories/autoRecordRepository";
import { nowIso } from "../utils/time";
import { AutoRecordSettings } from "../types/db";

export async function listAutoRecordSettings(guildId: string) {
  return getAutoRecordRepository().listByGuild(guildId);
}

export async function getAutoRecordSettingByChannel(
  guildId: string,
  channelId: string,
) {
  return getAutoRecordRepository().getByGuildChannel(guildId, channelId);
}

export async function saveAutoRecordSetting(params: {
  guildId: string;
  channelId: string;
  textChannelId?: string;
  enabled: boolean;
  recordAll: boolean;
  createdBy: string;
  tags?: string[];
}): Promise<AutoRecordSettings> {
  const setting: AutoRecordSettings = {
    ...params,
    createdAt: nowIso(),
  };
  await getAutoRecordRepository().write(setting);
  return setting;
}

export async function removeAutoRecordSetting(
  guildId: string,
  channelId: string,
) {
  await getAutoRecordRepository().remove(guildId, channelId);
}
