import { Alert } from "@mantine/core";
import type { RecordingLimitContext } from "../../utils/purchaseAnalytics";

export default function RecordingPlanContext({
  context,
}: {
  context?: RecordingLimitContext;
}) {
  if (!context) return null;
  return (
    <Alert color="blue" title="Recording time">
      {context.limitType === "weekly_recording"
        ? "Compare weekly recording time for this server."
        : "Compare the maximum length of a meeting for this server. All plans have a two-hour maximum per meeting."}
    </Alert>
  );
}
