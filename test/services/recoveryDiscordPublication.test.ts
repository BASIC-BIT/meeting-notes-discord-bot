import { createHash } from "node:crypto";
import {
  previewRecoveryDiscordPublication,
  publicationDigest,
  type PublicationDependencies,
} from "../../src/services/recoveryDiscordPublication";
import { buildMeetingNotesEmbeds } from "../../src/utils/meetingNotes";
import type { DiscordEditorMessage } from "../../src/services/discordMessageEditor";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const timestamp = "2026-01-02T03:04:05.000Z";
const folder = "private/100/200_meeting-1_2026-01-02T03-04-05.000Z/";
const recovery = `${folder}recovery/approved-1/`;
const input = {
  accountId: "123456789012",
  region: "us-east-1",
  table: "History",
  bucket: "private-artifacts",
  guildId: "100",
  meetingKey: `200#${timestamp}`,
  recoveryManifestKey: `${recovery}manifest.json`,
};
function fixture(notes = "Обсуждение. Имя говорящего не подтверждено.") {
  const history = {
    guildId: "100",
    channelId_timestamp: input.meetingKey,
    channelId: "200",
    timestamp,
    meetingId: "meeting-1",
    notes,
    notesVersion: 2,
    meetingName: "Совещание",
    summarySentence: "Решение остаётся предварительным.",
    summaryLabel: "Итоги",
    transcriptS3Key: `${recovery}transcript.json`,
    notesChannelId: "300",
    notesMessageIds: ["400"],
    processing: {
      transcription: "partial",
      notes: "generated",
      summary: "generated",
    },
    operatorRecovery: {
      appliedAt: timestamp,
      completenessVerified: false,
      id: "approved-1",
      language: "ru",
      manifestS3Key: input.recoveryManifestKey,
      notesSha256: sha(notes),
      notificationStatus: "held",
      notionSyncStatus: "held",
      operatorActorArn: "operator",
      originalNotesVersion: 1,
      originalTranscriptS3Key: `${folder}transcript.json`,
      transcriptSha256: sha("transcript"),
    },
  };
  const manifest = {
    id: "approved-1",
    meetingId: "meeting-1",
    language: "ru",
    approvedBy: "operator",
    approvedScope: "stored artifacts",
    nextNotesVersion: 2,
    uncertaintiesRetained: true,
    processingPartialWarningPreserved: true,
    previous: { transcriptKey: `${folder}transcript.json`, notesVersion: 1 },
    objects: [
      { role: "notes", key: `${recovery}notes.md`, sha256: sha(notes) },
      {
        role: "transcript",
        key: `${recovery}transcript.json`,
        sha256: sha("transcript"),
      },
      {
        role: "history-before",
        key: `${recovery}history-before.json`,
        sha256: sha("history"),
      },
    ],
  };
  const messages = new Map<string, DiscordEditorMessage>([
    [
      "400",
      {
        id: "400",
        channel_id: "300",
        author: { id: "500", bot: true },
        content: "",
        embeds: [
          {
            title: "Meeting Notes",
            description: "Old notes",
            color: 123,
            timestamp,
            type: "rich",
          },
        ],
        components: [
          {
            type: 1,
            components: [
              { type: 2, custom_id: "correction", label: "Correct", style: 1 },
            ],
          },
        ],
        attachments: [{ id: "600", filename: "recording.wav" }],
        flags: 0,
      },
    ],
  ]);
  const storage = {
    savePreview: jest.fn(),
    saveReceipt: jest.fn(),
    writeClaim: jest.fn(),
    readClaim: jest.fn(),
    readReceipt: jest.fn(),
  };
  const deps = {
    readHistory: jest.fn(async () => history),
    readManifest: jest.fn(async () => manifest),
    now: () => timestamp,
    discord: {
      getBotIdentity: jest.fn(async () => ({ id: "500", bot: true as const })),
      getChannel: jest.fn(async (id: string) => ({
        id,
        guild_id: "100",
        type: 0,
      })),
      getMessage: jest.fn(
        async ({ messageId }: { messageId: string }) =>
          messages.get(messageId) ?? null,
      ),
      editEmbeds: jest.fn(async () => "acknowledged" as const),
    },
    storage,
  } satisfies PublicationDependencies;
  return { history, manifest, messages, deps, storage };
}

