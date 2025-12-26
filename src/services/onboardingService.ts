import type { OnboardingState } from "../types/db";
import { getOnboardingRepository } from "../repositories/onboardingRepository";

export async function fetchOnboardingState(guildId: string, userId: string) {
  return getOnboardingRepository().get(guildId, userId);
}

export async function saveOnboardingState(state: OnboardingState) {
  return getOnboardingRepository().write(state);
}

export async function removeOnboardingState(guildId: string, userId: string) {
  return getOnboardingRepository().delete(guildId, userId);
}
