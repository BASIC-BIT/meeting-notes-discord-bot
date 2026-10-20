import { createHash } from "node:crypto";
import { z } from "zod";
import type { MeetingHistory } from "../types/db";
import { MEETING_STATUS } from "../types/meetingLifecycle";
import {
  recordingCaptureStateSchema,
  captureCoverageSummarySchema,
} from "../types/recordingCheckpoint";
import {
  discordBotIdentitySchema,
  discordChannelSchema,
  discordEditorMessageSchema,
  type DiscordEditorMessage,
} from "./discordMessageEditor";
import {
  batchMeetingNotesEmbeds,
  buildMeetingNotesEmbeds,
} from "../utils/meetingNotes";
import {
  formatMeetingCaptureNotice,
  withMeetingCaptureNotice,
} from "../utils/meetingCaptureNotice";
import { getMeetingProcessingNotice } from "../utils/meetingProcessing";

class PublicationPreviewBlockedError extends Error {}

const id = z.string().regex(/^\d+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const key = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value
        .split("/")
        .every(
          (part) =>
            part !== "" &&
            part !== "." &&
            part !== ".." &&
            !part.includes("\\"),
        ),
    "Invalid object key",
  );
const object = z.record(z.string(), z.unknown());
export const publicationScopeSchema = z
  .object({
    accountId: z.string().regex(/^\d{12}$/),
    region: z.string().min(1),
    table: z.string().min(1),
    bucket: z.string().min(1),
    guildId: id,
    meetingKey: z.string().min(1),
    recoveryManifestKey: key,
  })
  .strict();
export type PublicationScope = z.infer<typeof publicationScopeSchema>;

const operatorRecoverySchema = z.object({
  appliedAt: z.string().min(1),
  completenessVerified: z.boolean(),
  id: z.string().min(1),
  language: z.string().min(1),
  manifestS3Key: key,
  notesSha256: hash,
  notificationStatus: z.string(),
  notionSyncStatus: z.string(),
  operatorActorArn: z.string().min(1),
  originalNotesVersion: z.number().int().positive(),
  originalTranscriptS3Key: key,
  transcriptSha256: hash,
});
const historyShape = {
  guildId: id,
  channelId_timestamp: z.string().min(1),
  channelId: id,
  timestamp: z.iso.datetime(),
  meetingId: z.string().min(1),
  notes: z.string().min(1),
  notesVersion: z.number().int().positive(),
  meetingName: z.string().optional(),
  summarySentence: z.string().optional(),
  summaryLabel: z.string().optional(),
  transcriptS3Key: key,
  notesChannelId: id,
  notesMessageIds: z.array(id).min(1),
  summaryMessageId: id.optional(),
  textChannelId: id.optional(),
  capture: recordingCaptureStateSchema.optional(),
  captureCoverage: captureCoverageSummarySchema.optional(),
  status: z.enum(MEETING_STATUS).optional(),
  processing: z
    .object({
      transcription: z.enum(["ready", "empty", "partial", "failed"]).optional(),
      notes: z.enum(["generated", "skipped", "failed"]).optional(),
      summary: z.enum(["generated", "skipped", "failed"]).optional(),
    })
    .optional(),
};
type PublicationHistoryFields = Pick<MeetingHistory, keyof typeof historyShape>;
export const publicationHistorySchema = z.object({
  ...historyShape,
  operatorRecovery: operatorRecoverySchema,
});
export type PublicationHistory = PublicationHistoryFields &
  z.infer<typeof publicationHistorySchema>;
export const recoveryPublicationManifestSchema = z.object({
  id: z.string().min(1),
  meetingId: z.string().min(1),
  language: z.string().min(1),
  approvedBy: z.string().min(1),
  approvedScope: z.string().min(1),
  nextNotesVersion: z.number().int().positive(),
  uncertaintiesRetained: z.literal(true),
  processingPartialWarningPreserved: z.literal(true),
  previous: z.object({
    transcriptKey: key,
    notesVersion: z.number().int().positive(),
  }),
  objects: z
    .array(z.object({ role: z.string().min(1), key, sha256: hash }))
    .min(2),
});

