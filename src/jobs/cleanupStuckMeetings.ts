import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import { scanMeetingsByStatus, updateMeetingStatusIfStuck } from "../db";
import { buildMeetingCleanupNotifier } from "../services/meetingCleanupNotifier";
import { MEETING_END_REASONS, MEETING_STATUS } from "../types/meetingLifecycle";
import type { MeetingHistory } from "../types/db";

const DEFAULT_IN_PROGRESS_CUTOFF_HOURS = 4;
const DEFAULT_PROCESSING_CUTOFF_HOURS = 24;
const METRIC_NAMESPACE = "Chronote";
const METRIC_NAME = "meeting_cleanup_total";

const parseCutoffHours = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const toCutoffIso = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const isTimestampBeforeCutoff = (timestamp: string, cutoffIso: string) => {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return false;
  return value <= Date.parse(cutoffIso);
};

type CleanupTarget = {
  cutoffIso: string;
  cutoffField: "timestamp" | "updatedAt";
};

const resolveCleanupTarget = (
  meeting: MeetingHistory,
  inProgressCutoff: string,
  processingCutoff: string,
): CleanupTarget | null => {
  if (meeting.status === MEETING_STATUS.IN_PROGRESS) {
    return isTimestampBeforeCutoff(meeting.timestamp, inProgressCutoff)
      ? { cutoffIso: inProgressCutoff, cutoffField: "timestamp" }
      : null;
  }
  if (meeting.status === MEETING_STATUS.PROCESSING) {
    const timestamp = meeting.updatedAt ?? meeting.timestamp;
    return isTimestampBeforeCutoff(timestamp, processingCutoff)
      ? {
          cutoffIso: processingCutoff,
          cutoffField: meeting.updatedAt ? "updatedAt" : "timestamp",
        }
      : null;
  }
  return null;
};

const emitCleanupMetric = async (client: CloudWatchClient) => {
  await client.send(
    new PutMetricDataCommand({
      Namespace: METRIC_NAMESPACE,
      MetricData: [
        {
          MetricName: METRIC_NAME,
          Unit: "Count",
          Value: 1,
          Dimensions: [{ Name: "status", Value: MEETING_STATUS.FAILED }],
        },
      ],
    }),
  );
};

export const handler = async (): Promise<void> => {
  const inProgressHours = parseCutoffHours(
    process.env.MEETING_CLEANUP_IN_PROGRESS_HOURS,
    DEFAULT_IN_PROGRESS_CUTOFF_HOURS,
  );
  const processingHours = parseCutoffHours(
    process.env.MEETING_CLEANUP_PROCESSING_HOURS,
    DEFAULT_PROCESSING_CUTOFF_HOURS,
  );

  const inProgressCutoff = toCutoffIso(inProgressHours);
  const processingCutoff = toCutoffIso(processingHours);
  const notifier = buildMeetingCleanupNotifier();
  const cloudwatch = new CloudWatchClient({
    region: process.env.AWS_REGION ?? "us-east-1",
  });

  const meetings = await scanMeetingsByStatus([
    MEETING_STATUS.IN_PROGRESS,
    MEETING_STATUS.PROCESSING,
  ]);

  let updatedCount = 0;
  let notifiedCount = 0;
  let metricCount = 0;

  for (const meeting of meetings) {
    const target = resolveCleanupTarget(
      meeting,
      inProgressCutoff,
      processingCutoff,
    );
    if (!target || !meeting.status) continue;

    const updated = await updateMeetingStatusIfStuck({
      guildId: meeting.guildId,
      channelId_timestamp: meeting.channelId_timestamp,
      currentStatus: meeting.status,
      nextStatus: MEETING_STATUS.FAILED,
      cutoffIso: target.cutoffIso,
      cutoffField: target.cutoffField,
      endReason: MEETING_END_REASONS.CLEANUP,
    });

    if (!updated) continue;
    updatedCount += 1;

    try {
      await notifier.notifyCleanup(meeting, MEETING_END_REASONS.CLEANUP);
      notifiedCount += 1;
    } catch (error) {
      console.error("Cleanup notification failed:", error);
    }

    try {
      await emitCleanupMetric(cloudwatch);
      metricCount += 1;
    } catch (error) {
      console.error("Cleanup metric emission failed:", error);
    }
  }

  console.log(
    `Cleanup job complete. scanned=${meetings.length} updated=${updatedCount} notified=${notifiedCount} metrics=${metricCount}`,
  );
};
