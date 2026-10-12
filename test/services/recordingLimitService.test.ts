jest.mock("../../src/services/configService", () => {
  const actual = jest.requireActual<
    typeof import("../../src/services/configService")
  >("../../src/services/configService");
  return {
    config: {
      ...actual.config,
      stripe: { ...actual.config.stripe, secretKey: "test-only" },
      subscription: { ...actual.config.subscription, stripeMode: "test" },
      frontend: { ...actual.config.frontend, siteUrl: "https://chronote.test" },
    },
  };
});
jest.mock("../../src/services/analyticsService", () => ({
  captureEvent: jest.fn(),
}));
jest.mock("../../src/services/subscriptionService", () => ({
  ...jest.requireActual("../../src/services/subscriptionService"),
  getGuildLimits: jest.fn(),
}));
const mockGetSubscription = jest.fn();
jest.mock("../../src/repositories/subscriptionRepository", () => ({
  getSubscriptionRepository: () => ({ get: mockGetSubscription }),
}));
jest.mock("../../src/db", () => ({
  tryCreateInteractionReceipt: jest.fn(),
  releaseInteractionReceipt: jest.fn(),
}));

import {
  getGuildLimits,
  getLimitsForTier,
  type Tier,
} from "../../src/services/subscriptionService";
import { captureEvent } from "../../src/services/analyticsService";
import {
  tryCreateInteractionReceipt,
  releaseInteractionReceipt,
} from "../../src/db";
import { config } from "../../src/services/configService";
import {
  encounterRecordingLimit,
  notifyRecordingLimit,
  type RecordingLimitState,
} from "../../src/services/recordingLimitService";
import { DiscordAPIError } from "discord.js";

