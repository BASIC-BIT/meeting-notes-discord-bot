import type { ConfigEntry, ConfigGroup } from "./types";

export const DEFAULT_CONFIG_GROUP: ConfigGroup = "Standard";
export const CONFIG_GROUP_ORDER: ConfigGroup[] = [
  "Recommended",
  "Standard",
  "Experimental",
  "Advanced",
];

export const PRIMARY_CONFIG_GROUPS: ConfigGroup[] = ["Recommended", "Standard"];

export const resolveConfigGroup = (entry: Pick<ConfigEntry, "group">) =>
  entry.group ?? DEFAULT_CONFIG_GROUP;
