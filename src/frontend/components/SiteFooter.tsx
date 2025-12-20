import { Anchor, Container, Divider, Group, Stack, Text } from "@mantine/core";

export function SiteFooter() {
  return (
    <Stack gap="md" mt="xl">
      <Divider />
      <Container size="xl" py="md">
        <Group justify="space-between" gap="md" wrap="wrap">
          <Text size="sm" c="dimmed">
            Chronote by BASICBIT
          </Text>
          <Group gap="lg">
            <Anchor
              href="https://discord.com/oauth2/authorize?client_id=1278729036528619633&scope=bot%20applications.commands"
              size="sm"
            >
              Add to Discord
            </Anchor>
            <Anchor href="https://meetingnotes.basicbit.net" size="sm">
              Docs
            </Anchor>
          </Group>
        </Group>
      </Container>
    </Stack>
  );
}

export default SiteFooter;
