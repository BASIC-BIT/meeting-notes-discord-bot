import { beforeEach, describe, expect, test } from "@jest/globals";
import { usePortalStore } from "../../src/frontend/stores/portalStore";

describe("portalStore", () => {
  beforeEach(() => {
    localStorage.clear();
    usePortalStore.setState({ lastServerId: null });
  });

  test("setLastServerId updates state and persists", () => {
    usePortalStore.getState().setLastServerId("g1");
    expect(usePortalStore.getState().lastServerId).toBe("g1");
    const stored = localStorage.getItem("chronote-portal");
    expect(stored).toBeTruthy();
    if (!stored) {
      throw new Error("Missing persisted portal store");
    }
    const parsed = JSON.parse(stored);
    expect(parsed.state?.lastServerId).toBe("g1");
  });

  test("setLastServerId clears when set to null", () => {
    usePortalStore.getState().setLastServerId("g1");
    usePortalStore.getState().setLastServerId(null);
    expect(usePortalStore.getState().lastServerId).toBeNull();
    const stored = localStorage.getItem("chronote-portal");
    expect(stored).toBeTruthy();
    if (!stored) {
      throw new Error("Missing persisted portal store");
    }
    const parsed = JSON.parse(stored);
    expect(parsed.state?.lastServerId).toBeNull();
  });
});
