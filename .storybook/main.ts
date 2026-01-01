import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.VITE_MOCK_FIXED_NOW ??= "";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const config: StorybookConfig = {
  stories: [
    "../src/frontend/**/*.mdx",
    "../src/frontend/**/*.stories.@(ts|tsx)",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: ["../public"],
  async viteFinal(config) {
    return mergeConfig(config, {
      envDir: rootDir,
      plugins: [
        tsconfigPaths({
          projects: [resolve(rootDir, "tsconfig.frontend.json")],
        }),
        react(),
      ],
    });
  },
};

export default config;
