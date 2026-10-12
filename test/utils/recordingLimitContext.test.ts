import {
  resolveRecordingLimitContext,
  recordingLimitAnalytics,
} from "../../src/utils/purchaseAnalytics";

test.each([
  "manual_start",
  "auto_start",
  "weekly_after_meeting",
  "weekly_warning",
  "mcp_start",
])("accepts weekly recording context at %s", (limitSurface) => {
  expect(
    resolveRecordingLimitContext({
      limitType: "weekly_recording",
      limitSurface,
    }),
  ).toEqual({ limitType: "weekly_recording", limitSurface });
});
test("accepts the session duration boundary", () => {
  expect(
    recordingLimitAnalytics({
      limitType: "meeting_duration",
      limitSurface: "duration_stop",
    }),
  ).toEqual({ limit_type: "meeting_duration", limit_surface: "duration_stop" });
});
test.each([
  {},
  { limitType: "weekly_recording" },
  { limitSurface: "manual_start" },
  { limitType: "meeting_duration", limitSurface: "manual_start" },
  { limitType: "weekly_recording", limitSurface: "duration_stop" },
  { limitType: "private content", limitSurface: "manual_start" },
  { limitType: "weekly_recording", limitSurface: "untrusted" },
])("drops invalid or partial context %j", (input) => {
  expect(resolveRecordingLimitContext(input)).toBeUndefined();
  expect(recordingLimitAnalytics(input)).toEqual({});
});
