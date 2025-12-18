import { Button, Card, Grid, Group, Stack, Text, Title } from "@mantine/core";
import { IconMicrophone, IconFileText, IconRobot } from "@tabler/icons-react";

const features = [
  {
    title: "Record & Transcribe",
    desc: "Capture multi-speaker voice channels and get high-quality transcripts automatically.",
    icon: <IconMicrophone size={24} />,
  },
  {
    title: "AI Notes & Search",
    desc: "Summaries, corrections, and `/ask` over recent meetings with tag filtering.",
    icon: <IconFileText size={24} />,
  },
  {
    title: "Live Voice Agent",
    desc: "Optional live responder that speaks in channel with thinking cues and context.",
    icon: <IconRobot size={24} />,
  },
];

export default function Home() {
  return (
    <Stack gap="lg">
      <Card padding="lg" shadow="sm" radius="md" withBorder>
        <Stack gap="sm">
          <Title order={2}>Meeting Notes Bot</Title>
          <Text c="dimmed">
            AI-powered meeting recorder for Discord: capture audio, generate
            notes, answer questions, and even speak back in voice.
          </Text>
          <Group gap="sm">
            <Button
              component="a"
              href="https://discord.com/oauth2/authorize?client_id=1278729036528619633&scope=bot%20applications.commands"
              color="indigo"
            >
              Add to Discord
            </Button>
            <Button variant="outline" component="a" href="https://github.com/">
              View Docs
            </Button>
          </Group>
        </Stack>
      </Card>

      <Grid>
        {features.map((f) => (
          <Grid.Col span={{ base: 12, sm: 4 }} key={f.title}>
            <Card withBorder shadow="xs" padding="md" radius="md">
              <Group gap="sm">
                {f.icon}
                <Title order={4}>{f.title}</Title>
              </Group>
              <Text mt="xs" c="dimmed">
                {f.desc}
              </Text>
            </Card>
          </Grid.Col>
        ))}
      </Grid>
    </Stack>
  );
}
