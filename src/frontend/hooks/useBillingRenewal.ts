import { useRenewalAnalytics } from "./useRenewalAnalytics";
import { notifications } from "@mantine/notifications";
import { trpc } from "../services/trpc";
import { isDoNotTrackEnabled } from "../services/analytics";
import type { RenewalRequest } from "../../types/renewal";
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
  const captureClick = useRenewalAnalytics({
    view: query.data,
    serverId,
    active,
  });
  const mutation = trpc.billing.reactivateRenewal.useMutation();
  const refresh = async () => {
    await Promise.allSettled([query.refetch(), onBillingChanged()]);
  };
  const run = async (request: RenewalRequest) => {
    if (!serverId || !active || mutation.isPending) return;
    try {
      const result = await mutation.mutateAsync({
        serverId,
        request,
        analyticsOptOut: isDoNotTrackEnabled(),
      });
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
    const state = query.data?.state;
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
    const state = query.data?.state;
    if (
      (state?.kind !== "processing" && state?.kind !== "needs_review") ||
      state.operationId !== operationId
    )
      return;
    await run({ kind: "recover", operationId });
  };
  return {
    view: query.data,
    busy: mutation.isPending || query.isFetching,
    onConfirm,
    onCheckStatus,
    onRetry: refresh,
  };
}