const footer = z.object({ text: z.string(), icon_url: z.string().optional() });
const image = z.object({ url: z.string() });
const editableEmbedSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
  timestamp: z.string().optional(),
  color: z.number().int().min(0).max(0xffffff).optional(),
  footer: footer.optional(),
  image: image.optional(),
  thumbnail: image.optional(),
  author: z
    .object({
      name: z.string(),
      url: z.string().optional(),
      icon_url: z.string().optional(),
    })
    .optional(),
  fields: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        inline: z.boolean().optional(),
      }),
    )
    .optional(),
});
export function normalizePublicationEmbeds(embeds: unknown[]) {
  return embeds.map((embed) => editableEmbedSchema.parse(embed));
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, child]) => [name, canonical(child)]),
    );
  return value;
}
export function stablePublicationJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}
export function publicationDigest(value: unknown): string {
  const parsed = object.parse(value);
  const { previewDigest: _digest, ...data } = parsed;
  void _digest;
  return createHash("sha256").update(stablePublicationJson(data)).digest("hex");
}
function digest(value: unknown): string {
  return createHash("sha256")
    .update(stablePublicationJson(value))
    .digest("hex");
}
export function publicationMessageFingerprint(
  message: DiscordEditorMessage,
): string {
  return digest({
    id: message.id,
    channel_id: message.channel_id,
    author: { id: message.author.id, bot: message.author.bot },
    webhook_id: message.webhook_id,
    content: message.content,
    embeds: normalizePublicationEmbeds(message.embeds),
    components: message.components,
    attachments: message.attachments.map(
      ({ id, filename, description, size, content_type, ephemeral }) => ({
        id,
        filename,
        description,
        size,
        content_type,
        ephemeral,
      }),
    ),
    flags: message.flags,
  });
}
const bindingSchema = z.object({
  meetingId: z.string(),
  notesVersion: z.number().int().positive(),
  transcriptS3Key: key,
  storedFieldsDigest: hash,
  manifestDigest: hash,
  artifactFolder: z.string(),
  recoveryPrefix: z.string(),
  claimKey: key,
});
const targetSchema = z.object({
  role: z.enum(["notes", "summary"]),
  channelId: id,
  messageId: id,
  url: z.string(),
  before: discordEditorMessageSchema,
  beforeFingerprint: hash,
  afterEmbeds: z.array(object),
  afterFingerprint: hash,
  afterEmbedsDigest: hash,
  unchanged: z.boolean(),
  changes: z.array(
    z.object({
      embedIndex: z.number().int().nonnegative(),
      before: object,
      after: object,
    }),
  ),
});
const previewCommon = {
  schemaVersion: z.literal(1),
  scope: publicationScopeSchema,
  createdAt: z.iso.datetime(),
  botId: id.nullable(),
  targets: z.array(targetSchema),
  previewDigest: hash,
};
export const recoveryDiscordPreviewSchema = z.discriminatedUnion("kind", [
  z.object({
    ...previewCommon,
    kind: z.literal("ready"),
    binding: bindingSchema,
    blockers: z.array(z.string()).length(0),
  }),
  z.object({
    ...previewCommon,
    kind: z.literal("blocked"),
    binding: bindingSchema.nullable(),
    blockers: z.array(z.string()).min(1),
  }),
]);
export type RecoveryDiscordPreview = z.infer<
  typeof recoveryDiscordPreviewSchema
