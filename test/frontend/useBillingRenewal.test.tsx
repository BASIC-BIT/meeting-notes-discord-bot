import { RENEWAL_QUOTE_TTL_MS } from "../../src/utils/renewalConstants";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, jest } from "@jest/globals";
import { resetFrontendMocks } from "./testUtils";
import { billingRenewalQuery, billingRenewalMutation } from "./mocks/trpc";
import { useBillingRenewal } from "../../src/frontend/hooks/useBillingRenewal";
import { renewalQuote } from "../fixtures/renewal";

beforeEach(() => {
  resetFrontendMocks();
  billingRenewalQuery.data = {
    state: {
      kind: "off",
      tier: "basic",
      endsAt: renewalQuote.terms.renewsAt,
      action: {
        kind: "ready",
        quoteToken: "signed-consent",
        expiresAt: Date.now() + RENEWAL_QUOTE_TTL_MS,
        terms: renewalQuote.terms,
      },
    },
    canManageBilling: true,
    lifecycleAnalyticsEnabled: false,
  };
  billingRenewalQuery.refetch.mockRejectedValue(Error("read unavailable"));
});

it.each(["processing", "needs_review"] as const)(
  "retains the returned %s operation when the following read fails",
  async (kind) => {
    billingRenewalMutation.mutateAsync.mockResolvedValue({
      kind,
      operationId: "existing-operation",
    });
    const onBillingChanged = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ serverId }) =>
        useBillingRenewal({ serverId, active: true, onBillingChanged }),
      { initialProps: { serverId: "g1" } },
    );
    await act(async () => {
      await result.current.onConfirm("signed-consent");
    });
    expect(result.current.view?.state).toMatchObject({
      kind,
      operationId: "existing-operation",
    });
    await act(async () => {
      await result.current.onCheckStatus("existing-operation");
    });
    expect(billingRenewalMutation.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        serverId: "g1",
        request: { kind: "recover", operationId: "existing-operation" },
      }),
    );
    rerender({ serverId: "g2" });
    expect(result.current.view?.state.kind).toBe("off");
    rerender({ serverId: "g1" });
    expect(result.current.view?.state.kind).toBe(kind);
    billingRenewalQuery.refetch.mockImplementation(async () => {
      billingRenewalQuery.data = {
        state: { kind: "on", terms: renewalQuote.terms },
        canManageBilling: true,
        lifecycleAnalyticsEnabled: false,
      };
    });
    await act(async () => {
      await result.current.onRetry();
    });
    expect(result.current.view?.state.kind).toBe("on");
  },
);
