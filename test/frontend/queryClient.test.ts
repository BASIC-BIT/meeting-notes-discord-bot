import { describe, expect, test } from "@jest/globals";
import { queryClient } from "../../src/frontend/queryClient";

describe("queryClient", () => {
  test("sets default query options", () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
  });
});