>;
export const publicationMessageReceiptSchema = z.object({
  channelId: id,
  messageId: id,
  runId: z.string().min(1),
  state: z.enum(["pending", "submitted", "verified", "failed", "uncertain"]),
  updatedAt: z.iso.datetime(),
  beforeFingerprint: hash,
  desiredFingerprint: hash,
  observedFingerprint: hash.nullable(),
  reason: z.string().nullable(),
});
export const publicationReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  previewDigest: hash,
  meetingId: z.string(),
  notesVersion: z.number().int().positive(),
  storedFieldsDigest: hash,
  status: z.enum([
    "running",
    "verified",
    "partial",
    "uncertain",
    "superseded",
    "failed",
  ]),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  messages: z.array(publicationMessageReceiptSchema),
});
export type PublicationReceipt = z.infer<typeof publicationReceiptSchema>;
export const publicationClaimSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  previewDigest: hash,
  meetingId: z.string(),
  notesVersion: z.number().int().positive(),
  state: z.enum(["running", "terminal"]),
  receiptKey: key,
  unresolvedMessageIds: z.array(id),
});
export type PublicationClaim = z.infer<typeof publicationClaimSchema>;
const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absent") }),
  z.object({ kind: z.literal("match"), etag: z.string().min(1) }),
]);
const targetInput = z.object({ channelId: id, messageId: id });
export const publicationDependenciesSchema = z.object({
  readHistory: z.function({
    input: [publicationScopeSchema],
    output: z.promise(z.unknown()),
  }),
  readManifest: z.function({
    input: [publicationScopeSchema],
    output: z.promise(z.unknown()),
  }),
  now: z.function({ input: [], output: z.iso.datetime() }),
  discord: z.object({
    getBotIdentity: z.function({
      input: [],
      output: z.promise(discordBotIdentitySchema),
    }),
    getChannel: z.function({
      input: [id],
      output: z.promise(discordChannelSchema),
    }),
    getMessage: z.function({
      input: [targetInput],
      output: z.promise(discordEditorMessageSchema.nullable()),
    }),
    editEmbeds: z.function({
      input: [targetInput.extend({ embeds: z.array(object) })],
      output: z.promise(z.enum(["acknowledged", "missing"])),
    }),
  }),
  storage: z.object({
    savePreview: z.function({
      input: [recoveryDiscordPreviewSchema],
      output: z.promise(z.void()),
    }),
    readReceipt: z.function({
      input: [key],
      output: z.promise(
        z
          .object({ value: publicationReceiptSchema, etag: z.string() })
          .nullable(),
      ),
    }),
    saveReceipt: z.function({
      input: [
        z.object({
          key,
          receipt: publicationReceiptSchema,
          condition: conditionSchema,
        }),
      ],
      output: z.promise(z.string()),
    }),
    readClaim: z.function({
      input: [key],
      output: z.promise(
        z
          .object({ value: publicationClaimSchema, etag: z.string() })
          .nullable(),
      ),
    }),
    writeClaim: z.function({
      input: [
        z.object({
          key,
          claim: publicationClaimSchema,
          condition: conditionSchema,
        }),
      ],
      output: z.promise(z.string()),
    }),
  }),
});
export type PublicationDependencies = z.infer<
  typeof publicationDependenciesSchema
>;