test("previewIsReadOnly", async () => {
  const f = fixture();
  const before = JSON.stringify(f.history);
  const preview = await previewRecoveryDiscordPublication(input, f.deps);
  expect(preview.kind).toBe("ready");
  expect(preview.previewDigest).toBe(publicationDigest(preview));
  expect(await previewRecoveryDiscordPublication(input, f.deps)).toEqual(
    preview,
  );
  expect(preview.scope).toEqual(input);
  expect(preview.binding).toMatchObject({
    notesVersion: 2,
    transcriptS3Key: f.history.transcriptS3Key,
    artifactFolder: folder,
    recoveryPrefix: recovery,
    claimKey: `${folder}recovery/discord-publication/claims/2.json`,
  });
  expect(JSON.stringify(f.history)).toBe(before);
  expect(f.deps.discord.editEmbeds).not.toHaveBeenCalled();
  for (const operation of Object.values(f.storage))
    expect(operation).not.toHaveBeenCalled();
});

test.each([
  "meeting",
  "bot",
  "guild",
  "channel",
  "webhook",
  "missing",
  "alias",
  "duplicate",
  "unknown",
  "titleOnly",
  "componentsV2",
])("rejectsWrongMeetingOrBot: %s", async (change) => {
  const f = fixture();
  const message = f.messages.get("400")!;
  switch (change) {
    case "meeting":
      f.manifest.meetingId = "another";
      break;
    case "bot":
      message.author.id = "999";
      break;
    case "guild":
      f.deps.discord.getChannel.mockResolvedValue({
        id: "300",
        guild_id: "999",
        type: 0,
      });
      break;
    case "channel":
      message.channel_id = "999";
      break;
    case "webhook":
      message.webhook_id = "999";
      break;
    case "missing":
      f.messages.clear();
      break;
    case "alias":
      Object.assign(f.history, { summaryMessageId: "400" });
      break;
    case "duplicate":
      f.history.notesMessageIds.push("400");
      break;
    case "unknown":
      message.embeds = [{ title: "Unrecognized", description: "Old" }];
      break;
    case "titleOnly":
      message.embeds = [{ title: "Meeting Notes" }];
      break;
    case "componentsV2":
      message.flags = 32768;
      break;
  }
  expect((await previewRecoveryDiscordPublication(input, f.deps)).kind).toBe(
    "blocked",
  );
  expect(f.deps.discord.editEmbeds).not.toHaveBeenCalled();
});

test("preservesBatchedEmbedsAndControls", async () => {
  const f = fixture("Я".repeat(4100));
  const message = f.messages.get("400")!;
  message.embeds = [
    {
      title: "Meeting Notes (part 1/2)",
      description: "x",
      color: 12,
      footer: {
        text: "v1",
        icon_url: "https://example.org/icon.png",
        proxy_icon_url: "ignored",
      },
    },
    {
      title: "Reference",
      url: "https://example.org",
      image: {
        url: "https://example.org/a.png",
        proxy_url: "ignored",
        width: 1,
      },
      type: "rich",
    },
    { title: "Meeting Notes (part 2/2)", description: "y", color: 34 },
  ];
  const preview = await previewRecoveryDiscordPublication(input, f.deps);
  expect(preview.kind).toBe("ready");
  expect(preview.targets[0].afterEmbeds[1]).toEqual({
    title: "Reference",
    url: "https://example.org",
    image: { url: "https://example.org/a.png" },
  });
  expect(preview.targets[0].afterEmbeds[0]).toMatchObject({
    color: 12,
    footer: { icon_url: "https://example.org/icon.png" },
  });
  expect(preview.targets[0].afterEmbeds[2]).toMatchObject({ color: 34 });
  expect(message.components[0]).toMatchObject({ type: 1 });
  const fingerprint = preview.targets[0].beforeFingerprint;
  message.edited_timestamp = "different";
  message.embeds[1].type = "rich";
  expect(
    (await previewRecoveryDiscordPublication(input, f.deps)).targets[0]
      .beforeFingerprint,
  ).toBe(fingerprint);
  message.content = "Changed";
  expect(
    (await previewRecoveryDiscordPublication(input, f.deps)).targets[0]
      .beforeFingerprint,
  ).not.toBe(fingerprint);
});

