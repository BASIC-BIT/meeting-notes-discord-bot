import { describe, expect, test } from "@jest/globals";
import { stripCodeFences } from "../../src/utils/text";

describe("stripCodeFences", () => {
  test("returns trimmed text when no fences are present", () => {
    expect(stripCodeFences("  hello world  ")).toBe("hello world");
  });

  test("removes fenced block with language tag", () => {
    const input = "```ts\nconst x = 1;\n```";
    expect(stripCodeFences(input)).toBe("const x = 1;");
  });

  test("removes opening fence even without closing fence", () => {
    const input = "```\nline one\nline two";
    expect(stripCodeFences(input)).toBe("line one\nline two");
  });
});
