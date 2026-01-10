import type { ModelRole, ResolvedConfigSnapshot } from "../config/types";
import {
  MODEL_SELECTION_DEFAULTS,
  MODEL_SELECTION_OPTIONS,
  MODEL_SELECTION_ROLES,
  buildModelSelectionKey,
} from "../config/modelChoices";
import {
  getSnapshotEnum,
  resolveConfigSnapshot,
  type ConfigResolveContext,
} from "./unifiedConfigService";

export const resolveModelChoicesByRole = (
  snapshot: ResolvedConfigSnapshot,
): Partial<Record<ModelRole, string>> => {
  const resolved: Partial<Record<ModelRole, string>> = {};
  MODEL_SELECTION_ROLES.forEach((role) => {
    const key = buildModelSelectionKey(role);
    const fallback = MODEL_SELECTION_DEFAULTS[role];
    const value =
      getSnapshotEnum(snapshot, key, MODEL_SELECTION_OPTIONS[role], fallback) ??
      fallback;
    resolved[role] = value;
  });
  return resolved;
};

export const resolveModelChoicesForContext = async (
  context: ConfigResolveContext,
): Promise<Partial<Record<ModelRole, string>>> => {
  const snapshot = await resolveConfigSnapshot(context);
  return resolveModelChoicesByRole(snapshot);
};
