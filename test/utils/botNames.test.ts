import { expect, test } from "@jest/globals";
import { getBotNameVariants } from "../../src/utils/botNames";

test("getBotNameVariants includes defaults without guild data", () => {
  const names = getBotNameVariants();
  expect(names).toEqual(
    expect.arrayContaining([
      "Chronote",
      "Meeting Notes Bot",
      "MeetingNotesBot",
    ]),
  );
});

test("getBotNameVariants includes member names and dedupes case-insensitively", () => {
  const names = getBotNameVariants(
    {
      displayName: "Chronote",
      nickname: "Chronote",
      user: { displayName: "Chronote", username: "MeetingNotesBot" },
    },
    { displayName: "Chronote", username: "MeetingNotesBot" },
  );
  const lower = names.map((name) => name.toLowerCase());
  expect(lower.filter((name) => name === "chronote")).toHaveLength(1);
  expect(names).toEqual(expect.arrayContaining(["MeetingNotesBot"]));
});

test("getBotNameVariants includes server nickname when present", () => {
  const names = getBotNameVariants({
    nickname: "CJ",
    user: { displayName: "Chronote", username: "MeetingNotesBot" },
  });
  expect(names).toEqual(expect.arrayContaining(["CJ"]));
});
