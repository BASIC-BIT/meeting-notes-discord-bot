import { useEffect, useMemo } from "react";
import {
  AppShell,
  Box,
  Container,
  Divider,
  Group,
  LoadingOverlay,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  TypographyStylesProvider,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { IconMessage } from "@tabler/icons-react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useParams, useRouterState } from "@tanstack/react-router";
import AuthBanner from "../components/AuthBanner";
import PageHeader from "../components/PageHeader";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import Surface from "../components/Surface";
import { trpc } from "../services/trpc";
import { useVisualMode } from "../hooks/useVisualMode";
import { getDiscordOpenUrl } from "../utils/discordLinks";
import {
  appBackground,
  pagePaddingX,
  portalBackground,
  shellBorder,
  shellHeaderBackground,
  shellHeights,
  shellShadow,
  uiColors,
  uiOverlays,
  uiRadii,
  uiSpacing,
} from "../uiTokens";

const formatTime = (value: string) => format(new Date(value), "HH:mm");

export default function PublicAsk() {
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme("dark");
  const isDark = colorScheme === "dark";
  const visualMode = useVisualMode();
  const params = useParams({ strict: false }) as {
    serverId?: string;
    conversationId?: string;
  };
  const location = useRouterState({ select: (state) => state.location });
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const highlightedMessageId = searchParams.get("messageId");

  const query = trpc.ask.getPublicConversation.useQuery(
    {
      serverId: params.serverId ?? "",
      conversationId: params.conversationId ?? "",
    },
    { enabled: Boolean(params.serverId && params.conversationId) },
  );

  const conversation = query.data?.conversation ?? null;
  const messages = query.data?.messages ?? [];
  const sharedMeta = query.data?.shared ?? null;

  useEffect(() => {
    if (!highlightedMessageId) return;
    const target = document.querySelector(
      `[data-message-id="${highlightedMessageId}"]`,
    );
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedMessageId, messages.length]);

  const renderBody = () => {
    if (query.isLoading) {
      return (
        <Text size="sm" c="dimmed">
          Loading shared thread...
        </Text>
      );
    }
    if (!conversation || query.error) {
      return (
        <Text size="sm" c="dimmed">
          This shared thread is unavailable.
        </Text>
      );
    }

    return (
      <Stack gap="md">
        <Group gap="sm" align="center">
          <ThemeIcon variant="light" color="brand">
            <IconMessage size={16} />
          </ThemeIcon>
          <Text fw={600}>{conversation.title}</Text>
        </Group>
        <Text size="sm" c="dimmed">
          Shared by {sharedMeta?.ownerTag ?? "Unknown member"}
        </Text>
        <Divider />
        <ScrollArea
          style={{ minHeight: 240, maxHeight: "60vh" }}
          type="always"
          offsetScrollbars
          scrollbarSize={10}
          data-visual-scroll
          styles={{
            viewport: {
              paddingRight: `var(--mantine-spacing-${uiSpacing.scrollAreaGutter})`,
            },
          }}
        >
          <Stack gap="sm">
            {messages.map((message) => (
              <Surface
                key={message.id}
                p="sm"
                tone={message.role === "chronote" ? "soft" : "default"}
                radius={uiRadii.bubble}
                data-message-id={message.id}
                style={{
                  alignSelf:
                    message.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  border:
                    highlightedMessageId === message.id
                      ? `1px solid ${uiColors.highlightBorderSoft}`
                      : undefined,
                }}
              >
                <Stack gap={6}>
                  <Group gap="xs">
                    <Text size="xs" c="dimmed" fw={600}>
                      {message.role === "user" ? "Participant" : "Chronote"}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {formatTime(message.createdAt)}
                    </Text>
                  </Group>
                  {message.role === "chronote" ? (
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
                          p: (props) => <p {...props} style={{ margin: 0 }} />,
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
            ))}
          </Stack>
        </ScrollArea>
      </Stack>
    );
  };

  return (
    <AppShell
      padding={0}
      header={{ height: shellHeights.header }}
      style={{
        minHeight: visualMode ? "100vh" : undefined,
        height: visualMode ? "auto" : undefined,
        overflow: visualMode ? "visible" : undefined,
      }}
      styles={{
        header: visualMode
          ? {
              borderBottom: shellBorder(theme, isDark),
              backgroundColor: shellHeaderBackground(isDark),
              backdropFilter: "blur(16px)",
              boxShadow: shellShadow(isDark),
              position: "static",
            }
          : {
              borderBottom: shellBorder(theme, isDark),
              backgroundColor: shellHeaderBackground(isDark),
              backdropFilter: "blur(16px)",
              boxShadow: shellShadow(isDark),
            },
        main: visualMode
          ? {
              backgroundColor: appBackground(theme, isDark),
              paddingTop: 0,
              paddingBottom: 0,
              paddingInlineStart: 0,
              paddingInlineEnd: 0,
              minHeight: "auto",
              height: "auto",
              overflow: "visible",
            }
          : {
              backgroundColor: appBackground(theme, isDark),
            },
      }}
    >
      <AppShell.Header p="md">
        <SiteHeader
          showNavbarToggle={false}
          navbarOpened={false}
          onNavbarToggle={() => {}}
          context="marketing"
        />
      </AppShell.Header>
      <AppShell.Main>
        <Box
          py={{ base: "xl", md: "xl" }}
          style={{ backgroundImage: portalBackground(isDark) }}
        >
          <Container size="md" px={pagePaddingX}>
            <Stack gap="lg">
              <PageHeader
                title={conversation?.title ?? "Shared Ask"}
                description="Read-only thread shared from Chronote."
              />
              <AuthBanner message="Connect to ask Chronote about your own meetings." />
              <Surface
                p="lg"
                style={{ position: "relative", overflow: "hidden" }}
              >
                <LoadingOverlay
                  visible={query.isLoading}
                  overlayProps={uiOverlays.loading}
                  loaderProps={{ size: "md" }}
                />
                {renderBody()}
              </Surface>
            </Stack>
          </Container>
          <SiteFooter />
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
