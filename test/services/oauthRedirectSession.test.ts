import { describe, expect, test } from "@jest/globals";
import {
  readOauthRedirectFromRequest,
  stashOauthRedirectFromSession,
} from "../../src/services/oauthRedirectSession";

describe("oauthRedirectSession", () => {
  test("returns undefined when no session redirect exists", () => {
    const req = {};
    expect(stashOauthRedirectFromSession(req)).toBeUndefined();
    expect(readOauthRedirectFromRequest(req)).toBeUndefined();
  });

  test("stashes and clears oauth redirect from session", () => {
    const req = { session: { oauthRedirect: "http://example.test/portal" } };
    expect(stashOauthRedirectFromSession(req)).toBe(
      "http://example.test/portal",
    );
    expect(req.session?.oauthRedirect).toBeUndefined();
    expect(readOauthRedirectFromRequest(req)).toBe(
      "http://example.test/portal",
    );
  });
});
