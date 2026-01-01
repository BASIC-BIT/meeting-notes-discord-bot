import type { ConfigEntry } from "./types";

type CoercedValue = { value: unknown; valid: boolean };

const invalid = (value: unknown): CoercedValue => ({
  value,
  valid: false,
});

const parseNumberValue = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  if (value === true || value === false) return undefined;
  if (typeof value === "string" && value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const coerceBoolean = (_entry: ConfigEntry, value: unknown): CoercedValue => {
  if (typeof value === "boolean") return { value, valid: true };
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true") return { value: true, valid: true };
    if (lower === "false") return { value: false, valid: true };
  }
  return invalid(value);
};

const coerceNumber = (_entry: ConfigEntry, value: unknown): CoercedValue => {
  const parsed = parseNumberValue(value);
  return parsed === undefined ? invalid(value) : { value: parsed, valid: true };
};

const coerceSelect = (entry: ConfigEntry, value: unknown): CoercedValue => {
  if (typeof value !== "string") return invalid(value);
  if (entry.ui.type === "custom") {
    if (entry.ui.options && !entry.ui.options.includes(value)) {
      return invalid(value);
    }
    return { value, valid: true };
  }
  if (entry.ui.type === "select" || entry.ui.type === "segmented") {
    if (entry.ui.options.includes(value)) {
      return { value, valid: true };
    }
  }
  return invalid(value);
};

const coerceString = (_entry: ConfigEntry, value: unknown): CoercedValue => {
  if (typeof value === "string") return { value, valid: true };
  return invalid(value);
};

export function coerceConfigValue(
  entry: ConfigEntry,
  value: unknown,
): CoercedValue {
  switch (entry.valueType) {
    case "boolean":
      return coerceBoolean(entry, value);
    case "number":
      return coerceNumber(entry, value);
    case "select":
      return coerceSelect(entry, value);
    case "string":
      return coerceString(entry, value);
    default:
      return invalid(value);
  }
}

export type NumberRange = { min?: number; max?: number; invalidKeys: string[] };

export const resolveNumberRange = (
  entry: ConfigEntry,
  valuesByKey?: Record<string, unknown>,
): NumberRange => {
  if (entry.ui.type !== "number") {
    return { min: undefined, max: undefined, invalidKeys: [] };
  }

  let min = entry.ui.min;
  let max = entry.ui.max;
  const invalidKeys: string[] = [];

  const applyKeyBound = (key: string | undefined, mode: "min" | "max") => {
    if (!key) return;
    if (!valuesByKey || !Object.hasOwn(valuesByKey, key)) {
      invalidKeys.push(key);
      return;
    }
    const parsed = parseNumberValue(valuesByKey[key]);
    if (parsed === undefined) {
      invalidKeys.push(key);
      return;
    }
    if (mode === "min") {
      min = min === undefined ? parsed : Math.max(min, parsed);
    } else {
      max = max === undefined ? parsed : Math.min(max, parsed);
    }
  };

  applyKeyBound(entry.ui.minKey, "min");
  applyKeyBound(entry.ui.maxKey, "max");

  if (min !== undefined && max !== undefined && min > max) {
    invalidKeys.push(entry.key);
  }

  return { min, max, invalidKeys };
};

export const clampNumberValue = (value: number, range: NumberRange) => {
  if (range.min !== undefined) {
    value = Math.max(range.min, value);
  }
  if (range.max !== undefined) {
    value = Math.min(range.max, value);
  }
  return value;
};
