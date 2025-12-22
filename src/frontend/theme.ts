import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  SegmentedControl,
  Tabs,
  TextInput,
  Textarea,
  ThemeIcon,
  createTheme,
  type MantineColorsTuple,
} from "@mantine/core";
import { uiRadii } from "./uiTokens";

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
  defaultRadius: uiRadii.base,
  defaultGradient: { from: "brand", to: "violet", deg: 135 },
  colors: {
    brand,
    accent,
  },
  components: {
    Button: Button.extend({
      defaultProps: {
        radius: uiRadii.control,
      },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: {
        radius: uiRadii.control,
        variant: "outline",
      },
    }),
    Card: Card.extend({
      defaultProps: {
        radius: uiRadii.surface,
        withBorder: true,
        shadow: "sm",
      },
    }),
    Badge: Badge.extend({
      defaultProps: {
        radius: uiRadii.badge,
      },
    }),
    TextInput: TextInput.extend({
      defaultProps: {
        radius: uiRadii.control,
      },
    }),
    Textarea: Textarea.extend({
      defaultProps: {
        radius: uiRadii.control,
      },
    }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: {
        radius: uiRadii.control,
      },
    }),
    ThemeIcon: ThemeIcon.extend({
      defaultProps: {
        radius: uiRadii.icon,
      },
    }),
    Alert: Alert.extend({
      defaultProps: {
        radius: uiRadii.control,
      },
    }),
    Tabs: Tabs.extend({
      defaultProps: {
        variant: "pills",
      },
    }),
  },
});
