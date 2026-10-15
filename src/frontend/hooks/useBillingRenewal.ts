import { useRef, useState } from "react";
import { useRenewalAnalytics } from "./useRenewalAnalytics";
import { notifications } from "@mantine/notifications";
import { trpc } from "../services/trpc";
import { isDoNotTrackEnabled } from "../services/analytics";
import type {
  RenewalRequest,
  RenewalResult,
  RenewalState,
  RenewalView,
} from "../../types/renewal";
function pendingView(
  result: RenewalResult,
  previous: RenewalView | undefined,
): RenewalView | undefined {
  if (
    !previous ||
    (result.kind !== "processing" && result.kind !== "needs_review")
  )
    return undefined;
  const state = previous.state;
  const endsAt =
    state.kind === "off" || state.kind === "processing"
      ? state.endsAt
      : state.kind === "needs_review"
        ? state.knownEndsAt
        : null;
  const pending: RenewalState =
    result.kind === "processing" && endsAt
      ? { kind: "processing", operationId: result.operationId, endsAt }
      : {
          kind: "needs_review",
          operationId: result.operationId,
          knownEndsAt: endsAt,
        };
  return { ...previous, state: pending };
}

export function useBillingRenewal({
  serverId,
  active,
  onBillingChanged,
}: {
  serverId: string | null;
  active: boolean;
  onBillingChanged: () => Promise<unknown>;
}) {
  const query = trpc.billing.renewal.useQuery(
    { serverId: serverId ?? "" },
    { enabled: active && Boolean(serverId), retry: false },
  );
  const readVersion = useRef(query.dataUpdatedAt);
  readVersion.current = query.dataUpdatedAt;
  const [pending, setPending] = useState<{
    serverId: string;
    version: number;
    view: RenewalView;
  } | null>(null);
  const view =
    pending?.serverId === serverId && pending.version === query.dataUpdatedAt
      ? pending.view
      : query.data;
  const captureClick = useRenewalAnalytics({
    view,
    serverId,
    active,
  });
  const mutation = trpc.billing.reactivateRenewal.useMutation();
  const refresh = async () => {
    const read = query.refetch({ throwOnError: true }).then(() => {
      setPending((current) =>
        current?.serverId === serverId ? null : current,
      );
    });
    await Promise.allSettled([read, onBillingChanged()]);
  };
  const run = async (request: RenewalRequest) => {
    if (!serverId || !active || mutation.isPending) return;
    try {
      const result = await mutation.mutateAsync({
        serverId,
        request,
        analyticsOptOut: isDoNotTrackEnabled(),
      });
      const retained = pendingView(result, view);
      setPending(
        retained
          ? { serverId, version: readVersion.current, view: retained }
          : null,
      );
      if (result.kind === "confirmed")
        notifications.show({
          color: "green",
          title: "Renewal is back on",
          message: "Your subscription will continue at the confirmed terms.",
        });
      if (result.kind === "changed")
        notifications.show({
          color: "gray",
          title: "Review renewal details",
          message: "The details changed. Review them before confirming again.",
        });
    } catch {
      notifications.show({
        color: "gray",
        title: "Check renewal status",
        message:
          "We couldn't confirm the result. Check its status before trying again.",
      });
    } finally {
      await refresh();
    }
  };
  const onConfirm = async (quoteToken: string) => {
    const state = view?.state;
    if (
      state?.kind !== "off" ||
      state.action.kind !== "ready" ||
      state.action.quoteToken !== quoteToken
    )
      return;
    if (state.action.expiresAt <= Date.now()) {
      await refresh();
      notifications.show({
        color: "gray",
        title: "Review renewal details",
        message:
          "Renewal details were refreshed. Review them before confirming again.",
      });
      return;
    }
    captureClick();
    await run({ kind: "confirm", quoteToken });
  };
  const onCheckStatus = async (operationId: string) => {
    const state = view?.state;
    if (
      (state?.kind !== "processing" && state?.kind !== "needs_review") ||
      state.operationId !== operationId
    )
      return;
    await run({ kind: "recover", operationId });
  };
  return {
    view,
    busy: mutation.isPending || query.isFetching,
    onConfirm,
    onCheckStatus,
    onRetry: refresh,
  };
}
