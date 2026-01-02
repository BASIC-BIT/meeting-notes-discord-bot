import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Center,
  Divider,
  Grid,
  Group,
  LoadingOverlay,
  Loader,
  Modal,
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
  IconX,
  IconCheck,
  IconSparkles,
  IconShare2,
  IconLink,
  IconCopy,
  IconArchive,
  IconArchiveOff,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import Surface from "../components/Surface";
import PageHeader from "../components/PageHeader";
import { ConversationListPanel } from "../features/ask/ConversationListPanel";
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
import {
  buildAskUrl,
  buildDisplayMessages,
  buildPublicAskUrl,
  formatTime,
  resolveListMode,
  truncate,
  type ListMode,
} from "../utils/askLinks";
import { resolveNowMs } from "../utils/now";

const buildConversationListUpdate =
  (conversation: AskConversation) =>
  (prev?: { conversations: AskConversation[] } | null) => {
    const existing = prev?.conversations ?? [];
    const updated = existing.filter((conv) => conv.id !== conversation.id);
    return { conversations: [conversation, ...updated] };
  };

const buildConversationDetailUpdate =
  (conversation: AskConversation) =>
  (prev?: { messages: AskMessage[] } | null) => ({
    conversation,
    messages: prev?.messages ?? [],
  });

export default function Ask() {
  const { selectedGuildId, guilds } = useGuildContext();
  const trpcUtils = trpc.useUtils();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const search = useSearch({ strict: false }) as {
    list?: "mine" | "shared" | "archived";
    messageId?: string;
  };
  const listMode = resolveListMode(search.list ?? null);
  const highlightedMessageId = search.messageId ?? null;
  const routeConversationId = params.conversationId ?? null;
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<AskMessage[]>(
    [],
  );
  const [optimisticConversation, setOptimisticConversation] =
    useState<AskConversation | null>(null);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const previousListModeRef = useRef<ListMode>(listMode);
  const activeId = isCreatingNew ? null : routeConversationId;
  const selectedGuild = selectedGuildId
    ? (guilds.find((guild) => guild.id === selectedGuildId) ?? null)
    : null;
  const canManage = selectedGuild?.canManage ?? false;

  const settingsQuery = trpc.ask.settings.useQuery(
    { serverId: selectedGuildId ?? "" },
    { enabled: Boolean(selectedGuildId) },
  );
  const askMembersEnabled = settingsQuery.data?.askMembersEnabled ?? true;
  const askSharingPolicy = settingsQuery.data?.askSharingPolicy ?? "server";
  const sharingEnabled = askSharingPolicy !== "off";
  const publicSharingEnabled = askSharingPolicy === "public";
  const askAccessAllowed = canManage || askMembersEnabled;

  const listQuery = trpc.ask.listConversations.useQuery(
    { serverId: selectedGuildId ?? "" },
    {
      enabled: Boolean(selectedGuildId && askAccessAllowed),
      staleTime: 30_000,
    },
  );
  const sharedListQuery = trpc.ask.listSharedConversations.useQuery(
    { serverId: selectedGuildId ?? "" },
    {
      enabled: Boolean(
        selectedGuildId &&
        askAccessAllowed &&
        sharingEnabled &&
        listMode === "shared",
      ),
      staleTime: 30_000,
    },
  );
  const conversationQuery = trpc.ask.getConversation.useQuery(
    { serverId: selectedGuildId ?? "", conversationId: activeId ?? "" },
    {
      enabled: Boolean(
        selectedGuildId &&
        askAccessAllowed &&
        activeId &&
        listMode !== "shared",
      ),
      staleTime: 30_000,
      placeholderData: (prev) => prev,
    },
  );
  const sharedConversationQuery = trpc.ask.getSharedConversation.useQuery(
    { serverId: selectedGuildId ?? "", conversationId: activeId ?? "" },
    {
      enabled: Boolean(
        selectedGuildId &&
        askAccessAllowed &&
        activeId &&
        listMode === "shared" &&
        sharingEnabled,
      ),
      staleTime: 30_000,
      placeholderData: (prev) => prev,
    },
  );
  const askMutation = trpc.ask.ask.useMutation();
  const renameMutation = trpc.ask.rename.useMutation();
  const shareMutation = trpc.ask.setVisibility.useMutation();
  const archiveMutation = trpc.ask.setArchived.useMutation();

  const mineConversations = listQuery.data?.conversations ?? [];
  const sharedConversations = sharedListQuery.data?.conversations ?? [];
  const activeConversations = useMemo(
    () => mineConversations.filter((conv) => !conv.archivedAt),
    [mineConversations],
  );
  const archivedConversations = useMemo(
    () => mineConversations.filter((conv) => conv.archivedAt),
    [mineConversations],
  );
  const listBusy =
    listMode === "shared"
      ? sharedListQuery.isLoading || sharedListQuery.isFetching
      : listQuery.isLoading || listQuery.isFetching;
  const conversationBusy =
    listMode === "shared"
      ? sharedConversationQuery.isLoading || sharedConversationQuery.isFetching
      : conversationQuery.isLoading || conversationQuery.isFetching;
  const conversationError =
    listMode === "shared"
      ? sharedConversationQuery.error
      : conversationQuery.error;
  const activeConversation = isCreatingNew
    ? null
    : listMode === "shared"
      ? (sharedConversationQuery.data?.conversation ?? null)
      : (conversationQuery.data?.conversation ?? null);
  const activeMessages = isCreatingNew
    ? []
    : listMode === "shared"
      ? (sharedConversationQuery.data?.messages ?? [])
      : (conversationQuery.data?.messages ?? []);
  const sharedMeta =
    listMode === "shared"
      ? (sharedConversationQuery.data?.shared ?? null)
      : null;

  const navigateToConversation = useCallback(
    (conversationId: string | null, mode: ListMode) => {
      if (!selectedGuildId) return;
      if (conversationId) {
        navigate({
          to: "/portal/server/$serverId/ask/$conversationId",
          params: { serverId: selectedGuildId, conversationId },
          search: (prev) => ({
            ...prev,
            list: mode,
            messageId: undefined,
          }),
        });
      } else {
        navigate({
          to: "/portal/server/$serverId/ask",
          params: { serverId: selectedGuildId },
          search: (prev) => ({
            ...prev,
            list: mode,
            messageId: undefined,
          }),
        });
      }
    },
    [navigate, selectedGuildId],
  );

  const handleListModeChange = useCallback(
    (mode: ListMode) => {
      setIsCreatingNew(false);
      navigateToConversation(activeId, mode);
    },
    [activeId, navigateToConversation],
  );

  const listIds = useMemo(
    () =>
      listMode === "shared"
        ? sharedConversations.map((conv) => conv.conversationId)
        : listMode === "archived"
          ? archivedConversations.map((conv) => conv.id)
          : activeConversations.map((conv) => conv.id),
    [listMode, activeConversations, archivedConversations, sharedConversations],
  );

  useEffect(() => {
    if (!selectedGuildId) {
      setOptimisticMessages([]);
      setOptimisticConversation(null);
      setIsCreatingNew(false);
      return;
    }
    if (!askAccessAllowed) {
      setIsCreatingNew(false);
    }
  }, [selectedGuildId, askAccessAllowed]);

  useEffect(() => {
    const previousListMode = previousListModeRef.current;
    if (listMode === "shared") {
      if (!sharingEnabled) {
        if (activeId) {
          navigateToConversation(null, listMode);
        }
        return;
      }
      if (isCreatingNew) {
        setIsCreatingNew(false);
      }
      return;
    }
    if (
      listMode === "archived" &&
      isCreatingNew &&
      previousListMode !== "archived"
    ) {
      setIsCreatingNew(false);
    }
  }, [
    listMode,
    sharingEnabled,
    activeId,
    isCreatingNew,
    navigateToConversation,
  ]);

  useEffect(() => {
    previousListModeRef.current = listMode;
  }, [listMode]);

  useEffect(() => {
    if (!selectedGuildId || !askAccessAllowed) return;
    if (listMode === "shared" && !sharingEnabled) return;
    if (listBusy || conversationBusy) return;
    if (isCreatingNew) return;
    const hasActiveConversation = Boolean(
      activeConversation && activeConversation.id === activeId,
    );
    const allowMissingFromList =
      hasActiveConversation &&
      (listMode === "shared" ||
        (listMode === "archived" && Boolean(activeConversation?.archivedAt)));
    if (listIds.length === 0) {
      if (activeId && !allowMissingFromList) {
        navigateToConversation(null, listMode);
      }
      return;
    }
    if (!activeId || (!listIds.includes(activeId) && !allowMissingFromList)) {
      const nextId =
        listMode === "shared"
          ? sharedConversations[0]?.conversationId
          : listMode === "archived"
            ? archivedConversations[0]?.id
            : activeConversations[0]?.id;
      if (nextId) {
        navigateToConversation(nextId, listMode);
      }
    }
  }, [
    selectedGuildId,
    askAccessAllowed,
    listMode,
    sharingEnabled,
    listBusy,
    conversationBusy,
    isCreatingNew,
    listIds,
    activeId,
    sharedConversations,
    activeConversations,
    archivedConversations,
    activeConversation,
    navigateToConversation,
  ]);

  useEffect(() => {
    if (!activeConversation || !activeConversation.archivedAt) return;
    if (listMode !== "mine") return;
    if (isCreatingNew) return;
    navigateToConversation(activeConversation.id, "archived");
  }, [activeConversation, listMode, isCreatingNew, navigateToConversation]);

  const filteredMine = useMemo(() => {
    const source = optimisticConversation
      ? [optimisticConversation, ...activeConversations]
      : activeConversations;
    if (!query) return source;
    const needle = query.toLowerCase();
    return source.filter((conv) =>
      `${conv.title} ${conv.summary}`.toLowerCase().includes(needle),
    );
  }, [query, activeConversations, optimisticConversation]);

  const filteredArchived = useMemo(() => {
    if (!query) return archivedConversations;
    const needle = query.toLowerCase();
    return archivedConversations.filter((conv) =>
      `${conv.title} ${conv.summary}`.toLowerCase().includes(needle),
    );
  }, [query, archivedConversations]);

  const filteredShared = useMemo(() => {
    if (!query) return sharedConversations;
    const needle = query.toLowerCase();
    return sharedConversations.filter((conv) =>
      `${conv.title} ${conv.summary} ${conv.ownerTag ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [query, sharedConversations]);
  const listError =
    listMode === "shared" ? sharedListQuery.error : listQuery.error;

  const displayTitle =
    activeConversation?.title ?? optimisticConversation?.title ?? "New chat";
  const isArchived = Boolean(activeConversation?.archivedAt);
  const activeVisibility = activeConversation?.visibility ?? "private";
  const shareDisplayVisibility =
    activeVisibility === "public" && !publicSharingEnabled
      ? "server"
      : activeVisibility;
  const isShared = activeVisibility !== "private";
  const shareBadgeLabel =
    shareDisplayVisibility === "public" ? "Public" : "Shared";
  const shareActionDisabled =
    !selectedGuildId ||
    !activeConversation ||
    listMode !== "mine" ||
    isArchived ||
    !sharingEnabled ||
    !askAccessAllowed;
  const serverShareUrl =
    selectedGuildId && activeConversation && typeof window !== "undefined"
      ? buildAskUrl({
          origin: window.location.origin,
          serverId: selectedGuildId,
          conversationId: activeConversation.id,
          listMode: "shared",
        })
      : "";
  const publicShareUrl =
    selectedGuildId && activeConversation && typeof window !== "undefined"
      ? buildPublicAskUrl({
          origin: window.location.origin,
          serverId: selectedGuildId,
          conversationId: activeConversation.id,
        })
      : "";
  const shareUrl =
    shareDisplayVisibility === "public" ? publicShareUrl : serverShareUrl;
  const allowOptimistic = listMode === "mine" && !isArchived;
  const displayMessages = useMemo(() => {
    const pending = allowOptimistic ? askMutation.isPending : false;
    return buildDisplayMessages({
      activeConversation,
      activeId,
      activeMessages,
      optimisticMessages: allowOptimistic ? optimisticMessages : [],
      isPending: pending,
    });
  }, [
    activeConversation,
    activeId,
    activeMessages,
    optimisticMessages,
    askMutation.isPending,
    allowOptimistic,
  ]);
  const showRename =
    listMode === "mine" &&
    Boolean(activeConversation && displayMessages.length > 0) &&
    !isArchived;

  useEffect(() => {
    const viewport = chatViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: askMutation.isPending ? "smooth" : "auto",
    });
  }, [displayMessages.length, askMutation.isPending]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const target = document.querySelector(
      `[data-message-id="${highlightedMessageId}"]`,
    );
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [displayMessages.length, highlightedMessageId]);

  const handleNewConversation = () => {
    setIsCreatingNew(true);
    setDraft("");
    setErrorMessage(null);
    setOptimisticMessages([]);
    setOptimisticConversation(null);
    navigateToConversation(null, "mine");
  };

  useEffect(() => {
    if (!selectedGuildId || !isCreatingNew || listMode !== "mine") return;
    const handle = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [isCreatingNew, selectedGuildId, listMode]);

  useEffect(() => {
    if (!selectedGuildId) return;
    if (listMode !== "mine") return;
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
    listMode,
  ]);

  useEffect(() => {
    if (activeConversation) {
      setRenameDraft(activeConversation.title);
      setRenaming(false);
      setRenameError(null);
      setArchiveError(null);
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
    if (!selectedGuildId || !activeConversation || listMode !== "mine") return;
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
    if (!selectedGuildId || !question || listMode !== "mine") return;
    if (!askAccessAllowed) return;
    if (isArchived) return;
    setErrorMessage(null);
    const now = new Date(resolveNowMs()).toISOString();
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
      navigateToConversation(result.conversationId, "mine");
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

  const handleCopyLink = async (
    messageId?: string,
    mode: ListMode = listMode,
  ) => {
    if (!selectedGuildId || !activeConversation || !window?.location?.origin) {
      return;
    }
    const url = buildAskUrl({
      origin: window.location.origin,
      serverId: selectedGuildId,
      conversationId: activeConversation.id,
      listMode: mode,
      messageId,
    });
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.error("Failed to copy link", err);
    }
  };

  const handleCopyResponse = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error("Failed to copy response", err);
    }
  };

  const handleCopyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch (err) {
      console.error("Failed to copy share link", err);
    }
  };

  const handleShareChange = async (
    nextVisibility: "private" | "server" | "public",
  ) => {
    if (!selectedGuildId || !activeConversation) return;
    setShareError(null);
    try {
      const result = await shareMutation.mutateAsync({
        serverId: selectedGuildId,
        conversationId: activeConversation.id,
        visibility: nextVisibility,
      });
      trpcUtils.ask.listConversations.setData(
        { serverId: selectedGuildId },
        (prev) => {
          const existing = prev?.conversations ?? [];
          const updated = existing.filter(
            (conv) => conv.id !== result.conversation.id,
          );
          return { conversations: [result.conversation, ...updated] };
        },
      );
      trpcUtils.ask.getConversation.setData(
        {
          serverId: selectedGuildId,
          conversationId: result.conversation.id,
        },
        (prev) => ({
          conversation: result.conversation,
          messages: prev?.messages ?? [],
        }),
      );
      await trpcUtils.ask.listSharedConversations.invalidate({
        serverId: selectedGuildId,
      });
      setShareModalOpen(false);
    } catch (err) {
      setShareError(
        err instanceof Error ? err.message : "Unable to update sharing.",
      );
    }
  };

  const closeArchiveOverlays = () => {
    setShareModalOpen(false);
    setRenaming(false);
  };

  const updateConversationCaches = (conversation: AskConversation) => {
    const serverId = selectedGuildId ?? "";
    trpcUtils.ask.listConversations.setData(
      { serverId },
      buildConversationListUpdate(conversation),
    );
    trpcUtils.ask.getConversation.setData(
      { serverId, conversationId: conversation.id },
      buildConversationDetailUpdate(conversation),
    );
  };

  const maybeExitArchivedView = (conversationId: string, archived: boolean) => {
    if (!archived && listMode === "archived") {
      navigateToConversation(conversationId, "mine");
    }
  };

  const handleArchiveToggle = async (archived: boolean) => {
    if (!selectedGuildId || !activeConversation) return;
    if (listMode === "shared") return;
    setArchiveError(null);
    try {
      const result = await archiveMutation.mutateAsync({
        serverId: selectedGuildId,
        conversationId: activeConversation.id,
        archived,
      });
      closeArchiveOverlays();
      updateConversationCaches(result.conversation);
      await trpcUtils.ask.listSharedConversations.invalidate({
        serverId: selectedGuildId,
      });
      maybeExitArchivedView(result.conversation.id, archived);
    } catch (err) {
      setArchiveError(
        err instanceof Error ? err.message : "Unable to update archive state.",
      );
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
        description="Query recent meetings with links back to your notes. Conversations stay scoped to the selected server."
      />

      <Modal
        opened={shareModalOpen}
        onClose={() => {
          setShareModalOpen(false);
          setShareError(null);
        }}
        title="Share thread"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {publicSharingEnabled
              ? "Sharing can be limited to the server or made public. Your Discord username will be shown."
              : "Sharing makes this thread visible to members of this server. Your Discord username will be shown."}
          </Text>
          {!sharingEnabled ? (
            <Text size="sm" c="dimmed">
              Sharing is disabled for this server.
            </Text>
          ) : null}
          {sharingEnabled && activeConversation ? (
            isShared ? (
              <>
                <TextInput
                  label={
                    shareDisplayVisibility === "public"
                      ? "Public link"
                      : "Shared link"
                  }
                  value={shareUrl}
                  readOnly
                  rightSection={
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={handleCopyShareLink}
                      aria-label="Copy share link"
                    >
                      <IconLink size={16} />
                    </ActionIcon>
                  }
                />
                <Group justify="space-between" align="center" wrap="wrap">
                  <Button
                    variant="light"
                    color="red"
                    onClick={() => handleShareChange("private")}
                    loading={shareMutation.isPending}
                  >
                    Turn off sharing
                  </Button>
                  <Group gap="xs">
                    {publicSharingEnabled && activeVisibility === "server" ? (
                      <Button
                        variant="subtle"
                        onClick={() => handleShareChange("public")}
                        loading={shareMutation.isPending}
                      >
                        Make public
                      </Button>
                    ) : null}
                    {publicSharingEnabled && activeVisibility === "public" ? (
                      <Button
                        variant="subtle"
                        onClick={() => handleShareChange("server")}
                        loading={shareMutation.isPending}
                      >
                        Make server-only
                      </Button>
                    ) : null}
                    <Button
                      variant="subtle"
                      leftSection={<IconLink size={14} />}
                      onClick={handleCopyShareLink}
                    >
                      Copy link
                    </Button>
                  </Group>
                </Group>
              </>
            ) : (
              <Group gap="xs">
                <Button
                  onClick={() => handleShareChange("server")}
                  loading={shareMutation.isPending}
                >
                  Share with server
                </Button>
                {publicSharingEnabled ? (
                  <Button
                    variant="light"
                    onClick={() => handleShareChange("public")}
                    loading={shareMutation.isPending}
                  >
                    Share publicly
                  </Button>
                ) : null}
              </Group>
            )
          ) : null}
          {shareError ? (
            <Text size="xs" c="red">
              {shareError}
            </Text>
          ) : null}
        </Stack>
      </Modal>

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
          <Grid.Col span={{ base: 12, md: 4 }} style={{ height: "100%" }}>
            <ConversationListPanel
              listMode={listMode}
              onListModeChange={handleListModeChange}
              query={query}
              onQueryChange={setQuery}
              mineConversations={filteredMine}
              archivedConversations={filteredArchived}
              sharedConversations={filteredShared}
              listBusy={listBusy}
              listError={listError}
              activeId={activeId}
              onNewConversation={handleNewConversation}
              navigateToConversation={(id, mode) => {
                setIsCreatingNew(false);
                navigateToConversation(id, mode);
              }}
              sharingEnabled={sharingEnabled}
              askAccessAllowed={askAccessAllowed}
            />
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
                visible={listBusy || conversationBusy}
                data-testid="ask-loading-pane"
                overlayProps={uiOverlays.loading}
                loaderProps={{ size: "md" }}
              />
              <Stack gap="md" style={{ height: "100%", minHeight: 0 }}>
                <Group justify="space-between" align="center" wrap="wrap">
                  <Group gap="sm" align="center" wrap="wrap">
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
                      <Group gap="xs" align="center" wrap="wrap">
                        <Text fw={600} data-testid="ask-title">
                          {displayTitle}
                        </Text>
                        {isShared ? (
                          <Badge
                            size="xs"
                            variant="light"
                            color={
                              shareDisplayVisibility === "public"
                                ? "teal"
                                : "cyan"
                            }
                          >
                            {shareBadgeLabel}
                          </Badge>
                        ) : null}
                        {isArchived ? (
                          <Badge size="xs" variant="light" color="gray">
                            Archived
                          </Badge>
                        ) : null}
                      </Group>
                    )}
                  </Group>
                  <Group gap="xs" align="center" wrap="wrap">
                    {listMode === "mine" && activeConversation ? (
                      <Button
                        size="xs"
                        variant="subtle"
                        leftSection={<IconShare2 size={14} />}
                        onClick={() => setShareModalOpen(true)}
                        disabled={shareActionDisabled}
                        data-testid="ask-share"
                      >
                        Share
                      </Button>
                    ) : null}
                    {listMode !== "shared" && activeConversation ? (
                      <Button
                        size="xs"
                        variant="subtle"
                        leftSection={
                          isArchived ? (
                            <IconArchiveOff size={14} />
                          ) : (
                            <IconArchive size={14} />
                          )
                        }
                        onClick={() => handleArchiveToggle(!isArchived)}
                        loading={archiveMutation.isPending}
                        data-testid={
                          isArchived ? "ask-unarchive" : "ask-archive"
                        }
                      >
                        {isArchived ? "Unarchive" : "Archive"}
                      </Button>
                    ) : null}
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
                </Group>
                {listMode === "shared" && sharedMeta?.ownerTag ? (
                  <Text size="xs" c="dimmed">
                    Shared by {sharedMeta.ownerTag}
                  </Text>
                ) : null}
                {listMode === "mine" && isShared && !sharingEnabled ? (
                  <Text size="xs" c="dimmed">
                    Sharing is disabled by server settings.
                  </Text>
                ) : null}
                {renameError ? (
                  <Text size="xs" c="red">
                    {renameError}
                  </Text>
                ) : null}
                {archiveError ? (
                  <Text size="xs" c="red">
                    {archiveError}
                  </Text>
                ) : null}
                {listMode === "shared" && activeConversation ? (
                  <Surface p="sm" tone="soft">
                    <Group justify="space-between" align="center" wrap="wrap">
                      <Text size="sm" c="dimmed">
                        Shared threads are read only. Start a new chat to keep
                        exploring.
                      </Text>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={handleNewConversation}
                      >
                        Start new chat
                      </Button>
                    </Group>
                  </Surface>
                ) : null}
                {isArchived ? (
                  <Surface p="sm" tone="soft">
                    <Text size="sm" c="dimmed">
                      {listMode === "shared"
                        ? "This thread was archived by its owner and is read only."
                        : "Archived chats are read only. Unarchive to continue."}
                    </Text>
                  </Surface>
                ) : null}
                <Divider />
                <ScrollArea
                  style={{ flex: 1, minHeight: 0 }}
                  viewportRef={chatViewportRef}
                  type="always"
                  offsetScrollbars
                  scrollbarSize={10}
                  data-visual-scroll
                  data-testid="ask-messages"
                  styles={{
                    viewport: {
                      paddingRight: `var(--mantine-spacing-${uiSpacing.scrollAreaGutter})`,
                    },
                  }}
                >
                  <Stack gap="sm">
                    {!askAccessAllowed ? (
                      <Center py="lg">
                        <Text size="sm" c="dimmed">
                          Ask access is disabled for members in this server.
                        </Text>
                      </Center>
                    ) : listMode === "shared" && !sharingEnabled ? (
                      <Center py="lg">
                        <Text size="sm" c="dimmed">
                          Sharing is disabled for this server.
                        </Text>
                      </Center>
                    ) : conversationError ? (
                      <Center py="lg">
                        <Text size="sm" c="dimmed">
                          Conversation unavailable.
                        </Text>
                      </Center>
                    ) : displayMessages.length === 0 ? (
                      <Center py="lg">
                        <Text size="sm" c="dimmed">
                          {listMode === "shared"
                            ? "Select a shared conversation to view it."
                            : "Start by asking about a recent meeting."}
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
                            border:
                              highlightedMessageId === message.id
                                ? `1px solid ${uiColors.highlightBorderSoft}`
                                : undefined,
                            boxShadow:
                              highlightedMessageId === message.id
                                ? uiEffects.activeInset
                                : undefined,
                          }}
                        >
                          <Stack gap={6}>
                            <Group gap="xs" justify="space-between">
                              <Group gap="xs">
                                <Text size="xs" c="dimmed" fw={600}>
                                  {message.role === "user" ? "You" : "Chronote"}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {formatTime(message.createdAt)}
                                </Text>
                              </Group>
                              <Group gap="xs">
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  color="gray"
                                  onClick={() => handleCopyLink(message.id)}
                                  aria-label="Copy message link"
                                >
                                  <IconLink size={14} />
                                </ActionIcon>
                                {message.role === "chronote" ? (
                                  <ActionIcon
                                    size="sm"
                                    variant="subtle"
                                    color="gray"
                                    onClick={() =>
                                      handleCopyResponse(message.text)
                                    }
                                    aria-label="Copy response"
                                  >
                                    <IconCopy size={14} />
                                  </ActionIcon>
                                ) : null}
                              </Group>
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
                    placeholder={
                      listMode === "shared"
                        ? "Shared threads are read only."
                        : isArchived
                          ? "Archived chats are read only."
                          : "Ask about decisions, action items, or what was discussed..."
                    }
                    minRows={3}
                    value={draft}
                    onChange={(event) => setDraft(event.currentTarget.value)}
                    disabled={
                      !selectedGuildId ||
                      !askAccessAllowed ||
                      listMode !== "mine" ||
                      isArchived ||
                      askMutation.isPending
                    }
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
                      Searches recent meetings by default. Press Ctrl+Enter to
                      send.
                    </Text>
                    <Button
                      variant="gradient"
                      gradient={{ from: "brand", to: "violet" }}
                      leftSection={<IconSparkles size={16} />}
                      onClick={handleAsk}
                      disabled={
                        !draft.trim() ||
                        !selectedGuildId ||
                        !askAccessAllowed ||
                        listMode !== "mine" ||
                        isArchived ||
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
