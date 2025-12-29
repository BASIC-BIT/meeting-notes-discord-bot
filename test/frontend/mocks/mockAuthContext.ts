import { jest } from "@jest/globals";
import { authState } from "./authState";

jest.mock("../../../src/frontend/contexts/AuthContext", () => ({
  useAuth: () => authState,
}));