test("blocksChangedPagination", async () => {
  const f = fixture("Я".repeat(4100));
  expect((await previewRecoveryDiscordPublication(input, f.deps)).kind).toBe(
    "blocked",
  );
});

test("supports one notes embed per recorded message", async () => {
  const f = fixture("Я".repeat(4100));
  f.history.notesMessageIds = ["400", "401"];
  const message = f.messages.get("400")!;
  message.embeds[0].title = "Meeting Notes (part 1/2)";
  f.messages.set("401", {
    ...message,
    id: "401",
    embeds: [
      { title: "Meeting Notes (part 2/2)", description: "Old", color: 45 },
    ],
  });
  const preview = await previewRecoveryDiscordPublication(input, f.deps);
  expect(preview.kind).toBe("ready");
  expect(preview.targets).toHaveLength(2);
});

test("skipsUnchangedSummary", async () => {
  const f = fixture();
  Object.assign(f.history, { summaryMessageId: "401", textChannelId: "300" });
  f.messages.set("401", {
    ...f.messages.get("400")!,
    id: "401",
    embeds: [
      {
        title: f.history.meetingName,
        description: `Some audio could not be transcribed. These notes may be incomplete.\n\n${f.history.summarySentence}`,
        fields: [
          { name: "Start Time", value: "then" },
          { name: "Duration", value: "1 minute" },
        ],
        color: 321,
      },
    ],
  });
  const preview = await previewRecoveryDiscordPublication(input, f.deps);
  expect(preview.kind).toBe("ready");
  expect(
    preview.targets.find((target) => target.role === "summary")?.unchanged,
  ).toBe(true);
  f.messages.get("401")!.embeds[0].description = "Old summary";
  expect(
    (await previewRecoveryDiscordPublication(input, f.deps)).targets.find(
      (target) => target.role === "summary",
    )?.afterEmbeds[0].description,
  ).toContain(f.history.summarySentence);
});

test("preservesRussianUncertainty", async () => {
  const f = fixture();
  const preview = await previewRecoveryDiscordPublication(input, f.deps);
  expect(preview.targets[0].afterEmbeds[0].description).toBe(f.history.notes);
  expect(preview.targets[0].afterEmbeds[0].footer).toEqual({
    text: "v2 | Recovered notes • Some audio could not be transcribed. These notes may be incomplete.",
  });
  expect(f.history.notesVersion).toBe(2);
});

test.each([
  "notesHash",
  "pointer",
  "prefix",
  "version",
  "uncertainty",
  "approval",
  "manifestKey",
  "emptyIds",
])("blocks invalid recovery binding: %s", async (change) => {
  const f = fixture();
  switch (change) {
    case "notesHash":
      f.history.notes += " changed";
      break;
    case "pointer":
      f.history.transcriptS3Key = `${folder}transcript.json`;
      break;
    case "prefix":
      f.history.operatorRecovery.originalTranscriptS3Key =
        "other/transcript.json";
      break;
    case "version":
      f.history.notesVersion = 3;
      break;
    case "uncertainty":
      f.manifest.uncertaintiesRetained = false;
      break;
    case "approval":
      f.manifest.approvedBy = "";
      break;
    case "manifestKey":
      f.history.operatorRecovery.manifestS3Key = "other";
      break;
    case "emptyIds":
      f.history.notesMessageIds = [];
      break;
  }
  expect((await previewRecoveryDiscordPublication(input, f.deps)).kind).toBe(
    "blocked",
  );
});

test("validates aggregate limits including unrelated embeds", async () => {
  const f = fixture("Я".repeat(3900));
  f.messages
    .get("400")!
    .embeds.push({ description: "a".repeat(2200), url: "https://example.org" });
  expect((await previewRecoveryDiscordPublication(input, f.deps)).kind).toBe(
    "blocked",
  );
});

test("uses existing notes renderer without modifying stored fields", async () => {
  const f = fixture();
  const expected = buildMeetingNotesEmbeds({
    notesBody: f.history.notes,
    meetingName: f.history.meetingName,
    processing: { transcription: "partial" },
    color: 123,
    footerText: "v2 | Recovered notes",
  }).map((embed) => ({ ...embed.toJSON(), timestamp }));
  expect(
    (await previewRecoveryDiscordPublication(input, f.deps)).targets[0]
      .afterEmbeds,
  ).toEqual(expected);
});

