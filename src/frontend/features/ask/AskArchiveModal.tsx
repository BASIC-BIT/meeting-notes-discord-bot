import { Button, Group, Modal, Stack, Text } from "@mantine/core";

type AskArchiveModalProps = {
  opened: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmColor: "red" | "brand";
  loading: boolean;
  onConfirm: () => void;
};

export function AskArchiveModal({
  opened,
  onClose,
  title,
  description,
  confirmColor,
  loading,
  onConfirm,
}: AskArchiveModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {description}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color={confirmColor}
            onClick={onConfirm}
            loading={loading}
            data-testid="ask-archive-confirm"
          >
            {title}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export type { AskArchiveModalProps };
