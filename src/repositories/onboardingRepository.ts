import {
  deleteOnboardingState,
  getOnboardingState,
  writeOnboardingState,
} from "../db";
import { config } from "../services/configService";
import type { OnboardingState } from "../types/db";
import { getMockStore } from "./mockStore";

export type OnboardingRepository = {
  get: (
    guildId: string,
    userId: string,
  ) => Promise<OnboardingState | undefined>;
  write: (state: OnboardingState) => Promise<void>;
  delete: (guildId: string, userId: string) => Promise<void>;
};

const realRepository: OnboardingRepository = {
  get: getOnboardingState,
  write: writeOnboardingState,
  delete: deleteOnboardingState,
};

const mockRepository: OnboardingRepository = {
  async get(guildId, userId) {
    return getMockStore().onboardingStates.get(`${guildId}#${userId}`);
  },
  async write(state) {
    getMockStore().onboardingStates.set(
      `${state.guildId}#${state.userId}`,
      state,
    );
  },
  async delete(guildId, userId) {
    getMockStore().onboardingStates.delete(`${guildId}#${userId}`);
  },
};

export function getOnboardingRepository(): OnboardingRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
