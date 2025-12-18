import {
  deleteAutoRecordSetting,
  getAllAutoRecordSettings,
  writeAutoRecordSetting,
} from "../db";
import { nowIso } from "../utils/time";
import { AutoRecordSettings } from "../types/db";

export async function listAutoRecordSettings(guildId: string) {
  return getAllAutoRecordSettings(guildId);
}

export async function saveAutoRecordSetting(params: {
  guildId: string;
  channelId: string;
  textChannelId: string;
  enabled: boolean;
  recordAll: boolean;
  createdBy: string;
  tags?: string[];
}): Promise<AutoRecordSettings> {
  const setting: AutoRecordSettings = {
    ...params,
    createdAt: nowIso(),
  };
  await writeAutoRecordSetting(setting);
  return setting;
}

export async function removeAutoRecordSetting(
  guildId: string,
  channelId: string,
) {
  await deleteAutoRecordSetting(guildId, channelId);
}
