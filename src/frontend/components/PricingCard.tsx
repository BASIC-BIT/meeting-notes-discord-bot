import {
  Badge,
  Box,
  Button,
  type ButtonProps,
  List,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import type { MouseEventHandler } from "react";
import Surface from "./Surface";

type ButtonVariant =
  | "filled"
  | "light"
  | "outline"
  | "transparent"
  | "white"
  | "subtle"
  | "default"
  | "gradient";

type PricingCtaProps = Omit<ButtonProps, "children"> & {
  variant?: ButtonVariant;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

type PricingCardProps = {
  name: string;
  price: string;
  description: string;
  features: string[];
  cta: string;
  ctaProps?: PricingCtaProps;
  ctaDisabled?: boolean;
  highlighted?: boolean;
  badge?: string;
  note?: string;
  tone?: "default" | "raised" | "soft";
  borderColor?: string;
  borderWidth?: number;
};

export function PricingCard({
  name,
  price,
  description,
  features,
  cta,
  ctaProps,
  ctaDisabled,
  highlighted = false,
  badge,
  note,
  tone,
  borderColor,
  borderWidth,
}: PricingCardProps) {
  const badgeLabel = highlighted ? (badge ?? "Best value") : badge;
  const buttonVariant =
    ctaProps?.variant ?? (highlighted ? "gradient" : "outline");
  const buttonGradient =
    ctaProps?.gradient ??
    (highlighted ? { from: "brand", to: "violet" } : undefined);
  const buttonDisabled = ctaDisabled ?? ctaProps?.disabled ?? false;
  const computedTone = tone ?? (highlighted ? "raised" : "default");
  const computedBorderWidth = borderWidth ?? (highlighted ? 2 : 1);
  const computedBorderColor =
    borderColor ?? (highlighted ? "var(--mantine-color-brand-6)" : undefined);
  const badgeColor = highlighted ? "brand" : "cyan";
  return (
    <Surface
      p="xl"
      tone={computedTone}
      style={{
        borderWidth: computedBorderWidth,
        borderColor: computedBorderColor,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <Stack gap="md" style={{ flex: 1 }}>
        <Stack gap={6}>
          {badgeLabel ? (
            <Badge
              variant={highlighted ? "filled" : "light"}
              color={badgeColor}
              w="fit-content"
            >
              {badgeLabel}
            </Badge>
          ) : null}
          <Title order={3}>{name}</Title>
          <Text c="dimmed">{description}</Text>
        </Stack>
        <Stack gap={4}>
          <Text fw={700} size="xl">
            {price}
          </Text>
          <Text size="sm" c="dimmed">
            Billed monthly
          </Text>
        </Stack>
        <List
          spacing="xs"
          size="sm"
          icon={
            <ThemeIcon
              color={highlighted ? "brand" : "gray"}
              radius="xl"
              size={20}
            >
              <IconCheck size={12} />
            </ThemeIcon>
          }
        >
          {features.map((feature) => (
            <List.Item key={feature}>{feature}</List.Item>
          ))}
        </List>
        <Box mt="auto">
          <Button
            variant={buttonVariant}
            gradient={buttonVariant === "gradient" ? buttonGradient : undefined}
            fullWidth
            {...ctaProps}
            disabled={buttonDisabled}
          >
            {cta}
          </Button>
          {note ? (
            <Text size="xs" c="dimmed" mt="xs">
              {note}
            </Text>
          ) : null}
        </Box>
      </Stack>
    </Surface>
  );
}

export default PricingCard;