export function bindRecoveryPublication(
  scope: PublicationScope,
  history: PublicationHistory,
  manifest: z.infer<typeof recoveryPublicationManifestSchema>,
) {
  const recovery = history.operatorRecovery;
  const artifactFolder = recovery.originalTranscriptS3Key.slice(
    0,
    recovery.originalTranscriptS3Key.lastIndexOf("/") + 1,
  );
  const expectedSuffix = `${history.guildId}/${history.channelId}_${history.meetingId}_${new Date(history.timestamp).toISOString().replace(/:/g, "-")}/`;
  const recoveryPrefix = scope.recoveryManifestKey.slice(
    0,
    scope.recoveryManifestKey.lastIndexOf("/") + 1,
  );
  const notes = manifest.objects.filter((entry) => entry.role === "notes");
  const transcripts = manifest.objects.filter(
    (entry) => entry.role === "transcript",
  );
  if (notes.length !== 1 || transcripts.length !== 1)
    throw new PublicationPreviewBlockedError(
      "Stored recovery manifest must identify exactly one notes and transcript object",
    );
  const notesSha256 = createHash("sha256").update(history.notes).digest("hex");
  const identities = [
    [history.guildId, scope.guildId],
    [history.channelId_timestamp, scope.meetingKey],
    [manifest.meetingId, history.meetingId],
    [recoveryPrefix, `${artifactFolder}recovery/${manifest.id}/`],
    [recovery.manifestS3Key, scope.recoveryManifestKey],
    [recovery.id, manifest.id],
    [recovery.language, manifest.language],
    [recovery.notesSha256, notesSha256],
    [history.notesVersion, manifest.nextNotesVersion],
    [recovery.originalNotesVersion, manifest.previous.notesVersion],
    [recovery.originalTranscriptS3Key, manifest.previous.transcriptKey],
    [notes[0].sha256, notesSha256],
    [transcripts[0].key, history.transcriptS3Key],
    [transcripts[0].sha256, recovery.transcriptSha256],
  ];
  const objectsBound = manifest.objects.every(
    (entry) =>
      entry.key.startsWith(recoveryPrefix) &&
      !entry.key.slice(recoveryPrefix.length).includes("/"),
  );
  if (
    !artifactFolder.endsWith(expectedSuffix) ||
    !identities.every(([actual, expected]) => actual === expected) ||
    !objectsBound ||
    new Set(manifest.objects.map((entry) => entry.key)).size !==
      manifest.objects.length
  )
    throw new PublicationPreviewBlockedError(
      "Stored meeting and approved recovery manifest do not match",
    );
  return bindingSchema.parse({
    meetingId: history.meetingId,
    notesVersion: history.notesVersion,
    transcriptS3Key: history.transcriptS3Key,
    storedFieldsDigest: digest(history),
    manifestDigest: digest(manifest),
    artifactFolder,
    recoveryPrefix,
    claimKey: `${artifactFolder}recovery/discord-publication/claims/${history.notesVersion}.json`,
  });
}
type EditableEmbed = z.infer<typeof editableEmbedSchema>;
function isSummaryEmbed(embed: EditableEmbed): boolean {
  const names = new Set(embed.fields?.map((field) => field.name.toLowerCase()));
  return (
    ["start time", "end time", "duration"].filter((name) => names.has(name))
      .length >= 2
  );
}
function isNotesEmbed(embed: EditableEmbed, meetingName?: string): boolean {
  const forbidden = [
    embed.fields?.length,
    embed.author,
    embed.image,
    embed.thumbnail,
    embed.url,
  ];
  if (
    !embed.title ||
    embed.description === undefined ||
    forbidden.some(Boolean)
  )
    return false;
  const base = embed.title.replace(/ \(part \d+\/\d+\)$/, "");
  return (
    base === "Meeting Notes" ||
    base === meetingName?.trim() ||
    /^v\d+(?:$|[ •|])/.test(embed.footer?.text ?? "")
  );
}
const limitedEmbedSchema = editableEmbedSchema.extend({
  title: z.string().max(256).optional(),
  description: z.string().max(4096).optional(),
  footer: footer.extend({ text: z.string().max(2048) }).optional(),
  author: editableEmbedSchema.shape.author
    .unwrap()
    .extend({ name: z.string().max(256) })
    .optional(),
  fields: z
    .array(
      z.object({
        name: z.string().max(256),
        value: z.string().max(1024),
        inline: z.boolean().optional(),
      }),
    )
    .max(25)
    .optional(),
});
function validateLimits(embeds: EditableEmbed[]) {
  z.array(limitedEmbedSchema).max(10).parse(embeds);
  const total = embeds.reduce(
    (sum, embed) =>
      sum +
      [
        embed.title,
        embed.description,
        embed.footer?.text,
        embed.author?.name,
        ...(embed.fields?.flatMap((field) => [field.name, field.value]) ?? []),
      ].join("").length,
    0,
  );
  if (total > 6000)
    throw new PublicationPreviewBlockedError(
      "Proposed message exceeds Discord aggregate text limit",
    );
}
function makeTarget(
  message: DiscordEditorMessage,
  afterEmbeds: Array<Record<string, unknown>>,
  role: "notes" | "summary",
  guildId: string,
): z.infer<typeof targetSchema> {
  const beforeEmbeds = normalizePublicationEmbeds(message.embeds);
  validateLimits(normalizePublicationEmbeds(afterEmbeds));
  return {
    role,
    channelId: message.channel_id,
    messageId: message.id,
    url: `https://discord.com/channels/${guildId}/${message.channel_id}/${message.id}`,
    before: message,
    beforeFingerprint: publicationMessageFingerprint(message),
    afterEmbeds,
    afterFingerprint: publicationMessageFingerprint({
      ...message,
      embeds: afterEmbeds,
    }),
    afterEmbedsDigest: digest(afterEmbeds),
    unchanged:
      stablePublicationJson(beforeEmbeds) ===
      stablePublicationJson(afterEmbeds),
    changes: afterEmbeds.flatMap((embed, index) =>
      stablePublicationJson(beforeEmbeds[index]) ===
      stablePublicationJson(embed)
        ? []
        : [{ embedIndex: index, before: beforeEmbeds[index], after: embed }],
    ),
  };
}
function targetChannel(stored: PublicationHistory, messageId: string): string {
  return messageId === stored.summaryMessageId
    ? (stored.textChannelId ?? stored.notesChannelId)
    : stored.notesChannelId;
}
function validatePublicationMessage(
  message: DiscordEditorMessage | null,
  {
    messageId,
    channelId,
    botId,
  }: { messageId: string; channelId: string; botId: string },
): asserts message is DiscordEditorMessage {
  if (
    !message ||
    message.id !== messageId ||
    message.channel_id !== channelId ||
    message.author.id !== botId ||
    !message.author.bot ||
    message.webhook_id ||
    (message.flags & 32768) !== 0
  )
    throw new PublicationPreviewBlockedError(
      `Saved Discord post ${messageId} is missing or not a supported bot-owned message`,
    );
  if (
    message.embeds.some(
      (embed) => embed.type !== undefined && embed.type !== "rich",
    )
  )
    throw new PublicationPreviewBlockedError(
      "Unrecognized non-rich embed cannot be preserved safely",
    );
}
async function readPublicationMessages(
  scope: PublicationScope,
  stored: PublicationHistory,
  botId: string,
  discord: PublicationDependencies["discord"],
) {
  const ids = [
    ...stored.notesMessageIds,
    ...(stored.summaryMessageId ? [stored.summaryMessageId] : []),
  ];
  if (new Set(ids).size !== ids.length)
    throw new PublicationPreviewBlockedError(
      "Duplicate or aliased summary and notes message IDs",
    );
  const channels = new Set(
    ids.map((messageId) => targetChannel(stored, messageId)),
  );
  for (const channelId of channels) {
    const channel = discordChannelSchema.parse(
      await discord.getChannel(channelId),
    );
    if (channel.id !== channelId || channel.guild_id !== scope.guildId)
      throw new PublicationPreviewBlockedError(
        "Saved message channel does not belong to selected guild",
      );
  }
  const messages: DiscordEditorMessage[] = [];
  for (const messageId of ids) {
    const channelId = targetChannel(stored, messageId);
    const raw = await discord.getMessage({ channelId, messageId });
    const message = raw === null ? null : discordEditorMessageSchema.parse(raw);
    validatePublicationMessage(message, { messageId, channelId, botId });
    messages.push(message);
  }
  return messages;
}
function mergeNotesSlot({
  current,
  candidate,
  page,
  total,
  footerText,
  requiredWarning,
}: {
  current: EditableEmbed;
  candidate: EditableEmbed;
  page: number;
  total: number;
  footerText: string;
  requiredWarning?: string;
}): EditableEmbed {
  const pagination = / \(part (\d+)\/(\d+)\)$/.exec(current.title ?? "");
  if (
    (total > 1 || pagination !== null) &&
    (!pagination ||
      Number(pagination[1]) !== page + 1 ||
      Number(pagination[2]) !== total)
  )
    throw new PublicationPreviewBlockedError(
      "Unrecognized notes pagination order",
    );
  if (
    !candidate.footer?.text.startsWith(footerText) ||
    (requiredWarning && !candidate.footer.text.includes(requiredWarning))
  )
    throw new PublicationPreviewBlockedError(
      "Required recovered version or uncertainty notice would be truncated",
    );
  const retainedNotice = current.footer?.text.replace(
    /^v\d+(?: \| Recovered notes| • Edited by [^•]+)?(?: • )?/,
    "",
  );
  if (retainedNotice && retainedNotice !== requiredWarning)
    throw new PublicationPreviewBlockedError(
      "Unrecognized existing footer may contain uncertainty text",
    );
  return {
    ...current,
    ...candidate,
    ...(current.color === undefined ? {} : { color: current.color }),
    footer: { ...current.footer, text: candidate.footer.text },
  };
}
function planNotesTargets(
  scope: PublicationScope,
  stored: PublicationHistory,
  messages: DiscordEditorMessage[],
) {
  const layouts = messages
    .filter((message) => message.id !== stored.summaryMessageId)
    .map((message) => {
      const embeds = normalizePublicationEmbeds(message.embeds);
      if (embeds.some(isSummaryEmbed))
        throw new PublicationPreviewBlockedError(
          "Mixed summary and notes layout is unsupported",
        );
      const slots = embeds.flatMap((embed, index) =>
        isNotesEmbed(embed, stored.meetingName) ? [index] : [],
      );
      if (!slots.length)
        throw new PublicationPreviewBlockedError(
          "Unrecognized notes embed layout",
        );
      return { message, embeds, slots };
    });
  const footerText = `v${stored.notesVersion} | Recovered notes`;
  const rendered = buildMeetingNotesEmbeds({
    ...stored,
    notesBody: stored.notes,
    footerText,
  });
  const batches = batchMeetingNotesEmbeds(rendered);
  const total = layouts.reduce((sum, layout) => sum + layout.slots.length, 0);
  const batchLayoutChanged =
    layouts.some((layout) => layout.slots.length > 1) &&
    (batches.length !== layouts.length ||
      batches.some(
        (batch, index) => batch.length !== layouts[index].slots.length,
      ));
  if (rendered.length !== total || batchLayoutChanged)
    throw new PublicationPreviewBlockedError(
      "Approved notes require a different pagination or message slot count",
    );
  const requiredWarning =
    getMeetingProcessingNotice(stored.processing, Boolean(stored.notes.trim()))
      ?.text ?? formatMeetingCaptureNotice(stored);
  let page = 0;
  return layouts.map(({ message, embeds, slots }) => {
    const after = [...embeds];
    for (const slot of slots) {
      const candidate = normalizePublicationEmbeds([
        rendered[page].toJSON(),
      ])[0];
      after[slot] = mergeNotesSlot({
        current: embeds[slot],
        candidate,
        page,
        total,
        footerText,
        requiredWarning,
      });
      page++;
    }
    return makeTarget(message, after, "notes", scope.guildId);
  });
}
function planSummaryTarget(
  scope: PublicationScope,
  stored: PublicationHistory,
  message: DiscordEditorMessage,
) {
  const embeds = normalizePublicationEmbeds(message.embeds);
  const slots = embeds.flatMap((embed, index) =>
    isSummaryEmbed(embed) ? [index] : [],
  );
  if (
    slots.length !== 1 ||
    embeds.some((embed) => isNotesEmbed(embed, stored.meetingName))
  )
    throw new PublicationPreviewBlockedError(
      "Unrecognized or mixed summary layout",
    );
  const summary = stored.summarySentence?.trim() ?? stored.summaryLabel?.trim();
  const description = withMeetingCaptureNotice(
    summary && summary.length ? summary : "Summary unavailable.",
    stored,
  );
  const after = [...embeds];
  after[slots[0]] = {
    ...embeds[slots[0]],
    title:
      stored.meetingName?.trim() ||
      stored.summaryLabel?.trim() ||
      "Meeting Summary",
    description,
  };
  return makeTarget(message, after, "summary", scope.guildId);
}
function previewBlocker(error: unknown): string {
  // Provider errors can contain private response bodies; retain only local blocker messages.
  if (error instanceof z.ZodError)
    return "Discord response has an unsupported shape";
  if (error instanceof PublicationPreviewBlockedError) return error.message;
  return "Publication preview could not read or validate its selected sources";
}
export async function previewRecoveryDiscordPublication(
  input: PublicationScope,
  deps: PublicationDependencies,
): Promise<RecoveryDiscordPreview> {
  const scope = publicationScopeSchema.parse(input);
  const createdAt = deps.now();
  let binding: z.infer<typeof bindingSchema> | null = null;
  let botId: string | null = null;
  const targets: z.infer<typeof targetSchema>[] = [];
  const blockers: string[] = [];
  try {
    const history = publicationHistorySchema.safeParse(
      await deps.readHistory(scope),
    );
    const manifest = recoveryPublicationManifestSchema.safeParse(
      await deps.readManifest(scope),
    );
    if (!history.success || !manifest.success)
      throw new PublicationPreviewBlockedError(
        "Stored meeting or approved operator recovery manifest is invalid",
      );
    const stored = history.data;
    binding = bindRecoveryPublication(scope, stored, manifest.data);
    const bot = discordBotIdentitySchema.parse(
      await deps.discord.getBotIdentity(),
    );
    botId = bot.id;
    const messages = await readPublicationMessages(
      scope,
      stored,
      botId,
      deps.discord,
    );
    targets.push(...planNotesTargets(scope, stored, messages));
    const summary = messages.find(
      (message) => message.id === stored.summaryMessageId,
    );
    if (summary) targets.push(planSummaryTarget(scope, stored, summary));
  } catch (error) {
    blockers.push(previewBlocker(error));
  }
  const result = {
    schemaVersion: 1,
    scope,
    createdAt,
    botId,
    binding,
    targets,
    blockers,
    kind: blockers.length ? "blocked" : "ready",
  };
  return recoveryDiscordPreviewSchema.parse({
    ...result,
    previewDigest: publicationDigest(result),
  });
}