const input = {
  guildId: "guild-1",
  userId: "actor-1",
  limitType: "weekly_recording" as const,
  limitSurface: "manual_start" as const,
  outcome: "blocked_start" as const,
  limitMinutes: 240,
  usedMinutes: 240,
  message: "Weekly recording allowance reached.",
};
function tier(
  value: Tier,
  source: "default" | "forced" | "manual_comp" = "default",
) {
  jest.mocked(getGuildLimits).mockResolvedValue({
    limits: getLimitsForTier(value),
    subscription: {
      tier: value,
      status: "active",
      source,
      billingSource: source === "default" ? "free" : source,
      stripeTier: null,
      grantTier: source === "manual_comp" && value !== "free" ? value : null,
      activeGrant: null,
    },
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  tier("free");
  mockGetSubscription.mockResolvedValue(undefined);
  jest.mocked(tryCreateInteractionReceipt).mockResolvedValue(true);
  config.stripe.secretKey = "test-only";
});

test("Free weekly refusal links to Basic for this server and qualifies an initial purchase", async () => {
  const notice = await encounterRecordingLimit(input);
  expect(notice.action).toMatchObject({
    kind: "upgrade",
    label: "View Basic",
    purchasePath: "initial_purchase",
  });
  const link = new URL(notice.action.url);
  expect(link.pathname).toBe("/upgrade/select-server");
  expect(Object.fromEntries(link.searchParams)).toMatchObject({
    serverId: "guild-1",
    plan: "basic",
    source: "discord_limit",
    limitType: "weekly_recording",
    limitSurface: "manual_start",
  });
  expect(notice.payload.content).toContain("20 hours");
  expect(captureEvent).toHaveBeenCalledWith(
    "recording_limit_encountered",
    expect.objectContaining({
      properties: expect.objectContaining({
        purchase_path: "initial_purchase",
        outcome: "blocked_start",
      }),
    }),
  );
  expect(notice.payload.allowedMentions).toEqual({ parse: [] });
});
test("legacy Stripe pointers use management without qualifying initial purchase", async () => {
  mockGetSubscription.mockResolvedValue({ stripeCustomerId: "cus_fixture" });
  const notice = await encounterRecordingLimit(input);
  expect(notice.action).toMatchObject({
    kind: "manage_billing",
    purchasePath: "existing_billing",
  });
  expect(new URL(notice.action.url).pathname).toBe(
    "/portal/server/guild-1/billing",
  );
});
test("Basic weekly pressure uses Pro billing management", async () => {
  tier("basic");
  mockGetSubscription.mockResolvedValue({
    stripeSubscriptionId: "sub_fixture",
  });
  const notice = await encounterRecordingLimit({
    ...input,
    limitMinutes: 1200,
    usedMinutes: 1200,
  });
  expect(notice.action.kind).toBe("manage_billing");
  expect(notice.payload.content).toContain("Pro has no weekly recording cap");
});
test("two-hour cap never sells a longer session", async () => {
  tier("basic");
  const notice = await encounterRecordingLimit({
    ...input,
    limitType: "meeting_duration",
    limitSurface: "duration_stop",
    outcome: "ended_session",
    limitMinutes: 120,
  });
  expect(notice.action).toMatchObject({
    kind: "open_meetings",
    purchasePath: "no_purchase",
  });
  expect(notice.payload.content).not.toContain("Upgrade");
});
test("an upgrade during recording is available for future sessions, not sold again", async () => {
  tier("basic");
  const notice = await encounterRecordingLimit({
    ...input,
    limitType: "meeting_duration",
    limitSurface: "duration_stop",
    outcome: "ended_session",
    limitMinutes: 90,
  });
  expect(notice.action.kind).toBe("open_meetings");
  expect(notice.payload.content).toContain("current plan");
});
test.each(["forced", "manual_comp"] as const)(
  "%s Pro never gets a false upgrade",
  async (source) => {
    tier("pro", source);
    const notice = await encounterRecordingLimit(input);
    expect(notice.action.kind).toBe("open_meetings");
  },
);
test("lookup failure preserves the limit message and does not infer Free", async () => {
  jest
    .mocked(getGuildLimits)
    .mockRejectedValue(new Error("provider-private-error"));
  const notice = await encounterRecordingLimit(input);
  expect(notice.payload.content).toContain(input.message);
  expect(notice.action.purchasePath).toBe("unknown");
  expect(JSON.stringify(jest.mocked(captureEvent).mock.calls)).not.toContain(
    "provider-private-error",
  );
});
test("slow eligibility lookup has a bounded fallback", async () => {
  jest.useFakeTimers();
  jest.mocked(getGuildLimits).mockReturnValue(new Promise(() => undefined));
  const pending = encounterRecordingLimit(input);
  await jest.advanceTimersByTimeAsync(1000);
  expect((await pending).action.purchasePath).toBe("unknown");
});
test("disabled billing does not promise a purchase", async () => {
  config.stripe.secretKey = "";
  expect((await encounterRecordingLimit(input)).action.kind).toBe(
    "open_meetings",
  );
});
test("auto refusal suppression still records pressure but never delivered", async () => {
  jest.mocked(tryCreateInteractionReceipt).mockResolvedValue(false);
  const send = jest.fn();
  await notifyRecordingLimit(
    { ...input, limitSurface: "auto_start" },
    { send },
  );
  expect(send).not.toHaveBeenCalled();
  expect(captureEvent).toHaveBeenCalledWith(
    "recording_limit_encountered",
    expect.anything(),
  );
  expect(captureEvent).toHaveBeenCalledWith(
    "recording_limit_notice_result",
    expect.objectContaining({
      properties: expect.objectContaining({ delivery: "suppressed" }),
    }),
  );
});
test("definitive failed auto delivery releases only its own receipt", async () => {
  const send = jest
    .fn()
    .mockRejectedValue(
      new DiscordAPIError(
        { message: "Missing access", code: 50001 },
        50001,
        403,
        "POST",
        "https://discord.test",
        {},
      ),
    );
  await notifyRecordingLimit(
    { ...input, limitSurface: "auto_start" },
    { send },
  );
  expect(releaseInteractionReceipt).toHaveBeenCalledWith(
    expect.objectContaining({ interactionKind: "recording_limit" }),
  );
});
test("ambiguous delivery is not retried or counted delivered", async () => {
  const state: RecordingLimitState = {};
  const send = jest.fn().mockRejectedValue(new Error("lost response"));
  await notifyRecordingLimit(
    {
      ...input,
      limitType: "meeting_duration",
      limitSurface: "duration_stop",
      outcome: "ended_session",
      limitMinutes: 90,
    },
    { send },
    state,
  );
  await notifyRecordingLimit(
    {
      ...input,
      limitSurface: "weekly_after_meeting",
      outcome: "exhausted_after_meeting",
    },
    { send },
    state,
  );
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(jest.mocked(captureEvent).mock.calls)).not.toContain(
    '"delivery":"delivered"',
  );
});
test("timeout and weekly exhaustion update one message while keeping both encounters", async () => {
  const edit = jest.fn().mockResolvedValue(undefined);
  const send = jest.fn().mockResolvedValue({ edit });
  const state: RecordingLimitState = {};
  await notifyRecordingLimit(
    {
      ...input,
      limitType: "meeting_duration",
      limitSurface: "duration_stop",
      outcome: "ended_session",
      limitMinutes: 90,
      message: "Session ended at 90 minutes.",
    },
    { send },
    state,
  );
  await notifyRecordingLimit(
    {
      ...input,
      limitSurface: "weekly_after_meeting",
      outcome: "exhausted_after_meeting",
    },
    { send },
    state,
  );
  expect(send).toHaveBeenCalledTimes(1);
  expect(edit).toHaveBeenCalledTimes(1);
  expect(edit.mock.calls[0][0].content).toContain(
    "Session ended at 90 minutes.",
  );
  expect(edit.mock.calls[0][0].content).toContain(input.message);
  expect(
    jest
      .mocked(captureEvent)
      .mock.calls.filter(([event]) => event === "recording_limit_encountered"),
  ).toHaveLength(2);
});
test("a near warning is suppressed after a delivered duration notice", async () => {
  const send = jest.fn().mockResolvedValue({ edit: jest.fn() });
  const state: RecordingLimitState = {};
  await notifyRecordingLimit(
    {
      ...input,
      limitType: "meeting_duration",
      limitSurface: "duration_stop",
      outcome: "ended_session",
      limitMinutes: 90,
    },
    { send },
    state,
  );
  await notifyRecordingLimit(
    { ...input, limitSurface: "weekly_warning", outcome: "near_limit" },
    { send },
    state,
  );
  expect(send).toHaveBeenCalledTimes(1);
  expect(captureEvent).toHaveBeenCalledWith(
    "recording_limit_notice_result",
    expect.objectContaining({
      properties: expect.objectContaining({
        delivery: "suppressed",
        suppression_reason: "covered_by_duration",
      }),
    }),
  );
});

