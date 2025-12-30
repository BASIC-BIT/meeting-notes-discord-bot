import { jest } from "@jest/globals";
import type {
  AskConversation,
  AskMessage,
  AskSharedConversation,
} from "../../../src/types/ask";
import type { AutoRecordSettings, ChannelContext } from "../../../src/types/db";
import type { MeetingStatus } from "../../../src/types/meetingLifecycle";
import type { PaidPlan } from "../../../src/types/pricing";

type QueryState<T> = {
  data: T | null;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: jest.Mock<Promise<void>, []>;
};

type MutationState<TArgs extends unknown[], TResult> = {
  mutateAsync: jest.Mock<Promise<TResult>, TArgs>;
  isPending: boolean;
  reset: jest.Mock<void, []>;
};

type ChannelSummary = {
  id: string;
  name: string;
  botAccess: boolean;
  missingPermissions?: string[];
};

export type BillingData = {
  billingEnabled: boolean;
  tier: "free" | "basic" | "pro";
  status: string;
  nextBillingDate?: string | null;
  usage?: { usedMinutes?: number; limitMinutes?: number } | null;
};

export type MeetingSummaryRow = {
  id: string;
  meetingId: string;
  channelId: string;
  channelName: string;
  timestamp: string;
  duration: number;
  tags: string[];
  notes: string;
  summarySentence?: string;
  summaryLabel?: string;
  notesChannelId?: string;
  notesMessageId?: string;
  audioAvailable: boolean;
  transcriptAvailable: boolean;
  status?: MeetingStatus;
};

export type MeetingEvent = {
  id: string;
  type: "voice" | "chat" | "tts" | "presence" | "bot";
  time: string;
  speaker?: string;
  text: string;
  messageId?: string;
};

export type MeetingDetail = {
  id: string;
  meetingId: string;
  channelId: string;
  timestamp: string;
  duration: number;
  tags?: string[];
  notes?: string | null;
  summarySentence?: string | null;
  summaryLabel?: string | null;
  audioUrl?: string | null;
  attendees?: string[];
  events?: MeetingEvent[];
  status?: MeetingStatus;
};

type PricingPlansData = { plans: PaidPlan[] };
type BillingDataQuery = BillingData;
type MeetingsListData = { meetings: MeetingSummaryRow[] };
type MeetingsDetailData = { meeting: MeetingDetail | null };
type ChannelsData = {
  voiceChannels: ChannelSummary[];
  textChannels: ChannelSummary[];
};
type AskListData = { conversations: AskConversation[] };
type AskConversationData = {
  conversation: AskConversation | null;
  messages: AskMessage[];
};
type AskSettingsData = {
  askMembersEnabled: boolean;
  askSharingPolicy: "off" | "server" | "public";
};
type AskSharedListData = { conversations: AskSharedConversation[] };
type AskSharedConversationData = {
  conversation: AskConversation | null;
  messages: AskMessage[];
  shared: AskSharedConversation | null;
};
type AskPublicConversationData = AskSharedConversationData;
type RulesData = { rules: AutoRecordSettings[] };
type ContextData = {
  context?: string | null;
  defaultTags?: string[] | null;
  defaultNotesChannelId?: string | null;
  liveVoiceEnabled?: boolean | null;
  liveVoiceTtsVoice?: string | null;
  chatTtsEnabled?: boolean | null;
  chatTtsVoice?: string | null;
  askMembersEnabled?: boolean | null;
  askSharingPolicy?: "off" | "server" | "public" | null;
};
type ChannelContextsData = { contexts: ChannelContext[] };
type ConfigSnapshot = {
  values: Record<string, { value?: unknown; gated?: boolean; source?: string }>;
  tier?: "free" | "basic" | "pro";
};
type ConfigServerData = {
  registry: {
    key: string;
    label: string;
    description: string;
    category: string;
    valueType: string;
    defaultValue: unknown;
    ui: {
      type: string;
      options?: string[];
      min?: number;
      max?: number;
      step?: number;
    };
  }[];
  snapshot: ConfigSnapshot;
  overrides: { scopeId: string; configKey: string; value: unknown }[];
};

const buildQueryState = <T>(data: T | null): QueryState<T> => ({
  data,
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
});

const buildMutationState = <TArgs extends unknown[], TResult>(
  result: TResult,
): MutationState<TArgs, TResult> => ({
  mutateAsync: jest.fn<Promise<TResult>, TArgs>().mockResolvedValue(result),
  isPending: false,
  reset: jest.fn(),
});

