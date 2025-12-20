import { useMemo, useState } from "react";
import {
  Button,
  Divider,
  Grid,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import {
  IconMessage,
  IconPlus,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";
import PageHeader from "../components/PageHeader";
import Surface from "../components/Surface";

type ChatMessage = {
  id: string;
  role: "user" | "chronote";
  text: string;
  time: string;
};

type Conversation = {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
  messages: ChatMessage[];
};

const CONVERSATIONS: Conversation[] = [
  {
    id: "c1",
    title: "Analytics milestone decision",
    summary:
      "Delay the analytics milestone by one week and update stakeholders.",
    updatedAt: "Today",
    messages: [
      {
        id: "m1",
        role: "user",
        text: "What did we decide about the analytics milestone?",
        time: "10:04",
      },
      {
        id: "m2",
        role: "chronote",
        text: "The team agreed to delay the analytics milestone by one week to stabilize dashboard work. Receipt: Jules (05:12) said, 'If we push the dashboard work by a week, the rest looks stable.'",
        time: "10:04",
      },
    ],
  },
  {
    id: "c2",
    title: "Ops alert routing",
    summary:
      "Alerts move to #ops-voice; runbook updated after incident review.",
    updatedAt: "Yesterday",
    messages: [
      {
        id: "m3",
        role: "user",
        text: "Which channel should receive alert updates?",
        time: "17:22",
      },
      {
        id: "m4",
        role: "chronote",
        text: "Alerts should route to #ops-voice. The runbook was updated after the incident review. Receipt: Sam (04:10) noted the outage root cause and the plan to update alerting.",
        time: "17:22",
      },
    ],
  },
];

export default function Ask() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(CONVERSATIONS[0]?.id ?? "");

  const filtered = useMemo(() => {
    if (!query) return CONVERSATIONS;
    return CONVERSATIONS.filter((conv) =>
      conv.title.toLowerCase().includes(query.toLowerCase()),
    );
  }, [query]);

  const activeConversation = useMemo(
    () =>
      CONVERSATIONS.find((conv) => conv.id === activeId) ?? CONVERSATIONS[0],
    [activeId],
  );

  return (
    <Stack gap="xl">
      <PageHeader
        title="Ask"
        description="Query recent meetings with receipts. Conversations stay scoped to the selected server."
      />

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Surface p="lg" tone="soft">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>Conversations</Text>
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconPlus size={14} />}
                >
                  New
                </Button>
              </Group>
              <TextInput
                placeholder="Search chats"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                leftSection={<IconSearch size={14} />}
              />
              <ScrollArea h={420}>
                <Stack gap="sm">
                  {filtered.map((conv) => {
                    const isActive = conv.id === activeId;
                    return (
                      <Surface
                        key={conv.id}
                        p="md"
                        tone={isActive ? "soft" : "default"}
                        shadow={undefined}
                        style={{
                          cursor: "pointer",
                          borderLeftWidth: isActive ? 3 : undefined,
                          borderLeftStyle: isActive ? "solid" : undefined,
                          borderLeftColor: isActive
                            ? "var(--mantine-color-brand-6)"
                            : undefined,
                          borderColor: isActive
                            ? "var(--mantine-color-brand-4)"
                            : undefined,
                        }}
                        onClick={() => setActiveId(conv.id)}
                      >
                        <Stack gap={6}>
                          <Group justify="space-between" align="center">
                            <Text fw={600}>{conv.title}</Text>
                            <Text size="xs" c="dimmed" fw={600}>
                              {conv.updatedAt}
                            </Text>
                          </Group>
                          <Text size="sm" c="dimmed" lineClamp={2}>
                            {conv.summary}
                          </Text>
                        </Stack>
                      </Surface>
                    );
                  })}
                </Stack>
              </ScrollArea>
            </Stack>
          </Surface>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Surface p="lg">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Group gap="sm">
                  <ThemeIcon variant="light" color="brand" radius="md">
                    <IconMessage size={16} />
                  </ThemeIcon>
                  <Text fw={600}>
                    {activeConversation?.title ?? "New chat"}
                  </Text>
                </Group>
              </Group>
              <ScrollArea h={360}>
                <Stack gap="sm">
                  {activeConversation?.messages.map((message) => (
                    <Surface
                      key={message.id}
                      p="md"
                      tone={message.role === "chronote" ? "soft" : "default"}
                      style={{
                        alignSelf:
                          message.role === "user" ? "flex-end" : "flex-start",
                        maxWidth: "92%",
                      }}
                    >
                      <Stack gap={6}>
                        <Group gap="xs">
                          <Text size="xs" c="dimmed" fw={600}>
                            {message.role === "user" ? "You" : "Chronote"}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {message.time}
                          </Text>
                        </Group>
                        <Text size="sm">{message.text}</Text>
                      </Stack>
                    </Surface>
                  ))}
                </Stack>
              </ScrollArea>
              <Divider my="xs" />
              <Stack gap="sm">
                <Textarea
                  placeholder="Ask about decisions, action items, or what was discussed..."
                  minRows={3}
                />
                <Group justify="space-between" align="center" wrap="wrap">
                  <Text size="xs" c="dimmed">
                    Searches recent meetings by default.
                  </Text>
                  <Button
                    variant="gradient"
                    gradient={{ from: "brand", to: "violet" }}
                    leftSection={<IconSparkles size={16} />}
                  >
                    Ask
                  </Button>
                </Group>
              </Stack>
            </Stack>
          </Surface>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
