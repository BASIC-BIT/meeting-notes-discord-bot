import React from "react";
import { render, waitFor } from "@testing-library/react";
import App from "./App";
import { MantineProvider } from "@mantine/core";
import { AuthProvider } from "./contexts/AuthContext";
import { GuildProvider } from "./contexts/GuildContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc } from "./services/trpc";
import { trpcClient } from "./services/trpcClient";

const trpcResponses: Record<string, unknown> = {
  "auth.me": {},
  "servers.listEligible": { guilds: [{ id: "1", name: "Test Guild" }] },
};

const buildTrpcResponse = (paths: string[]) => {
  const payload = paths.map((path) => ({
    result: { data: trpcResponses[path] ?? null },
  }));
  return paths.length === 1 ? payload[0] : payload;
};

global.fetch = jest.fn((input: RequestInfo) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/trpc/")) {
    const parsed = new URL(url, "http://localhost");
    const pathPart = parsed.pathname.replace(/^\/trpc\//, "");
    const paths = pathPart.split(",").filter(Boolean);
    const body = buildTrpcResponse(paths);
    return Promise.resolve({
      ok: true,
      json: async () => body,
    }) as unknown as Response;
  }
  return Promise.resolve({
    ok: true,
    json: async () => ({}),
  }) as unknown as Response;
}) as unknown as typeof fetch;

test("renders app shell without crashing", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MantineProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <GuildProvider>{children}</GuildProvider>
          </AuthProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </MantineProvider>
  );

  try {
    render(<App />, { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    throw err;
  }
});