const resetQueryState = <T>(state: QueryState<T>, data: T | null) => {
  state.data = data;
  state.isLoading = false;
  state.isFetching = false;
  state.error = null;
  state.refetch.mockReset();
  state.refetch.mockResolvedValue(undefined);
};

const resetMutationState = <TArgs extends unknown[], TResult>(
  state: MutationState<TArgs, TResult>,
  result: TResult,
) => {
  state.isPending = false;
  state.mutateAsync.mockReset();
  state.mutateAsync.mockResolvedValue(result);
  state.reset.mockReset();
};

export const authQuery = buildQueryState<{ id: string } | null>(null);
export const guildQuery = buildQueryState<{
  guilds: { id: string; name: string; canManage?: boolean }[];
} | null>(null);
export const pricingQuery = buildQueryState<PricingPlansData>({ plans: [] });
export const billingQuery = buildQueryState<BillingDataQuery | null>(null);
export const meetingsListQuery = buildQueryState<MeetingsListData>({
  meetings: [],
});
export const meetingsDetailQuery = buildQueryState<MeetingsDetailData>({
  meeting: null,
});
export const serversChannelsQuery = buildQueryState<ChannelsData>({
  voiceChannels: [],
  textChannels: [],
});
export const askListQuery = buildQueryState<AskListData>({ conversations: [] });
export const askSettingsQuery = buildQueryState<AskSettingsData>({
  askMembersEnabled: true,
  askSharingPolicy: "server",
});
export const askSharedListQuery = buildQueryState<AskSharedListData>({
  conversations: [],
});
export const askConversationQuery = buildQueryState<AskConversationData>({
  conversation: null,
  messages: [],
});
export const askSharedConversationQuery =
  buildQueryState<AskSharedConversationData>({
    conversation: null,
    messages: [],
    shared: null,
  });
export const askPublicConversationQuery =
  buildQueryState<AskPublicConversationData>({
    conversation: null,
    messages: [],
    shared: null,
  });
export const autorecordListQuery = buildQueryState<RulesData>({ rules: [] });
export const contextQuery = buildQueryState<ContextData | null>(null);
export const channelContextsQuery = buildQueryState<ChannelContextsData>({
  contexts: [],
});
export const configServerQuery = buildQueryState<ConfigServerData>({
  registry: [],
  snapshot: { values: {}, tier: "free" },
  overrides: [],
});

export const billingCheckoutMutation = buildMutationState<
  [unknown],
  { url: string }
>({ url: "https://example.com/checkout" });
export const billingPortalMutation = buildMutationState<
  [unknown],
  { url: string }
>({ url: "https://example.com/portal" });
export const askMutation = buildMutationState<[unknown], void>(undefined);
export const askRenameMutation = buildMutationState<[unknown], void>(undefined);
export const askVisibilityMutation = buildMutationState<
  [unknown],
  { conversation: AskConversation } | null
>(null);
export const autorecordAddMutation = buildMutationState<[unknown], void>(
  undefined,
);
export const autorecordRemoveMutation = buildMutationState<[unknown], void>(
  undefined,
);
export const contextSetMutation = buildMutationState<[unknown], void>(
  undefined,
);
export const channelContextsSetMutation = buildMutationState<[unknown], void>(
  undefined,
);
export const channelContextsClearMutation = buildMutationState<[unknown], void>(
  undefined,
);
export const configSetServerMutation = buildMutationState<[unknown], void>(
  undefined,
);
export const configClearServerMutation = buildMutationState<[unknown], void>(
  undefined,
);

export const trpcUtils = {
  ask: {
    listConversations: {
      invalidate: jest.fn<Promise<void>, [unknown]>(),
      setData: jest.fn(),
    },
    listSharedConversations: {
      invalidate: jest.fn<Promise<void>, [unknown]>(),
      setData: jest.fn(),
    },
    getConversation: {
      invalidate: jest.fn<Promise<void>, [unknown]>(),
      setData: jest.fn(),
    },
    getSharedConversation: {
      invalidate: jest.fn<Promise<void>, [unknown]>(),
      setData: jest.fn(),
    },
  },
  meetings: {
    list: { invalidate: jest.fn<Promise<void>, [unknown]>() },
    detail: { invalidate: jest.fn<Promise<void>, [unknown]>() },
  },
  servers: {
    channels: { invalidate: jest.fn<Promise<void>, [unknown]>() },
  },
  context: {
    get: { invalidate: jest.fn<Promise<void>, [unknown]>() },
  },
  autorecord: {
    list: { invalidate: jest.fn<Promise<void>, [unknown]>() },
  },
  channelContexts: {
    list: { invalidate: jest.fn<Promise<void>, [unknown]>() },
  },
  config: {
    server: { invalidate: jest.fn<Promise<void>, [unknown]>() },
  },
};

