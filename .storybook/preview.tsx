import type { Preview } from "@storybook/react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { theme } from "../src/frontend/theme";
import "../src/frontend/index.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

const preview: Preview = {
  decorators: [
    (Story) => (
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <Story />
        <Notifications position="top-right" />
      </MantineProvider>
    ),
  ],
};

export default preview;