test("blocks a saved single message claiming missing pagination slots", async () => {
  const f = fixture();
  f.messages.get("400")!.embeds[0].title = "Meeting Notes (part 1/9)";
  expect((await previewRecoveryDiscordPublication(input, f.deps)).kind).toBe(
    "blocked",
  );
});

test.each(["image", "video", "link"])(
  "blocks unsupported %s embed types",
  async (type) => {
    const f = fixture();
    f.messages.get("400")!.embeds.push({ type, url: "https://example.org" });
    expect((await previewRecoveryDiscordPublication(input, f.deps)).kind).toBe(
      "blocked",
    );
  },
);

test("blocks an unfamiliar footer rather than losing uncertainty", async () => {
  const f = fixture();
  f.messages.get("400")!.embeds[0].footer = {
    text: "v1 • Имена говорящих не подтверждены.",
  };
  expect((await previewRecoveryDiscordPublication(input, f.deps)).kind).toBe(
    "blocked",
  );
});

test.each(["component", "attachment", "flags", "author"])(
  "fingerprints preserved %s fields",
  async (change) => {
    const f = fixture();
    const before = await previewRecoveryDiscordPublication(input, f.deps);
    const message = f.messages.get("400")!;
    switch (change) {
      case "component":
        message.components = [];
        break;
      case "attachment":
        message.attachments = [];
        break;
      case "flags":
        message.flags = 4;
        break;
      case "author":
        message.author.id = "999";
        break;
    }
    const after = await previewRecoveryDiscordPublication(input, f.deps);
    expect(after.previewDigest).not.toBe(before.previewDigest);
    if (change !== "author")
      expect(after.targets[0].beforeFingerprint).not.toBe(
        before.targets[0].beforeFingerprint,
      );
  },
);

test("keeps whitespace significant and ignores object key order", async () => {
  const f = fixture();
  const before = await previewRecoveryDiscordPublication(input, f.deps);
  const message = f.messages.get("400")!;
  message.embeds[0] = Object.fromEntries(
    Object.entries(message.embeds[0]).reverse(),
  );
  expect(
    (await previewRecoveryDiscordPublication(input, f.deps)).targets[0]
      .beforeFingerprint,
  ).toBe(before.targets[0].beforeFingerprint);
  message.embeds[0].description += " ";
  expect(
    (await previewRecoveryDiscordPublication(input, f.deps)).targets[0]
      .beforeFingerprint,
  ).not.toBe(before.targets[0].beforeFingerprint);
});

test("records exact already matching notes as unchanged", async () => {
  const f = fixture();
  const before = await previewRecoveryDiscordPublication(input, f.deps);
  f.messages.get("400")!.embeds = before.targets[0].afterEmbeds;
  const after = await previewRecoveryDiscordPublication(input, f.deps);
  expect(after.kind).toBe("ready");
  expect(after.targets[0].unchanged).toBe(true);
  expect(after.targets[0].changes).toEqual([]);
});

test("returns a safe blocker without exposing provider errors", async () => {
  const f = fixture();
  f.deps.readHistory.mockRejectedValue(new Error("secret private response"));
  const preview = await previewRecoveryDiscordPublication(input, f.deps);
  expect(preview.kind).toBe("blocked");
  expect(JSON.stringify(preview)).not.toContain("secret private response");
});

test("source imports never load application config or LLM clients", () => {
  jest.isolateModules(() => {
    jest.doMock("../../src/services/configService", () => {
      throw new Error("Loaded application config");
    });
    jest.doMock("openai", () => {
      throw new Error("Loaded OpenAI");
    });
    expect(() =>
      jest.requireActual("../../src/services/recoveryDiscordPublication"),
    ).not.toThrow();
  });
  jest.dontMock("../../src/services/configService");
  jest.dontMock("openai");
});

test("cannot accept arbitrary replacement text", async () => {
  const f = fixture();
  const withNotes = { ...input, notes: "replacement" };
  await expect(
    previewRecoveryDiscordPublication(withNotes, f.deps),
  ).rejects.toThrow();
});