export const resetTrpcMocks = () => {
  resetQueryState(authQuery, null);
  resetQueryState(guildQuery, null);
  resetQueryState(pricingQuery, { plans: [] });
  resetQueryState(billingQuery, null);
  resetQueryState(meetingsListQuery, { meetings: [] });
  resetQueryState(meetingsDetailQuery, { meeting: null });
  resetQueryState(serversChannelsQuery, {
    voiceChannels: [],
    textChannels: [],
  });
  resetQueryState(askListQuery, { conversations: [] });
  resetQueryState(askSettingsQuery, {
    askMembersEnabled: true,
    askSharingPolicy: "server",
  });
  resetQueryState(askSharedListQuery, { conversations: [] });
  resetQueryState(askConversationQuery, { conversation: null, messages: [] });
  resetQueryState(askSharedConversationQuery, {
    conversation: null,
    messages: [],
    shared: null,
  });
  resetQueryState(askPublicConversationQuery, {
    conversation: null,
    messages: [],
    shared: null,
  });
  resetQueryState(autorecordListQuery, { rules: [] });
  resetQueryState(contextQuery, null);
  resetQueryState(channelContextsQuery, { contexts: [] });
  resetQueryState(configServerQuery, {
    registry: [],
    snapshot: { values: {}, tier: "free" },
    overrides: [],
  });

  resetMutationState(billingCheckoutMutation, {
    url: "https://example.com/checkout",
  });
  resetMutationState(billingPortalMutation, {
    url: "https://example.com/portal",
  });
  resetMutationState(askMutation, undefined);
  resetMutationState(askRenameMutation, undefined);
  resetMutationState(askVisibilityMutation, null);
  resetMutationState(autorecordAddMutation, undefined);
  resetMutationState(autorecordRemoveMutation, undefined);
  resetMutationState(contextSetMutation, undefined);
  resetMutationState(channelContextsSetMutation, undefined);
  resetMutationState(channelContextsClearMutation, undefined);
  resetMutationState(configSetServerMutation, undefined);
  resetMutationState(configClearServerMutation, undefined);

  trpcUtils.ask.listConversations.invalidate.mockReset();
  trpcUtils.ask.listConversations.invalidate.mockResolvedValue(undefined);
  trpcUtils.ask.listConversations.setData.mockReset();
  trpcUtils.ask.listSharedConversations.invalidate.mockReset();
  trpcUtils.ask.listSharedConversations.invalidate.mockResolvedValue(undefined);
  trpcUtils.ask.listSharedConversations.setData.mockReset();
  trpcUtils.ask.getConversation.invalidate.mockReset();
  trpcUtils.ask.getConversation.invalidate.mockResolvedValue(undefined);
  trpcUtils.ask.getConversation.setData.mockReset();
  trpcUtils.ask.getSharedConversation.invalidate.mockReset();
  trpcUtils.ask.getSharedConversation.invalidate.mockResolvedValue(undefined);
  trpcUtils.ask.getSharedConversation.setData.mockReset();
  trpcUtils.meetings.list.invalidate.mockReset();
  trpcUtils.meetings.list.invalidate.mockResolvedValue(undefined);
  trpcUtils.meetings.detail.invalidate.mockReset();
  trpcUtils.meetings.detail.invalidate.mockResolvedValue(undefined);
  trpcUtils.servers.channels.invalidate.mockReset();
  trpcUtils.servers.channels.invalidate.mockResolvedValue(undefined);
  trpcUtils.context.get.invalidate.mockReset();
  trpcUtils.context.get.invalidate.mockResolvedValue(undefined);
  trpcUtils.autorecord.list.invalidate.mockReset();
  trpcUtils.autorecord.list.invalidate.mockResolvedValue(undefined);
  trpcUtils.channelContexts.list.invalidate.mockReset();
  trpcUtils.channelContexts.list.invalidate.mockResolvedValue(undefined);
  trpcUtils.config.server.invalidate.mockReset();
  trpcUtils.config.server.invalidate.mockResolvedValue(undefined);
};

export const setPricingQuery = (
  next: Partial<QueryState<PricingPlansData>>,
) => {
  Object.assign(pricingQuery, next);
};

