import { Button, type ButtonProps } from "@mantine/core";
import type { MouseEventHandler } from "react";
import { IconRefresh } from "@tabler/icons-react";

type RefreshButtonProps = Omit<ButtonProps, "children" | "leftSection"> & {
  label?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

export function RefreshButton({
  label = "Refresh",
  size = "xs",
  variant = "subtle",
  ...props
}: RefreshButtonProps) {
  return (
    <Button
      leftSection={<IconRefresh size={14} />}
      size={size}
      variant={variant}
      {...props}
    >
      {label}
    </Button>
  );
}