test("a deleted duration notice gets one fresh combined weekly notice", async () => {
  const oldMessage = {
    edit: jest
      .fn()
      .mockRejectedValue(
        new DiscordAPIError(
          { message: "Unknown Message", code: 10008 },
          10008,
          404,
          "PATCH",
          "https://discord.test",
          {},
        ),
      ),
  };
  const replacement = { edit: jest.fn() };
  const send = jest.fn().mockResolvedValue(replacement);
  const state: RecordingLimitState = {
    message: oldMessage,
    durationContent: "Session ended at 90 minutes.",
  };
  const result = await notifyRecordingLimit(
    {
      ...input,
      limitSurface: "weekly_after_meeting",
      outcome: "exhausted_after_meeting",
    },
    { send },
    state,
  );
  expect(oldMessage.edit).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0].content).toContain(state.durationContent);
  expect(send.mock.calls[0][0].content).toContain(input.message);
  expect(send.mock.calls[0][0].allowedMentions).toEqual({ parse: [] });
  expect(result).toBe(replacement);
  expect(state.message).toBe(replacement);
  expect(captureEvent).toHaveBeenCalledWith(
    "recording_limit_notice_result",
    expect.objectContaining({
      properties: expect.objectContaining({
        notice_operation: "send",
        delivery: "delivered",
      }),
    }),
  );
});
test.each([
  new Error("lost edit response"),
  new DiscordAPIError(
    { message: "Missing access", code: 50001 },
    50001,
    403,
    "PATCH",
    "https://discord.test",
    {},
  ),
])(
  "an edit failure without a missing message never creates a duplicate notice: %s",
  async (error) => {
    const oldMessage = { edit: jest.fn().mockRejectedValue(error) };
    const send = jest.fn();
    const state: RecordingLimitState = {
      message: oldMessage,
      durationContent: "Session ended.",
    };
    await notifyRecordingLimit(
      {
        ...input,
        limitSurface: "weekly_after_meeting",
        outcome: "exhausted_after_meeting",
      },
      { send },
      state,
    );
    expect(send).not.toHaveBeenCalled();
    expect(state.message).toBe(oldMessage);
    expect(state.deliveryUnknown).toBe(!(error instanceof DiscordAPIError));
  },
);
