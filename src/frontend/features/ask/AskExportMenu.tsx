import { Button, Menu } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";

type AskExportMenuProps = {
  disabled: boolean;
  onExport: (format: "json" | "text") => void;
};

export function AskExportMenu({ disabled, onExport }: AskExportMenuProps) {
  return (
    <Menu withinPortal={false}>
      <Menu.Target>
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconDownload size={14} />}
          disabled={disabled}
          data-testid="ask-export"
        >
          Export
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => onExport("json")}>Export JSON</Menu.Item>
        <Menu.Item onClick={() => onExport("text")}>Export text</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
