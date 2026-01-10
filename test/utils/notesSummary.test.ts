import { expect, test } from "@jest/globals";
import { formatNotesWithSummary } from "../../src/utils/notesSummary";

test("formatNotesWithSummary prepends summary line", () => {
  const notes = "Line one\nLine two";
  const result = formatNotesWithSummary(notes, "A short summary.");
  expect(result).toBe("Summary: A short summary.\n\nLine one\nLine two");
});

test("formatNotesWithSummary returns notes when summaries are missing", () => {
  const notes = "Only notes";
  const result = formatNotesWithSummary(notes);
  expect(result).toBe("Only notes");
});
