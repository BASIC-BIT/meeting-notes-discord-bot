import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "src", "frontend"),
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
  },
  preview: {
    port: 4173,
  },
});
