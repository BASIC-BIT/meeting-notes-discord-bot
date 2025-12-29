import { jest } from "@jest/globals";
import { authState } from "./authState";
import { guildState } from "./guildState";

jest.mock("../../../src/frontend/contexts/AuthContext", () => ({
  useAuth: () => authState,
}));

jest.mock("../../../src/frontend/contexts/GuildContext", () => ({
  useGuildContext: () => guildState,
}));
