import { createServer, type RequestListener } from "node:http";
import { getRuntimeReadiness } from "./runtimeLifecycleService";

/** One listener starts with liveness only; application routes attach after protection. */
export async function startRuntimeHealthServer(port: number) {
  let application: RequestListener | undefined;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "healthy" }));
      return;
    }
    if (path === "/ready") {
      const proof = getRuntimeReadiness();
      const ready =
        proof &&
        proof.expiresAt > Date.now() / 1000 &&
        proof.dependenciesReady &&
        proof.cacheReady &&
        (proof.runtimeMode === "api" || proof.gatewayReady);
      response.writeHead(ready ? 200 : 503, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ status: ready ? "ready" : "warming" }));
      return;
    }
    if (application) {
      application(request, response);
      return;
    }
    response.writeHead(503, {
      "Content-Type": "application/json",
      "Retry-After": "5",
    });
    response.end(JSON.stringify({ status: "warming" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  return {
    server,
    activate(handler: RequestListener) {
      if (application)
        throw new Error("Application listener already installed");
      application = handler;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
export type RuntimeHealthServer = Awaited<
  ReturnType<typeof startRuntimeHealthServer>
>;
