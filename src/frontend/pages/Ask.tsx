import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Center,
  Divider,
  Grid,
  Group,
  LoadingOverlay,
  Loader,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  TypographyStylesProvider,
} from "@mantine/core";
import {
  IconMessage,
  IconPencil,
  IconPlus,
  IconSearch,
  IconX,
  IconCheck,
  IconSparkles,
} from "@tabler/icons-react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Surface from "../components/Surface";
import PageHeader from "../components/PageHeader";
import { trpc } from "../services/trpc";
import { useGuildContext } from "../contexts/GuildContext";
import type { AskConversation, AskMessage } from "../../types/ask";
import { getDiscordOpenUrl } from "../utils/discordLinks";
import {
  uiColors,
  uiEffects,
  uiOverlays,
  uiRadii,
  uiSpacing,
} from "../uiTokens";

const formatTime = (value: string) => format(new Date(value), "HH:mm");
const formatUpdated = (value: string) => format(new Date(value), "MMM d");
const truncate = (text: string, maxLen: number) =>
  text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;

export default function Ask() {
  const { selectedGuildId } = useGuildContext();
  const trpcUtils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<AskMessage[]>(
    [],
  );
  const [optimisticConversation, setOptimisticConversation] =
    useState<AskConversation | null>(null);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const listQuery = trpc.ask.listConversations.useQuery(
    { serverId: selectedGuildId ?? "" },
    {
      enabled: Boolean(selectedGuildId),
      staleTime: 30_000,
    },
  );
  const conversationQuery = trpc.ask.getConversation.useQuery(
    { serverId: selectedGuildId ?? "", conversationId: activeId ?? "" },
    {
      enabled: Boolean(selectedGuildId && activeId),
      staleTime: 30_000,
      placeholderData: (prev) => prev,
    },
  );
  const askMutation = trpc.ask.ask.useMutation();
  const renameMutation = trpc.ask.rename.useMutation();

  const conversations = listQuery.data?.conversations ?? [];
  const listBusy = listQuery.isLoading || listQuery.isFetching;
  const conversationBusy =
    conversationQuery.isLoading || conversationQuery.isFetching;

  useEffect(() => {
    if (!selectedGuildId) {
      setActiveId(null);
      setOptimisticMessages([]);
      setOptimisticConversation(null);
      setIsCreatingNew(false);
      return;
    }
    if (!conversations.length) {
      setActiveId(null);
      return;
    }
    if (
      !isCreatingNew &&
      (!activeId || !conversations.some((conv) => conv.id === activeId))
    ) {
      setActiveId(conversations[0].id);
    }
  }, [selectedGuildId, conversations, activeId, isCreatingNew]);

  const filtered = useMemo(() => {
    const source = optimisticConversation
      ? [optimisticConversation, ...conversations]
      : conversations;
    if (!query) return source;
    const needle = query.toLowerCase();
    return source.filter((conv) =>
      `${conv.title} ${conv.summary}`.toLowerCase().includes(needle),
    );
  }, [query, conversations, optimisticConversation]);

  const activeConversation = isCreatingNew
    ? null
    : conversationQuery.data?.conversation;
  const activeMessages = isCreatingNew
    ? []
    : (conversationQuery.data?.messages ?? []);
  const displayTitle =
    activeConversation?.title ?? optimisticConversation?.title ?? "New chat";
  const displayMessages = useMemo(() => {
    const base =
      activeConversation || activeId ? activeMessages : optimisticMessages;
    const pending =
      askMutation.isPending && optimisticMessages.length > 0
        ? [
            {
              id: "thinking",
              role: "chronote",
              text: "Thinking...",
              createdAt: new Date().toISOString(),
            } as AskMessage,
          ]
        : [];
    if (!optimisticMessages.length) {
      return [...base, ...pending];
    }
    const hasOptimistic =
      base.some(
        (msg) => msg.role === "user" && msg.text === optimisticMessages[0].text,
      ) || base === optimisticMessages;
    if (hasOptimistic) {
      return [...base, ...pending];
    }
    return [...base, ...optimisticMessages, ...pending];
  }, [
    activeConversation,
    activeId,
    activeMessages,
    optimisticMessages,
    askMutation.isPending,
  ]);
  const showRename = Boolean(activeConversation && displayMessages.length > 0);

  useEffect(() => {
    const viewport = chatViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: askMutation.isPending ? "smooth" : "auto",
    });
  }, [displayMessages.length, askMutation.isPending]);

  const handleNewConversation = () => {
    setIsCreatingNew(true);
    setActiveId(null);
    setDraft("");
    setErrorMessage(null);
    setOptimisticMessages([]);
    setOptimisticConversation(null);
  };

  useEffect(() => {
    if (!selectedGuildId || !isCreatingNew) return;
    const handle = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [isCreatingNew, selectedGuildId]);

  useEffect(() => {
    if (!selectedGuildId) return;
    if (askMutation.isPending) return;
    if (!activeId && !isCreatingNew && !activeConversation) return;
    const handle = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [
    askMutation.isPending,
    activeId,
    activeConversation?.id,
    isCreatingNew,
    selectedGuildId,
  ]);

  useEffect(() => {
    if (activeConversation) {
      setRenameDraft(activeConversation.title);
      setRenaming(false);
      setRenameError(null);
    }
  }, [activeConversation?.id, activeConversation?.title]);

  useEffect(() => {
    if (!optimisticMessages.length) return;
    if (
      activeMessages.some(
        (message) =>
          message.role === "user" &&
          message.text === optimisticMessages[0].text,
      )
    ) {
      setOptimisticMessages([]);
      setOptimisticConversation(null);
    }
  }, [activeMessages, optimisticMessages]);

  const handleRenameSave = async () => {
    if (!selectedGuildId || !activeConversation) return;
    const title = renameDraft.trim();
    if (!title) {
      setRenameDraft(activeConversation.title);
      setRenaming(false);
      return;
    }
    setRenameError(null);
    try {
      await renameMutation.mutateAsync({
        serverId: selectedGuildId,
        conversationId: activeConversation.id,
        title,
      });
      await Promise.all([
        trpcUtils.ask.listConversations.invalidate({
          serverId: selectedGuildId,
        }),
        trpcUtils.ask.getConversation.invalidate({
          serverId: selectedGuildId,
          conversationId: activeConversation.id,
        }),
      ]);
      setRenaming(false);
    } catch (err) {
      setRenameError(
        err instanceof Error ? err.message : "Unable to rename chat.",
      );
    }
  };

  const handleAsk = async () => {
    const question = draft.trim();
    if (!selectedGuildId || !question) return;
    setErrorMessage(null);
    const now = new Date().toISOString();
    setOptimisticMessages([
      {
        id: `optimistic-${now}`,
        role: "user",
        text: question,
        createdAt: now,
      },
    ]);
    if (!activeConversation) {
      setOptimisticConversation({
        id: "pending",
        title: truncate(question, 48),
        summary: "",
        createdAt: now,
        updatedAt: now,
      });
    }
    try {
      const result = await askMutation.mutateAsync({
        serverId: selectedGuildId,
        question,
        conversationId: activeId ?? undefined,
      });
      setDraft("");
      setActiveId(result.conversationId);
      setIsCreatingNew(false);
      setOptimisticMessages([]);
      setOptimisticConversation(null);
      trpcUtils.ask.listConversations.setData(
        { serverId: selectedGuildId },
        (prev) => {
          const existing = prev?.conversations ?? [];
          const updated = existing.filter(
            (conv) => conv.id !== result.conversation.id,
          );
          return {
            conversations: [result.conversation, ...updated],
          };
        },
      );
      trpcUtils.ask.getConversation.setData(
        {
          serverId: selectedGuildId,
          conversationId: result.conversation.id,
        },
        (prev) => {
          const prevMessages = prev?.messages ?? [];
          const combined = [...prevMessages, ...result.messages];
          const seen = new Set<string>();
          const deduped = combined.filter((msg) => {
            if (seen.has(msg.id)) return false;
            seen.add(msg.id);
            return true;
          });
          return {
            conversation: result.conversation,
            messages: deduped,
          };
        },
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Unable to reach Chronote.",
      );
      setOptimisticConversation(null);
    }
  };

  return (
    <Stack
      gap="md"
      style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
      data-testid="ask-page"
    >
      <PageHeader
        title="Ask"
        description="Query recent meetings with receipts. Conversations stay scoped to the selected server."
      />

      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Grid
          gutter="lg"
          style={{ flex: 1, minHeight: 0, height: "100%" }}
          align="stretch"
          styles={{ inner: { height: "100%" } }}
        >
          <Grid.Col
            span={{ base: 12, md: 4 }}
            style={{
              display: "flex",
              minHeight: 0,
              height: "100%",
              maxHeight: "100%",
            }}
          >
            <Surface
              p="md"
              tone="soft"
              style={{
                position: "relative",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                maxHeight: "100%",
              }}
              data-testid="ask-conversations"
            >
              <LoadingOverlay
                visible={listQuery.isLoading || listQuery.isFetching}
                overlayProps={uiOverlays.loading}
                loaderProps={{ size: "md" }}
              />
              <Stack gap="sm" style={{ height: "100%", minHeight: 0 }}>
                <Group
                  justify="space-between"
                  align="center"
                  style={{
                    paddingRight: `var(--mantine-spacing-${uiSpacing.scrollAreaGutter})`,
                  }}
                >
                  <Text fw={600}>Conversations</Text>
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconPlus size={14} />}
                    onClick={handleNewConversation}
                    disabled={listBusy || conversationBusy}
                    loading={listBusy}
                    data-testid="ask-new"
                  >
                    New
                  </Button>
                </Group>
                <TextInput
                  placeholder="Search chats"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  leftSection={<IconSearch size={14} />}
                  data-testid="ask-search"
                  styles={{
                    input: {
                      paddingRight: `var(--mantine-spacing-${uiSpacing.scrollAreaGutter})`,
                    },
                  }}
                />
                <ScrollArea
                  style={{ flex: 1, minHeight: 0 }}
                  type="always"
                  offsetScrollbars
                  scrollbarSize={10}
                  styles={{
                    viewport: {
                      paddingRight: `var(--mantine-spacing-${uiSpacing.scrollAreaGutter})`,
                    },
                  }}
                >
                  <Stack gap="sm">
                    {listQuery.error ? (
                      <Center py="lg">
                        <Text size="sm" c="dimmed">
                          Unable to load conversations.
                        </Text>
                      </Center>
                    ) : filtered.length === 0 ? (
                      <Center py="lg">
                        <Text size="sm" c="dimmed">
                          No conversations yet.
                        </Text>
                      </Center>
                    ) : (
                      filtered.map((conv) => {
                        const isActive = conv.id === activeId;
                        return (
                          <Surface
                            key={conv.id}
                            p="sm"
                            tone={isActive ? "soft" : "default"}
                            shadow={undefined}
                            radius={uiRadii.surface}
                            data-testid="ask-conversation-item"
                            data-conversation-id={conv.id}
                            style={{
                              cursor: "pointer",
                              boxShadow: isActive
                                ? uiEffects.activeInset
                                : undefined,
                              borderColor: isActive
                                ? uiColors.highlightBorderSoft
                                : undefined,
                            }}
                            onClick={() => {
                              setActiveId(conv.id);
                              setIsCreatingNew(false);
                            }}
                          >
                            <Stack gap={6}>
                              <Group justify="space-between" align="center">
                                <Text fw={600}>{conv.title}</Text>
                                <Text size="xs" c="dimmed" fw={600}>
                                  {formatUpdated(conv.updatedAt)}
                                </Text>
                              </Group>
                              <Text size="sm" c="dimmed" lineClamp={2}>
                                {conv.summary ||
                                  "Ask Chronote about a meeting."}
                              </Text>
                            </Stack>
                          </Surface>
                        );
                      })
                    )}
                  </Stack>
                </ScrollArea>
              </Stack>
            </Surface>
          </Grid.Col>
          <Grid.Col
            span={{ base: 12, md: 8 }}
            style={{
              display: "flex",
              minHeight: 0,
              height: "100%",
              maxHeight: "100%",
            }}
          >
            <Surface
              p="md"
              style={{
                position: "relative",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                maxHeight: "100%",
              }}
              data-testid="ask-pane"
            >
              <LoadingOverlay
                visible={
                  listQuery.isLoading ||
                  listQuery.isFetching ||
                  conversationQuery.isLoading ||
                  conversationQuery.isFetching
                }
                overlayProps={uiOverlays.loading}
                loaderProps={{ size: "md" }}
              />
              <Stack gap="md" style={{ height: "100%", minHeight: 0 }}>
                <Group justify="space-between" align="center">
                  <Group gap="sm">
                    <ThemeIcon variant="light" color="brand">
                      <IconMessage size={16} />
                    </ThemeIcon>
                    {renaming && showRename ? (
                      <TextInput
                        value={renameDraft}
                        onChange={(event) =>
                          setRenameDraft(event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleRenameSave();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            if (activeConversation) {
                              setRenameDraft(activeConversation.title);
                            }
                            setRenaming(false);
                          }
                        }}
                        size="sm"
                        styles={{ input: { minWidth: 220 } }}
                        data-testid="ask-rename-input"
                      />
                    ) : (
                      <Text fw={600} data-testid="ask-title">
                        {displayTitle}
                      </Text>
                    )}
                  </Group>
                  {showRename && selectedGuildId ? (
                    renaming ? (
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconCheck size={14} />}
                          onClick={handleRenameSave}
                          loading={renameMutation.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          leftSection={<IconX size={14} />}
                          onClick={() => {
                            setRenameDraft(
                              activeConversation?.title ?? displayTitle,
                            );
                            setRenaming(false);
                          }}
                        >
                          Cancel
                        </Button>
                      </Group>
                    ) : (
                      <Button
                        size="xs"
                        variant="subtle"
                        leftSection={<IconPencil size={14} />}
                        onClick={() => setRenaming(true)}
                        data-testid="ask-rename"
                      >
                        Rename
                      </Button>
                    )
                  ) : selectedGuildId ? null : (
                    <Text size="xs" c="dimmed">
                      Select a server to ask questions.
                    </Text>
                  )}
                </Group>
                {renameError ? (
                  <Text size="xs" c="red">
                    {renameError}
                  </Text>
                ) : null}
                <Divider />
                <ScrollArea
                  style={{ flex: 1, minHeight: 0 }}
                  viewportRef={chatViewportRef}
                  type="always"
                  offsetScrollbars
                  scrollbarSize={10}
                  data-testid="ask-messages"
                  styles={{
                    viewport: {
                      paddingRight: `var(--mantine-spacing-${uiSpacing.scrollAreaGutter})`,
                    },
                  }}
                >
                  <Stack gap="sm">
                    {conversationQuery.error ? (
                      <Center py="lg">
                        <Text size="sm" c="dimmed">
                          Conversation unavailable.
                        </Text>
                      </Center>
                    ) : displayMessages.length === 0 ? (
                      <Center py="lg">
                        <Text size="sm" c="dimmed">
                          Start by asking about a recent meeting.
                        </Text>
                      </Center>
                    ) : (
                      displayMessages.map((message) => (
                        <Surface
                          key={message.id}
                          p="sm"
                          tone={
                            message.role === "chronote" ? "soft" : "default"
                          }
                          radius={uiRadii.bubble}
                          data-testid="ask-message"
                          data-role={message.role}
                          data-message-id={message.id}
                          style={{
                            alignSelf:
                              message.role === "user"
                                ? "flex-end"
                                : "flex-start",
                            maxWidth: "88%",
                          }}
                        >
                          <Stack gap={6}>
                            <Group gap="xs">
                              <Text size="xs" c="dimmed" fw={600}>
                                {message.role === "user" ? "You" : "Chronote"}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {formatTime(message.createdAt)}
                              </Text>
                            </Group>
                            {message.id === "thinking" ? (
                              <Group gap="xs">
                                <Loader size="xs" />
                                <Text size="sm" c="dimmed">
                                  {message.text}
                                </Text>
                              </Group>
                            ) : message.role === "chronote" ? (
                              <TypographyStylesProvider>
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    a: (props) => {
                                      const resolvedHref = props.href
                                        ? getDiscordOpenUrl(props.href)
                                        : undefined;
                                      return (
                                        <a
                                          {...props}
                                          href={resolvedHref}
                                          target="_blank"
                                          rel="noreferrer"
                                          style={{
                                            color: uiColors.linkAccent,
                                          }}
                                        />
                                      );
                                    },
                                    p: (props) => (
                                      <p {...props} style={{ margin: 0 }} />
                                    ),
                                  }}
                                >
                                  {message.text}
                                </ReactMarkdown>
                              </TypographyStylesProvider>
                            ) : (
                              <Text size="sm">{message.text}</Text>
                            )}
                          </Stack>
                        </Surface>
                      ))
                    )}
                  </Stack>
                </ScrollArea>
                <Divider my="xs" />
                <Stack gap="sm">
                  <Textarea
                    placeholder="Ask about decisions, action items, or what was discussed..."
                    minRows={3}
                    value={draft}
                    onChange={(event) => setDraft(event.currentTarget.value)}
                    disabled={!selectedGuildId || askMutation.isPending}
                    ref={inputRef}
                    data-testid="ask-input"
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        (event.ctrlKey || event.metaKey)
                      ) {
                        event.preventDefault();
                        void handleAsk();
                      }
                    }}
                  />
                  {errorMessage ? (
                    <Text size="xs" c="red">
                      {errorMessage}
                    </Text>
                  ) : null}
                  <Group justify="space-between" align="center" wrap="wrap">
                    <Text size="xs" c="dimmed">
                      Searches recent meetings by default.
                    </Text>
                    <Button
                      variant="gradient"
                      gradient={{ from: "brand", to: "violet" }}
                      leftSection={<IconSparkles size={16} />}
                      onClick={handleAsk}
                      disabled={
                        !draft.trim() ||
                        !selectedGuildId ||
                        askMutation.isPending
                      }
                      loading={askMutation.isPending}
                      data-testid="ask-send"
                    >
                      Ask
                    </Button>
                  </Group>
                </Stack>
              </Stack>
            </Surface>
          </Grid.Col>
        </Grid>
      </div>
    </Stack>
  );
}
