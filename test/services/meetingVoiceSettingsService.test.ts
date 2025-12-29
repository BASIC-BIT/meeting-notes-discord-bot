import { resolveMeetingVoiceSettings } from "../../src/services/meetingVoiceSettingsService";
import { getMockStore, resetMockStore } from "../../src/repositories/mockStore";
import { nowIso } from "../../src/utils/time";

describe("meetingVoiceSettingsService", () => {
  beforeEach(() => {
    resetMockStore();
  });

  it("uses channel overrides for chat-to-speech", async () => {
    const store = getMockStore();
    store.serverContexts.set("guild-1", {
      guildId: "guild-1",
      context: "server",
      liveVoiceEnabled: true,
      liveVoiceCommandsEnabled: true,
      chatTtsEnabled: false,
      liveVoiceTtsVoice: "alloy",
      chatTtsVoice: "nova",
      updatedAt: nowIso(),
      updatedBy: "user-1",
    });
    store.channelContexts.set("guild-1#voice-1", {
      guildId: "guild-1",
      channelId: "voice-1",
      chatTtsEnabled: true,
      updatedAt: nowIso(),
      updatedBy: "user-1",
    });

    const settings = await resolveMeetingVoiceSettings("guild-1", "voice-1", {
      liveVoiceEnabled: true,
      imagesEnabled: true,
    });

    expect(settings.chatTtsEnabled).toBe(true);
    expect(settings.liveVoiceEnabled).toBe(true);
    expect(settings.liveVoiceCommandsEnabled).toBe(true);
    expect(settings.chatTtsVoice).toBe("nova");
    expect(settings.liveVoiceTtsVoice).toBe("alloy");
  });

  it("disables chat-to-speech when tier disallows live voice", async () => {
    const store = getMockStore();
    store.serverContexts.set("guild-2", {
      guildId: "guild-2",
      context: "server",
      liveVoiceCommandsEnabled: true,
      chatTtsEnabled: true,
      updatedAt: nowIso(),
      updatedBy: "user-2",
    });

    const settings = await resolveMeetingVoiceSettings("guild-2", "voice-2", {
      liveVoiceEnabled: false,
      imagesEnabled: false,
    });

    expect(settings.chatTtsEnabled).toBe(false);
    expect(settings.liveVoiceEnabled).toBe(false);
    expect(settings.liveVoiceCommandsEnabled).toBe(false);
  });
});
