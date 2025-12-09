import { TextDecoder, TextEncoder } from "util";
import {
  Headers,
  Request,
  Response,
  ReadableStream,
  TransformStream,
  WritableStream,
  fetch,
} from "undici";
import { buildPaginatedEmbeds } from "../../src/utils/embedPagination";

// Ensure encoders/streams/fetch globals for discord.js expectations
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = global as any;
g.TextEncoder = g.TextEncoder || TextEncoder;
g.TextDecoder = g.TextDecoder || TextDecoder;
g.ReadableStream = g.ReadableStream || ReadableStream;
g.WritableStream = g.WritableStream || WritableStream;
g.TransformStream = g.TransformStream || TransformStream;
g.fetch = g.fetch || fetch;
g.Headers = g.Headers || Headers;
g.Request = g.Request || Request;
g.Response = g.Response || Response;

function toDescriptions(embeds: ReturnType<typeof buildPaginatedEmbeds>) {
  return embeds.map((e) => e.toJSON().description);
}

function toTitles(embeds: ReturnType<typeof buildPaginatedEmbeds>) {
  return embeds.map((e) => e.toJSON().title);
}

describe("buildPaginatedEmbeds", () => {
  const baseTitle = "Notes";
  const footer = "footer";
  const color = 0x00ff00;

  it("returns a single embed for short text and preserves footer/color", () => {
    const embeds = buildPaginatedEmbeds({
      text: "short",
      baseTitle,
      footerText: footer,
      color,
    });

    expect(embeds).toHaveLength(1);
    const json = embeds[0].toJSON();
    expect(json.description).toBe("short");
    expect(json.title).toBe(baseTitle);
    expect(json.footer?.text).toBe(footer);
    expect(json.color).toBe(color);
  });

  it("splits on the last newline before the limit", () => {
    const partA = "a".repeat(3000);
    const partB = "b".repeat(1500); // total > 4096
    const text = `${partA}\n${partB}`;

    const embeds = buildPaginatedEmbeds({
      text,
      baseTitle,
    });

    expect(embeds).toHaveLength(2);
    const descriptions = toDescriptions(embeds);
    expect(descriptions[0]).toHaveLength(3000); // newline excluded
    expect(descriptions[1]).toBe(partB);
    expect(toTitles(embeds)).toEqual(["Notes (part 1/2)", "Notes (part 2/2)"]);
  });

  it("hard-splits when no newline is available near the limit", () => {
    const text = "x".repeat(5000);
    const embeds = buildPaginatedEmbeds({ text, baseTitle });
    expect(embeds).toHaveLength(2);
    const descriptions = toDescriptions(embeds);
    expect(descriptions[0]).toHaveLength(4096);
    expect(descriptions[1]).toHaveLength(5000 - 4096);
  });

  it("splits into as many embeds as needed (one per message)", () => {
    // Produce 12 chunks of size 4100
    const chunk = "y".repeat(4100);
    const text = Array(12).fill(chunk).join("");

    const embeds = buildPaginatedEmbeds({ text, baseTitle });
    expect(embeds).toHaveLength(12); // no truncation when sending per message
    const last = embeds[embeds.length - 1].toJSON().description;
    expect((last ?? "").length).toBeLessThanOrEqual(4096);
  });
});
