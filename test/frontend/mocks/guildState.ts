import { jest } from "@jest/globals";

export type MockGuildState = {
  selectedGuildId: string | null;
  guilds: Array<{ id: string; name: string; icon?: string | null }>;
  loading: boolean;
  error: string | null;
  setSelectedGuildId: (id: string | null) => void;
  refresh: () => Promise<void>;
};

export const guildState: MockGuildState = {
  selectedGuildId: null,
  guilds: [],
  loading: false,
  error: null,
  setSelectedGuildId: jest.fn(),
  refresh: jest.fn(async () => {}),
};

export const resetGuildState = () => {
  guildState.selectedGuildId = null;
  guildState.guilds = [];
  guildState.loading = false;
  guildState.error = null;
  if (jest.isMockFunction(guildState.setSelectedGuildId)) {
    guildState.setSelectedGuildId.mockReset();
  }
  if (jest.isMockFunction(guildState.refresh)) {
    guildState.refresh.mockReset();
  }
};
