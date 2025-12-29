import { expect, test } from "@jest/globals";
import { parseMeetingSummaryResponse } from "../../src/services/meetingSummaryService";

test("parseMeetingSummaryResponse trims summaries", () => {
  const parsed = parseMeetingSummaryResponse(
    '{"summarySentence":"  A short summary.  ","summaryLabel":"  Weekly sync "}',
  );
  expect(parsed).toEqual({
    summarySentence: "A short summary.",
    summaryLabel: "Weekly sync",
  });
});

test("parseMeetingSummaryResponse returns undefined on empty input", () => {
  const parsed = parseMeetingSummaryResponse(" ");
  expect(parsed).toBeUndefined();
});
