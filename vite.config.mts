import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "src", "frontend"),
  envDir: path.resolve(__dirname),
  publicDir: path.resolve(__dirname, "public"),
  plugins: [
    tsconfigPaths({
      projects: [path.resolve(__dirname, "tsconfig.frontend.json")],
    }),
    react(),
  ],
  build: {
    outDir: path.resolve(__dirname, "build", "frontend"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@mantine") || id.includes("@tabler")) {
            return "vendor-ui";
          }
          if (id.includes("@tanstack")) {
            return "vendor-tanstack";
          }
          if (id.includes("@trpc")) {
            return "vendor-trpc";
          }
          if (id.includes("date-fns")) {
            return "vendor-date";
          }
          if (
            id.includes("react-markdown") ||
            id.includes("remark") ||
            id.includes("rehype") ||
            id.includes("mdast") ||
            id.includes("micromark")
          ) {
            return "vendor-markdown";
          }
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/auth": "http://localhost:3001",
      "/user": "http://localhost:3001",
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // Proxy backend tRPC calls during local frontend dev.
      "/trpc": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
});
