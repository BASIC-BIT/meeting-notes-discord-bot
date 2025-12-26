import { httpBatchLink } from "@trpc/client";
import { API_BASE } from "./apiClient";
import { trpc } from "./trpc";

const trpcUrl = API_BASE ? `${API_BASE}/trpc` : "/trpc";

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: trpcUrl,
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: "include",
        });
      },
    }),
  ],
});
