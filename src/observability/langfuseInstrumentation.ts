import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { isLangfuseTracingEnabled } from "../services/langfuseClient";

let started = false;

function startLangfuseTracing() {
  if (started || !isLangfuseTracingEnabled()) {
    return;
  }

  const sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  });
  sdk.start();
  started = true;
}

startLangfuseTracing();
