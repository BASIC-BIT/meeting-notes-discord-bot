import { LangfuseClient, type LangfuseClientParams } from "@langfuse/client";
import { config } from "./configService";

let langfuseClient: LangfuseClient | null = null;

export function isLangfuseEnabled(): boolean {
  return (
    config.langfuse.publicKey.length > 0 && config.langfuse.secretKey.length > 0
  );
}

export function isLangfuseTracingEnabled(): boolean {
  return isLangfuseEnabled() && config.langfuse.tracingEnabled;
}

export function getLangfuseClient(): LangfuseClient | null {
  if (!isLangfuseEnabled()) {
    return null;
  }
  if (langfuseClient) {
    return langfuseClient;
  }
  const options: LangfuseClientParams = {};
  if (config.langfuse.publicKey) {
    options.publicKey = config.langfuse.publicKey;
  }
  if (config.langfuse.secretKey) {
    options.secretKey = config.langfuse.secretKey;
  }
  if (config.langfuse.baseUrl) {
    options.baseUrl = config.langfuse.baseUrl;
  }
  langfuseClient = new LangfuseClient(options);
  return langfuseClient;
}
