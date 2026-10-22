/** @jest-environment node */
import {
  notesWarningFixture,
  titleOnlyFixture,
} from "./meetingUpdatePlan.fixture";
import { planMeetingUpdate } from "../../src/services/meetingUpdatePlan";
import {
  buildMeetingNotesEmbeds,
  batchMeetingNotesEmbeds,
} from "../../src/utils/meetingNotes";
import { formatMeetingCaptureNotice } from "../../src/utils/meetingCaptureNotice";
import { PARTIAL_TRANSCRIPT_NOTICE } from "../../src/utils/meetingProcessing";

const capture = {
  kind: "interrupted",
  startedAt: "2026-01-01T00:00:00Z",
  endedAt: null,
  detectedAt: "2026-01-01T01:00:00Z",
} as const;

it("renames real footerless batched initial pages twice with exact surviving surfaces", () => {
  const body = "x".repeat(4500);
  const input = titleOnlyFixture("Old name", body);
  input.history.updateDelivery.parts.summaryTitle = {
    desired: 0,
    acknowledged: 0,
  };
  const batches = batchMeetingNotesEmbeds(
    buildMeetingNotesEmbeds({ notesBody: body, color: 123 }),
  );
  expect(batches).toHaveLength(1);
  expect(batches[0]).toHaveLength(2);
  const original = batches[0].map((embed) => ({ ...embed.toJSON() }));
  const media = { image: { url: "https://example.test/keep.png" } };
  input.messages[0].embeds = [original[0], media, original[1]];
  input.messages[0].content = "Keep https://example.test";
  const messageId = input.messages[0].id;
  const pointers = [...input.history.notesMessageIds];
  for (const [index, name] of ["Old name", "New name"].entries()) {
    input.history.meetingName = name;
    input.history.contentRevision = index + 1;
    input.history.updateDelivery.parts.notesTitle = {
      desired: index + 1,
      acknowledged: index,
    };
    const result = planMeetingUpdate(input);
    expect(result).toMatchObject({ kind: "ready" });
    if (result.kind !== "ready") return;
    expect(result.attempt.expectedPointers.notesMessageIds).toEqual(pointers);
    expect(
      result.attempt.operations.map((operation) => operation.kind),
    ).toEqual(["patch"]);
    const after = result.targets[0].after;
    expect(after.id).toBe(messageId);
    expect(after.content).toBe(input.messages[0].content);
    expect(after.embeds[1]).toEqual(media);
    for (const [page, slot] of [0, 2].entries()) {
      expect(after.embeds[slot]).toEqual({
        ...original[page],
        title: name + " (part " + (page + 1) + "/2)",
      });
      expect(after.embeds[slot]).not.toHaveProperty("footer");
    }
    input.messages[0] = after;
  }
});

it.each(["reversed", "mixed-base", "mixed-total", "unrelated"])(
  "blocks an ambiguous footerless pagination group (%s)",
  (mode) => {
    const input = titleOnlyFixture("New name", "x".repeat(4500));
    input.messages[0].embeds = buildMeetingNotesEmbeds({
      notesBody: "x".repeat(4500),
      meetingName: "Old name",
    }).map((embed) => ({ ...embed.toJSON() }));
    const embeds = input.messages[0].embeds;
    if (mode === "reversed") embeds.reverse();
    if (mode === "mixed-base") embeds[1].title = "Other name (part 2/2)";
    if (mode === "mixed-total") embeds[1].title = "Old name (part 2/3)";
    if (mode === "unrelated")
      embeds.push({ title: "Unrelated", description: "Keep" });
    expect(planMeetingUpdate(input).kind).toBe("blocked");
  },
);

it.each(["already-partial", "becomes-partial"])(
  "keeps the full interrupted capture prefix and body through two warning refreshes (%s)",
  (mode) => {
    const body = "Unchanged notes body";
    const input = notesWarningFixture(body);
    input.history.capture = capture;
    input.history.notes = body;
    const initial = {
      ...input.history,
      processing:
        mode === "already-partial" ? input.history.processing : undefined,
    };
    input.messages[0].embeds = buildMeetingNotesEmbeds({
      ...initial,
      notesBody: body,
      footerText: "v1",
      color: 321,
    }).map((embed) => ({ ...embed.toJSON() }));
    const title = input.messages[0].embeds[0].title;
    const expected = formatMeetingCaptureNotice(input.history)!;
    expect(expected).toContain("Saved recording coverage is unknown.");
    expect(expected).toContain("The exact recording end time is unknown.");
    for (let refresh = 1; refresh <= 2; refresh++) {
      input.history.contentRevision = refresh;
      input.history.updateDelivery.parts.notesWarning = {
        desired: refresh,
        acknowledged: refresh - 1,
      };
      const result = planMeetingUpdate(input);
      expect(result).toMatchObject({ kind: "ready" });
      if (result.kind !== "ready") return;
      const after = result.targets[0].after;
      expect(after.embeds[0]).toMatchObject({
        title,
        description: expected + "\n\n" + body,
        footer: { text: "v1 • " + PARTIAL_TRANSCRIPT_NOTICE },
        color: 321,
      });
      expect(
        (after.embeds[0].description as string).split(expected),
      ).toHaveLength(2);
      input.messages[0] = after;
    }
  },
);
