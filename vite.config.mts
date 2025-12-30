import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

process.env.VITE_MOCK_FIXED_NOW ??= "";

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
