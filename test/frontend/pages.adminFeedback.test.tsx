import React from "react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { waitFor } from "@testing-library/react";
import { renderWithMantine, resetFrontendMocks } from "./testUtils";
import { authState } from "./testUtils";
import { setAdminFeedbackQuery } from "./mocks/trpc";
import AdminFeedback from "../../src/frontend/pages/AdminFeedback";

describe("AdminFeedback page", () => {
  beforeEach(() => {
    resetFrontendMocks();
  });

  test("blocks non-super admins", () => {
    authState.state = "authenticated";
    authState.user = { id: "user-1", isSuperAdmin: false };
    renderWithMantine(<AdminFeedback />);
    expect(
      document.body.textContent?.includes("Super admin access is required"),
    ).toBe(true);
  });

  test("renders feedback entries for super admins", async () => {
    authState.state = "authenticated";
    authState.user = { id: "user-1", isSuperAdmin: true };
    setAdminFeedbackQuery({
      data: {
        items: [
          {
            pk: "TARGET#meeting_summary#voice-1#2025-01-01T00:00:00.000Z",
            sk: "USER#user-1",
            type: "feedback",
            targetType: "meeting_summary",
            targetId: "voice-1#2025-01-01T00:00:00.000Z",
            guildId: "guild-1",
            rating: "down",
            source: "web",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
            userId: "user-1",
            comment: "Needs more detail.",
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
    });

    renderWithMantine(<AdminFeedback />);

    await waitFor(() => {
      expect(document.body.textContent?.includes("Needs more detail")).toBe(
        true,
      );
    });
    expect(document.body.textContent?.includes("Meeting summary")).toBe(true);
  });
});