export const setBillingQuery = (
  next: Partial<QueryState<BillingDataQuery | null>>,
) => {
  Object.assign(billingQuery, next);
};

export const setMeetingsListQuery = (
  next: Partial<QueryState<MeetingsListData>>,
) => {
  Object.assign(meetingsListQuery, next);
};

export const setMeetingsDetailQuery = (
  next: Partial<QueryState<MeetingsDetailData>>,
) => {
  Object.assign(meetingsDetailQuery, next);
};

export const setServersChannelsQuery = (
  next: Partial<QueryState<ChannelsData>>,
) => {
  Object.assign(serversChannelsQuery, next);
};

export const setAskListQuery = (next: Partial<QueryState<AskListData>>) => {
  Object.assign(askListQuery, next);
};

export const setAskSettingsQuery = (
  next: Partial<QueryState<AskSettingsData>>,
) => {
  Object.assign(askSettingsQuery, next);
};

export const setAskSharedListQuery = (
  next: Partial<QueryState<AskSharedListData>>,
) => {
  Object.assign(askSharedListQuery, next);
};

export const setAskConversationQuery = (
  next: Partial<QueryState<AskConversationData>>,
) => {
  Object.assign(askConversationQuery, next);
};

export const setAskSharedConversationQuery = (
  next: Partial<QueryState<AskSharedConversationData>>,
) => {
  Object.assign(askSharedConversationQuery, next);
};

export const setAskPublicConversationQuery = (
  next: Partial<QueryState<AskPublicConversationData>>,
) => {
  Object.assign(askPublicConversationQuery, next);
};

export const setAutorecordListQuery = (
  next: Partial<QueryState<RulesData>>,
) => {
  Object.assign(autorecordListQuery, next);
};

export const setContextQuery = (
  next: Partial<QueryState<ContextData | null>>,
) => {
  Object.assign(contextQuery, next);
};

export const setChannelContextsQuery = (
  next: Partial<QueryState<ChannelContextsData>>,
) => {
  Object.assign(channelContextsQuery, next);
};

export const setConfigServerQuery = (
  next: Partial<QueryState<ConfigServerData>>,
) => {
  Object.assign(configServerQuery, next);
};

export const setAuthQuery = (
  next: Partial<QueryState<{ id: string } | null>>,
) => {
  Object.assign(authQuery, next);
};

export const setGuildQuery = (
  next: Partial<
    QueryState<{
      guilds: { id: string; name: string; canManage?: boolean }[];
    } | null>
  >,
) => {
  Object.assign(guildQuery, next);
};

jest.mock("../../../src/frontend/services/trpc", () => ({
  trpc: {
    useUtils: () => trpcUtils,
    auth: { me: { useQuery: () => authQuery } },
    servers: {
      listEligible: { useQuery: () => guildQuery },
      channels: { useQuery: () => serversChannelsQuery },
    },
    pricing: { plans: { useQuery: () => pricingQuery } },
    billing: {
      me: { useQuery: () => billingQuery },
      checkout: { useMutation: () => billingCheckoutMutation },
      portal: { useMutation: () => billingPortalMutation },
    },
    ask: {
      settings: { useQuery: () => askSettingsQuery },
      listConversations: { useQuery: () => askListQuery },
      listSharedConversations: { useQuery: () => askSharedListQuery },
      getConversation: { useQuery: () => askConversationQuery },
      getSharedConversation: { useQuery: () => askSharedConversationQuery },
      getPublicConversation: { useQuery: () => askPublicConversationQuery },
      ask: { useMutation: () => askMutation },
      rename: { useMutation: () => askRenameMutation },
      setVisibility: { useMutation: () => askVisibilityMutation },
    },
    meetings: {
      list: { useQuery: () => meetingsListQuery },
      detail: { useQuery: () => meetingsDetailQuery },
    },
    autorecord: {
      list: { useQuery: () => autorecordListQuery },
      add: { useMutation: () => autorecordAddMutation },
      remove: { useMutation: () => autorecordRemoveMutation },
    },
    context: {
      get: { useQuery: () => contextQuery },
      set: { useMutation: () => contextSetMutation },
    },
    channelContexts: {
      list: { useQuery: () => channelContextsQuery },
      set: { useMutation: () => channelContextsSetMutation },
      clear: { useMutation: () => channelContextsClearMutation },
    },
    config: {
      server: { useQuery: () => configServerQuery },
      setServerOverride: { useMutation: () => configSetServerMutation },
      clearServerOverride: { useMutation: () => configClearServerMutation },
    },
  },
}));
