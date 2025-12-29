import "./mocks/trpc";
import React from "react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { AuthProvider, useAuth } from "../../src/frontend/contexts/AuthContext";
import { authQuery, resetTrpcMocks, setAuthQuery } from "./mocks/trpc";

type AuthSnapshot = {
  state: string;
  loading: boolean;
  loginUrl: string;
  refresh: () => Promise<void>;
};

function AuthProbe({
  onCapture,
}: {
  onCapture: (value: AuthSnapshot) => void;
}) {
  const value = useAuth();
  onCapture(value);
  return (
    <div
      data-testid="auth-state"
      data-state={value.state}
      data-loading={value.loading ? "true" : "false"}
      data-login={value.loginUrl}
    />
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    resetTrpcMocks();
  });

  test("reports unauthenticated state and builds login url", async () => {
    setAuthQuery({ data: null, isLoading: false });
    let captured: AuthSnapshot | null = null;
    render(
      <AuthProvider>
        <AuthProbe
          onCapture={(value) => {
            captured = value;
          }}
        />
      </AuthProvider>,
    );
    const node = screen.getByTestId("auth-state");
    expect(node).toHaveAttribute("data-state", "unauthenticated");
    expect(node).toHaveAttribute("data-loading", "false");
    const loginUrl = node.getAttribute("data-login");
    expect(loginUrl).toContain("/auth/discord");
    expect(loginUrl).toContain("redirect=");
    if (!captured) {
      throw new Error("Missing auth snapshot");
    }
    await act(async () => {
      await captured.refresh();
    });
    expect(authQuery.refetch).toHaveBeenCalledTimes(1);
  });

  test("reports authenticated when data is present", () => {
    setAuthQuery({ data: { id: "user-1" }, isLoading: false });
    render(
      <AuthProvider>
        <AuthProbe onCapture={() => {}} />
      </AuthProvider>,
    );
    expect(screen.getByTestId("auth-state")).toHaveAttribute(
      "data-state",
      "authenticated",
    );
  });
});
