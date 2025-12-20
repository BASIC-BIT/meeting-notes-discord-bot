import {
  ActionIcon,
  Badge,
  Button,
  Card,
  SegmentedControl,
  Tabs,
  TextInput,
  Textarea,
  createTheme,
  type MantineColorsTuple,
} from "@mantine/core";

const brand: MantineColorsTuple = [
  "#edf0ff",
  "#dee3ff",
  "#c4cbff",
  "#a6adff",
  "#8a8fff",
  "#6f75ff",
  "#5e64f2",
  "#4c52d4",
  "#3f44aa",
  "#343b84",
];
const accent: MantineColorsTuple = [
  "#e6fcff",
  "#c5f6ff",
  "#99e9f2",
  "#66d9e8",
  "#3bc9db",
  "#22b8cf",
  "#15aabf",
  "#1098ad",
  "#0c8599",
  "#0b7285",
];

export const theme = createTheme({
  fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif",
  headings: {
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif",
    fontWeight: "600",
  },
  primaryColor: "brand",
  primaryShade: { light: 6, dark: 5 },
  defaultRadius: "lg",
  defaultGradient: { from: "brand", to: "violet", deg: 135 },
  colors: {
    brand,
    accent,
  },
  components: {
    Button: Button.extend({
      defaultProps: {
        radius: "md",
      },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: {
        radius: "md",
        variant: "outline",
      },
    }),
    Card: Card.extend({
      defaultProps: {
        radius: "lg",
        withBorder: true,
        shadow: "sm",
      },
    }),
    Badge: Badge.extend({
      defaultProps: {
        radius: "sm",
      },
    }),
    TextInput: TextInput.extend({
      defaultProps: {
        radius: "md",
      },
    }),
    Textarea: Textarea.extend({
      defaultProps: {
        radius: "md",
      },
    }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: {
        radius: "xl",
      },
    }),
    Tabs: Tabs.extend({
      defaultProps: {
        variant: "pills",
      },
    }),
  },
});
