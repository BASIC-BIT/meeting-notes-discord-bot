import fs from "node:fs";
import path from "node:path";
import { config } from "../services/configService";
import type { MeetingData } from "../types/meeting-data";

const CUE_DIR = path.resolve(process.cwd(), "audio");
const DENIAL_CUE_FILE = "live-command-confirmation-denial.wav";
const THINKING_CUE_FILE = "thinking.wav";
const THINKING_CUE_TRANSCRIPT = "Audio cue: Processing response.";
const DENIAL_CUE_TRANSCRIPT = "Audio cue: Denial confirmed.";

function resolveCuePath(fileName: string): string | null {
  const filePath = path.join(CUE_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    console.warn(`Sound cue file not found: ${filePath}`);
    return null;
  }
  return filePath;
}

function resolveThinkingIntervalMs(): number {
  const interval = config.liveVoice.thinkingCueIntervalMs;
  if (!Number.isFinite(interval) || interval <= 0) {
    return 500;
  }
  return Math.max(250, interval);
}

export function enqueueDenialCue(
  meeting: MeetingData,
  userId: string,
): boolean {
  if (!meeting.ttsQueue) {
    return false;
  }
  const filePath = resolveCuePath(DENIAL_CUE_FILE);
  if (!filePath) return false;

  return meeting.ttsQueue.enqueue({
    kind: "sfx",
    filePath,
    userId,
    label: "live_command_denial",
    transcriptText: DENIAL_CUE_TRANSCRIPT,
    audioSource: "bot",
    priority: "high",
  });
}

export function startThinkingCueLoop(
  meeting: MeetingData,
  userId: string,
): void {
  if (!config.liveVoice.thinkingCue) return;
  if (!meeting.ttsQueue) return;

  const filePath = resolveCuePath(THINKING_CUE_FILE);
  if (!filePath) return;

  const state = meeting.liveVoiceThinkingCueState ?? {
    activeCount: 0,
    loggedStart: false,
  };
  state.activeCount += 1;
  meeting.liveVoiceThinkingCueState = state;

  if (state.timer) return;

  const intervalMs = resolveThinkingIntervalMs();

  const tick = () => {
    if (state.activeCount <= 0) return;
    const shouldLog = !state.loggedStart;
    const played = meeting.ttsQueue?.playCueIfIdle({
      kind: "sfx",
      filePath,
      userId,
      label: "thinking",
      transcriptText: shouldLog ? THINKING_CUE_TRANSCRIPT : undefined,
      audioSource: "bot",
    });
    if (played && shouldLog) {
      state.loggedStart = true;
    }
  };

  tick();
  state.timer = setInterval(tick, intervalMs);
}

export function stopThinkingCueLoop(meeting: MeetingData): void {
  const state = meeting.liveVoiceThinkingCueState;
  if (!state) return;

  state.activeCount = Math.max(0, state.activeCount - 1);
  if (state.activeCount > 0) return;

  if (state.timer) {
    clearInterval(state.timer);
  }
  meeting.liveVoiceThinkingCueState = undefined;
}
