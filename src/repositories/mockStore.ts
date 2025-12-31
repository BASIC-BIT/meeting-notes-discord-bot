import type { AuthedProfile } from "../trpc/context";
import type {
  AutoRecordSettings,
  GuildSubscription,
  ChannelContext,
  ServerContext,
  MeetingHistory,
  GuildInstaller,
  PaymentTransaction,
  OnboardingState,
  StripeWebhookEvent,
  UserSpeechSettings,
  ConfigOverrideRecord,
} from "../types/db";
import type {
  AskConversation,
  AskMessage,
  AskSharedConversation,
} from "../types/ask";
import { config } from "../services/configService";
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
} from "./types";

type MockStore = {
  user: AuthedProfile;
  userGuilds: DiscordGuild[];
  botGuilds: DiscordGuild[];
  channelsByGuild: Map<string, DiscordChannel[]>;
  rolesByGuild: Map<string, DiscordRole[]>;
  membersByGuild: Map<string, DiscordGuildMember>;
  objectsByKey: Map<string, string>;
  autoRecordByGuild: Map<string, AutoRecordSettings[]>;
  serverContexts: Map<string, ServerContext>;
  channelContexts: Map<string, ChannelContext>;
  guildInstallers: Map<string, GuildInstaller>;
  subscriptions: Map<string, GuildSubscription>;
  paymentTransactions: Map<string, PaymentTransaction>;
  stripeWebhookEvents: Map<string, StripeWebhookEvent>;
  onboardingStates: Map<string, OnboardingState>;
  meetingHistoryByGuild: Map<string, MeetingHistory[]>;
  askConversationsByKey: Map<string, AskConversation[]>;
  askMessagesByConversation: Map<string, AskMessage[]>;
  askSharesByGuild: Map<string, AskSharedConversation[]>;
  userSpeechSettings: Map<string, UserSpeechSettings>;
  configOverrides: Map<string, ConfigOverrideRecord>;
};

const MANAGE_GUILD = 1 << 5;
const ADMIN = 1 << 3;

const mockUser: AuthedProfile = {
  id: "211750261922725888",
  username: "MockUser",
  discriminator: "0001",
  avatar: null,
  email: "mock@chronote.gg",
  accessToken: "mock-access-token",
} as AuthedProfile;

