import {
  AppConfigClient,
  CreateHostedConfigurationVersionCommand,
  StartDeploymentCommand,
} from "@aws-sdk/client-appconfig";
import {
  CONFIG_KEY_SET,
  CONFIG_REGISTRY,
  getConfigEntry,
} from "../config/registry";
import { coerceConfigValue, resolveNumberRange } from "../config/validation";
import { resolveScopeConfig } from "../config/scopeUtils";
import { config } from "./configService";
import { getGlobalConfigValues, resetAppConfigCache } from "./appConfigService";

type PublishOptions = {
  values: Record<string, unknown>;
  description?: string;
};

const assertAppConfigReady = () => {
  if (!config.appConfig.enabled) {
    throw new Error("AppConfig is not enabled.");
  }
  if (!config.appConfig.deploymentStrategyId) {
    throw new Error("AppConfig deployment strategy id is missing.");
  }
};

const buildResolvedValues = async () => {
  const baseValues = await getGlobalConfigValues();
  const resolvedValues: Record<string, unknown> = { ...baseValues };
  CONFIG_REGISTRY.forEach((entry) => {
    if (!Object.hasOwn(resolvedValues, entry.key)) {
      if (entry.defaultValue !== undefined) {
        resolvedValues[entry.key] = entry.defaultValue;
      }
    }
  });
  return resolvedValues;
};

const validateGlobalValue = (key: string, rawValue: unknown) => {
  if (!CONFIG_KEY_SET.has(key)) {
    throw new Error(`Unknown config key: ${key}`);
  }
  const entry = getConfigEntry(key);
  if (!entry) {
    throw new Error(`Unknown config key: ${key}`);
  }
  const scopeConfig = resolveScopeConfig(entry, "global");
  if (!scopeConfig.enabled) {
    throw new Error(`Config key is not global: ${key}`);
  }
  const coerced = coerceConfigValue(entry, rawValue);
  if (!coerced.valid) {
    throw new Error(`Invalid value for ${key}`);
  }
  return { entry, value: coerced.value };
};

const validateNumberBounds = (
  key: string,
  entry: ReturnType<typeof getConfigEntry>,
  value: unknown,
  valuesByKey: Record<string, unknown>,
) => {
  if (!entry || entry.valueType !== "number") return;
  const range = resolveNumberRange(entry, valuesByKey);
  if (range.invalidKeys.length > 0) {
    throw new Error(
      `Invalid bounds for ${key}: ${range.invalidKeys.join(", ")}`,
    );
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`Invalid numeric value for ${key}`);
  }
  if (range.min !== undefined && numericValue < range.min) {
    throw new Error(`Value for ${key} must be >= ${range.min}`);
  }
  if (range.max !== undefined && numericValue > range.max) {
    throw new Error(`Value for ${key} must be <= ${range.max}`);
  }
};

export async function publishAppConfigValues(input: PublishOptions): Promise<{
  version: number;
  deploymentNumber?: number;
}> {
  assertAppConfigReady();
  const resolvedValues = await buildResolvedValues();

  const values: Record<string, unknown> = {};
  Object.entries(input.values).forEach(([key, rawValue]) => {
    const validated = validateGlobalValue(key, rawValue);
    values[key] = validated.value;
  });

  const valuesByKey = { ...resolvedValues, ...values };
  Object.entries(values).forEach(([key, value]) => {
    validateNumberBounds(key, getConfigEntry(key), value, valuesByKey);
  });

  const client = new AppConfigClient({ region: config.storage.awsRegion });
  const payload = JSON.stringify({ values });
  const createResponse = await client.send(
    new CreateHostedConfigurationVersionCommand({
      ApplicationId: config.appConfig.applicationId,
      ConfigurationProfileId: config.appConfig.profileId,
      Content: Buffer.from(payload),
      ContentType: "application/json",
    }),
  );

  if (!createResponse.VersionNumber) {
    throw new Error("Failed to create AppConfig hosted configuration version.");
  }

  const deployment = await client.send(
    new StartDeploymentCommand({
      ApplicationId: config.appConfig.applicationId,
      EnvironmentId: config.appConfig.environmentId,
      ConfigurationProfileId: config.appConfig.profileId,
      ConfigurationVersion: createResponse.VersionNumber.toString(),
      DeploymentStrategyId: config.appConfig.deploymentStrategyId,
      Description: input.description?.slice(0, 256),
    }),
  );

  resetAppConfigCache();

  return {
    version: createResponse.VersionNumber,
    deploymentNumber: deployment.DeploymentNumber,
  };
}
