import { CONFIG_KEYS } from "../../src/config/keys";
import { resolveConfigSnapshot } from "../../src/services/unifiedConfigService";
import { resetMockStore } from "../../src/repositories/mockStore";
import { setConfigOverrideForScope } from "../../src/services/configOverridesService";

describe("unifiedConfigService", () => {
  beforeEach(() => {
    resetMockStore();
  });

  test("gates premium transcription when experimental is off", async () => {
    await setConfigOverrideForScope(
      { scope: "server", guildId: "guild-1" },
      CONFIG_KEYS.transcription.premiumEnabled,
      true,
      "user-1",
    );
    const snapshot = await resolveConfigSnapshot({
      guildId: "guild-1",
      tier: "pro",
    });
    const premium = snapshot.values[CONFIG_KEYS.transcription.premiumEnabled];
    expect(premium.value).toBe(false);
    expect(premium.gated).toBe(true);
  });

  test("enables premium transcription for pro with experimental on", async () => {
    await setConfigOverrideForScope(
      { scope: "server", guildId: "guild-1" },
      CONFIG_KEYS.features.experimental,
      true,
      "user-1",
    );
    await setConfigOverrideForScope(
      { scope: "server", guildId: "guild-1" },
      CONFIG_KEYS.transcription.premiumEnabled,
      true,
      "user-1",
    );
    const snapshot = await resolveConfigSnapshot({
      guildId: "guild-1",
      tier: "pro",
    });
    const premium = snapshot.values[CONFIG_KEYS.transcription.premiumEnabled];
    expect(premium.value).toBe(true);
  });

  test("gates premium transcription for non-pro tiers", async () => {
    await setConfigOverrideForScope(
      { scope: "server", guildId: "guild-1" },
      CONFIG_KEYS.features.experimental,
      true,
      "user-1",
    );
    await setConfigOverrideForScope(
      { scope: "server", guildId: "guild-1" },
      CONFIG_KEYS.transcription.premiumEnabled,
      true,
      "user-1",
    );
    const snapshot = await resolveConfigSnapshot({
      guildId: "guild-1",
      tier: "basic",
    });
    const premium = snapshot.values[CONFIG_KEYS.transcription.premiumEnabled];
    expect(premium.value).toBe(false);
    expect(premium.gated).toBe(true);
  });
});
