import { httpBatchLink } from "@trpc/client";
import { buildApiUrl } from "./apiClient";
import { trpc } from "./trpc";

const trpcUrl = buildApiUrl("/trpc");

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