function buildDefaultStore(): MockStore {
  const fixedNowIso = process.env.MOCK_FIXED_NOW;
  const fixedNowMs = fixedNowIso ? Date.parse(fixedNowIso) : Number.NaN;
  const baseNowMs = Number.isFinite(fixedNowMs) ? fixedNowMs : Date.now();
  const baseNowIso = new Date(baseNowMs).toISOString();
  const mockNowIso = () => baseNowIso;
  const permissions = (BigInt(MANAGE_GUILD) | BigInt(ADMIN)).toString();
  const userGuilds: DiscordGuild[] = [
    {
      id: "1249723747896918109",
      name: "DDM",
      icon: null,
      permissions,
      owner: true,
    },
    {
      id: "111111111111111111",
      name: "Chronote Crew",
      icon: null,
      permissions,
      owner: false,
    },
  ];

  const botGuilds: DiscordGuild[] = userGuilds.map((guild) => ({
    id: guild.id,
    name: guild.name,
  }));

  const channelsByGuild = new Map<string, DiscordChannel[]>();
  channelsByGuild.set("1249723747896918109", [
    { id: "voice-1", name: "General", type: 2, position: 1 },
    { id: "voice-2", name: "PTT Only (DAZ)", type: 2, position: 2 },
    { id: "voice-3", name: "Tabletop Voice", type: 2, position: 3 },
    { id: "text-1", name: "session-notes", type: 0, position: 1 },
    { id: "text-2", name: "campaign-info", type: 0, position: 2 },
    { id: "text-3", name: "roles", type: 0, position: 3 },
  ]);
  channelsByGuild.set("111111111111111111", [
    { id: "voice-a", name: "General", type: 2, position: 1 },
    { id: "voice-b", name: "Raid Room", type: 2, position: 2 },
    { id: "text-a", name: "meeting-notes", type: 0, position: 1 },
    { id: "text-b", name: "announcements", type: 0, position: 2 },
  ]);

  const rolesByGuild = new Map<string, DiscordRole[]>();
  const adminPermissions = BigInt(ADMIN).toString();
  userGuilds.forEach((guild) => {
    rolesByGuild.set(guild.id, [
      { id: guild.id, name: "@everyone", permissions: "0" },
      {
        id: `role-${guild.id}-bot`,
        name: "Chronote",
        permissions: adminPermissions,
      },
    ]);
  });

  const membersByGuild = new Map<string, DiscordGuildMember>();
  const botUserId = config.discord.clientId || "mock-bot";
  userGuilds.forEach((guild) => {
    membersByGuild.set(`${guild.id}#${botUserId}`, {
      user: { id: botUserId },
      roles: [`role-${guild.id}-bot`],
      permissions: adminPermissions,
    });
  });

  const autoRecordByGuild = new Map<string, AutoRecordSettings[]>();
  const objectsByKey = new Map<string, string>();
  autoRecordByGuild.set("1249723747896918109", [
    {
      guildId: "1249723747896918109",
      channelId: "voice-2",
      textChannelId: "text-1",
      enabled: true,
      recordAll: false,
      createdBy: mockUser.id,
      createdAt: mockNowIso(),
      tags: ["campaign", "weekly"],
    },
  ]);

  const serverContexts = new Map<string, ServerContext>();
  serverContexts.set("1249723747896918109", {
    guildId: "1249723747896918109",
    context:
      "Weekly tabletop session with rotating GMs, focus on recaps and action items.",
    defaultNotesChannelId: "text-1",
    defaultTags: ["campaign", "recap"],
    liveVoiceEnabled: false,
    liveVoiceCommandsEnabled: false,
    askMembersEnabled: true,
    askSharingPolicy: "server",
    updatedAt: mockNowIso(),
    updatedBy: mockUser.id,
  });

  const channelContexts = new Map<string, ChannelContext>();
  channelContexts.set("1249723747896918109#voice-3", {
    guildId: "1249723747896918109",
    channelId: "voice-3",
    context: "Tabletop voice channel for D&D sessions and campaign recaps.",
    liveVoiceEnabled: true,
    liveVoiceCommandsEnabled: false,
    updatedAt: mockNowIso(),
    updatedBy: mockUser.id,
  });

  const guildInstallers = new Map<string, GuildInstaller>();
  guildInstallers.set("1249723747896918109", {
    guildId: "1249723747896918109",
    installerId: mockUser.id,
    installedAt: mockNowIso(),
  });

  const subscriptions = new Map<string, GuildSubscription>();
  subscriptions.set("1249723747896918109", {
    guildId: "1249723747896918109",
    status: "active",
    tier: "basic",
    subscriptionType: "stripe",
    startDate: mockNowIso(),
    nextBillingDate: new Date(
      baseNowMs + 1000 * 60 * 60 * 24 * 25,
    ).toISOString(),
    stripeCustomerId: "cus_mock_basic",
    stripeSubscriptionId: "sub_mock_basic",
    mode: "test",
  });
  subscriptions.set("111111111111111111", {
    guildId: "111111111111111111",
    status: "free",
    tier: "free",
    subscriptionType: "free",
    startDate: mockNowIso(),
    mode: "test",
  });

  const paymentTransactions = new Map<string, PaymentTransaction>();
  const stripeWebhookEvents = new Map<string, StripeWebhookEvent>();
  const onboardingStates = new Map<string, OnboardingState>();
  const userSpeechSettings = new Map<string, UserSpeechSettings>();
  const configOverrides = new Map<string, ConfigOverrideRecord>();

  const meetingHistoryByGuild = new Map<string, MeetingHistory[]>();
  const buildMeeting = (params: {
    guildId: string;
    channelId: string;
    minutesAgo: number;
    notes: string;
    tags?: string[];
    textChannelId: string;
    meetingIdSuffix: string;
  }): MeetingHistory => {
    const timestamp = new Date(
      baseNowMs - params.minutesAgo * 60 * 1000,
    ).toISOString();
    const channelId_timestamp = `${params.channelId}#${timestamp}`;
    const transcriptKey = `mock/transcripts/${params.guildId}/${params.channelId}-${params.meetingIdSuffix}.json`;
    const transcriptLines = [
      { speaker: "GM", text: "The party returns to the vault entrance." },
      { speaker: "Rin", text: "We should secure allies before midnight." },
      { speaker: "Ada", text: "I want a favor in return." },
    ];
    const segments = transcriptLines.map((line, index) => ({
      userId: `mock-${line.speaker.toLowerCase()}`,
      username: line.speaker.toLowerCase(),
      displayName: line.speaker,
      serverNickname: line.speaker,
      tag: line.speaker,
      startedAt: new Date(
        Date.parse(timestamp) + index * 90 * 1000,
      ).toISOString(),
      text: line.text,
    }));
    objectsByKey.set(
      transcriptKey,
      JSON.stringify(
        {
          generatedAt: mockNowIso(),
          segments,
          text: transcriptLines
            .map((line) => `${line.speaker}: ${line.text}`)
            .join("\n"),
        },
        null,
        2,
      ),
    );
    return {
      guildId: params.guildId,
      channelId_timestamp,
      meetingId: `meeting-${params.meetingIdSuffix}`,
      channelId: params.channelId,
      timestamp,
      tags: params.tags ?? [],
      notes: params.notes,
      participants: [
        {
          id: mockUser.id,
          username: "mockuser",
          displayName: "MockUser",
          serverNickname: "MockUser",
          tag: "MockUser#0001",
        },
        {
          id: "999999999999999999",
          username: "chronote",
          displayName: "Chronote",
          serverNickname: "Chronote",
          tag: "Chronote#0000",
        },
      ],
      attendees: ["MockUser", "Chronote"],
      duration: 52 * 60,
      transcribeMeeting: true,
      generateNotes: true,
      notesChannelId: params.textChannelId,
      notesMessageIds: ["1451653357407174727"],
      transcriptS3Key: transcriptKey,
    };
  };
  meetingHistoryByGuild.set("1249723747896918109", [
    buildMeeting({
      guildId: "1249723747896918109",
      channelId: "voice-3",
      minutesAgo: 60 * 24,
      meetingIdSuffix: "ddm-1",
      textChannelId: "text-1",
      tags: ["campaign", "heist", "npc"],
      notes:
        "Meeting Summary (Banana / Indigo)\nDecision: revisit the vault after securing allies.\nAction: Rin posts the map + loot sheet in #campaign-info.\nNext time: Sunday 7pm (voice).\nHighlights + attendance included.",
    }),
    buildMeeting({
      guildId: "1249723747896918109",
      channelId: "voice-2",
      minutesAgo: 60 * 48,
      meetingIdSuffix: "ddm-2",
      textChannelId: "text-3",
      tags: ["raid", "loot"],
      notes:
        "Chapter 01 - The Lemonade Stand at Dusk\nHighlights: The crew split gems evenly and banked the relic.\nAction items: verify ward timing, confirm sewer layout.",
    }),
    buildMeeting({
      guildId: "1249723747896918109",
      channelId: "voice-1",
      minutesAgo: 60 * 72,
      meetingIdSuffix: "ddm-3",
      textChannelId: "text-2",
      tags: ["community", "staff"],
      notes:
        "Chapter 01 - Crossed Wires\nSummary: Staff aligned on moderation changes, event schedule, and follow-ups.",
    }),
  ]);
  meetingHistoryByGuild.set("111111111111111111", [
    buildMeeting({
      guildId: "111111111111111111",
      channelId: "voice-a",
      minutesAgo: 60 * 36,
      meetingIdSuffix: "crew-1",
      textChannelId: "text-a",
      tags: ["community", "events"],
      notes:
        "Chapter 01 - Counting In\nSummary: Event planning sync with action items and next steps.",
    }),
  ]);

  const askConversationsByKey = new Map<string, AskConversation[]>();
  const askMessagesByConversation = new Map<string, AskMessage[]>();
  const askSharesByGuild = new Map<string, AskSharedConversation[]>();
  const conversationId = "conv-mock-1";
  const conversationIdTwo = "conv-mock-2";
  const conversationKey = `USER#${mockUser.id}#GUILD#1249723747896918109`;
  const createdAt = mockNowIso();
  const updatedAt = mockNowIso();
  askConversationsByKey.set(conversationKey, [
    {
      id: conversationId,
      title: "Recap the last campaign session",
      summary:
        "We agreed to revisit the vault after the ranger's warning and set next steps.",
      createdAt,
      updatedAt,
    },
    {
      id: conversationIdTwo,
      title: "Loot split notes",
      summary:
        "Rin keeps the map, the party banks the gems, and we owe Ada a favor.",
      createdAt,
      updatedAt,
      visibility: "server",
      sharedAt: updatedAt,
      sharedByUserId: mockUser.id,
      sharedByTag: `${mockUser.username}#${mockUser.discriminator}`,
    },
  ]);
  askSharesByGuild.set("1249723747896918109", [
    {
      conversationId: conversationIdTwo,
      title: "Loot split notes",
      summary:
        "Rin keeps the map, the party banks the gems, and we owe Ada a favor.",
      updatedAt,
      sharedAt: updatedAt,
      ownerUserId: mockUser.id,
      ownerTag: `${mockUser.username}#${mockUser.discriminator}`,
    },
  ]);
  const basePairs = [
    [
      "What were the main decisions from the last session?",
      "The party decided to postpone the vault entry until they secure allies in town. The ranger's warning is now the top follow-up.",
    ],
    [
      "Did we lock in next session time?",
      "Yes. Sunday at 7pm in voice, with a quick recap for anyone who missed.",
    ],
    [
      "Who is taking the map update?",
      "Rin is posting the updated route and stash notes in #campaign-info.",
    ],
    [
      "Any open action items for me?",
      "Track the ward cooldown and confirm which seals reset at midnight.",
    ],
    [
      "What was the plan if the vault is still sealed?",
      "We switch to the sewer entrance and use Ada's key for the inner door.",
    ],
    [
      "What did we say about the missing scout?",
      "We agreed to ping the ranger's contact and avoid the western pass.",
    ],
    [
      "Summarize the party's goal in one sentence.",
      "Get inside the vault without triggering the ward while keeping the crew intact.",
    ],
    [
      "Did we settle the loot split?",
      "Yes. Gems are split evenly, and the relic goes to the party vault for now.",
    ],
    [
      "Any notes about the NPC Ada?",
      "Ada wants a favor in exchange for the map, and she does not trust the captain.",
    ],
    [
      "What should we review before next session?",
      "Ward timing, sewer layout, and the ranger's warning about the northern ridge.",
    ],
  ];
  const seededPairs = [
    ...basePairs,
    ...basePairs.map(([question, answer]) => [
      `${question} (follow-up)`,
      answer,
    ]),
  ];
  const seededMessages: AskMessage[] = [];
  const baseTime = baseNowMs - seededPairs.length * 6 * 60 * 1000;
  seededPairs.forEach(([question, answer], index) => {
    const questionTime = new Date(
      baseTime + index * 6 * 60 * 1000,
    ).toISOString();
    const answerTime = new Date(
      baseTime + index * 6 * 60 * 1000 + 30 * 1000,
    ).toISOString();
    seededMessages.push({
      id: `msg-${index * 2 + 1}`,
      role: "user",
      text: question,
      createdAt: questionTime,
    });
    seededMessages.push({
      id: `msg-${index * 2 + 2}`,
      role: "chronote",
      text: answer,
      createdAt: answerTime,
      sourceMeetingIds:
        index % 2 === 0 ? ["voice-2#2025-12-18T02:30:00.000Z"] : undefined,
    });
  });
  askMessagesByConversation.set(
    `${conversationKey}#${conversationId}`,
    seededMessages,
  );
  askMessagesByConversation.set(`${conversationKey}#${conversationIdTwo}`, [
    {
      id: "msg-21",
      role: "user",
      text: "Who took the emeralds?",
      createdAt,
    },
    {
      id: "msg-22",
      role: "chronote",
      text: "The party banked the emeralds in the guild vault and logged it in the recap.",
      createdAt: updatedAt,
    },
  ]);

  return {
    user: mockUser,
    userGuilds,
    botGuilds,
    channelsByGuild,
    rolesByGuild,
    membersByGuild,
    objectsByKey,
    autoRecordByGuild,
    serverContexts,
    channelContexts,
    guildInstallers,
    subscriptions,
    paymentTransactions,
    stripeWebhookEvents,
    onboardingStates,
    meetingHistoryByGuild,
    askConversationsByKey,
    askMessagesByConversation,
    askSharesByGuild,
    userSpeechSettings,
    configOverrides,
  };
}

let store = buildDefaultStore();

export function getMockStore() {
  return store;
}

export function resetMockStore() {
  store = buildDefaultStore();
}

export function getMockUser() {
  return store.user;
}
