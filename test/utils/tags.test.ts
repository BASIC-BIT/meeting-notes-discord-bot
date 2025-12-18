import { expect, describe, it } from "@jest/globals";
import { normalizeTags, parseTags, topTags } from "../../src/utils/tags";

describe("parseTags", () => {
  it("returns undefined for empty or missing input", () => {
    expect(parseTags(undefined)).toBeUndefined();
    expect(parseTags(null as unknown as string)).toBeUndefined();
    expect(parseTags("   ")).toBeUndefined();
  });

  it("splits, trims, and filters blanks", () => {
    expect(parseTags("alpha, beta , ,gamma")).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });
});

describe("normalizeTags", () => {
  it("returns undefined when nothing usable remains", () => {
    expect(normalizeTags([])).toBeUndefined();
    expect(normalizeTags(["   ", ""])).toBeUndefined();
  });

  it("trims, removes blanks, and deduplicates while preserving order", () => {
    expect(
      normalizeTags([" alpha ", "beta", "alpha", "beta", "gamma "]),
    ).toEqual(["alpha", "beta", "gamma"]);
  });
});

describe("topTags", () => {
  const meetings = [
    { tags: ["project-x", "retro"] }, // most recent, highest weight
    { tags: ["retro"] },
    { tags: ["oncall", "project-x"] }, // oldest, lowest weight
  ];

  it("applies simple recency weighting and orders by weighted frequency", () => {
    const result = topTags(meetings);
    expect(result.slice(0, 3)).toEqual(["retro", "project-x", "oncall"]);
  });

  it("respects the max limit", () => {
    expect(topTags(meetings, 1)).toEqual(["retro"]);
  });

  it("ignores empty or missing tag arrays", () => {
    const withGaps = [{}, { tags: ["a"] }, { tags: ["b"] }];
    expect(topTags(withGaps, 2)).toEqual(["a", "b"]);
  });
});
