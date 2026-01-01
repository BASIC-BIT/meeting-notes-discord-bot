import { CONFIG_KEYS } from "../config/keys";
import { MeetingData } from "../types/meeting-data";
import { MeetingHistory } from "../types/db";
import { fetchChannelContext } from "./channelContextService";
import { listRecentMeetingsForChannelService } from "./meetingHistoryService";
import { config } from "./configService";
import { resolveConfigSnapshot } from "./unifiedConfigService";

export interface MeetingContextData {
  meetingContext?: string; // From /startmeeting command
  channelContext?: string; // From database
  serverContext?: string; // From database
  recentMeetings?: MeetingHistory[]; // From database (if memory enabled)
}

/**
 * Build complete context data for a meeting
 * @param meeting The meeting data
 * @param includeMemory Whether to include recent meeting history
 * @returns Complete context data for the meeting
 */
export async function buildMeetingContext(
  meeting: MeetingData,
  includeMemory: boolean = false,
): Promise<MeetingContextData> {
  const contextData: MeetingContextData = {};

  // Include meeting-specific context if provided
  if (meeting.meetingContext) {
    contextData.meetingContext = meeting.meetingContext;
  }

  try {
    const serverSnapshot = await resolveConfigSnapshot({
      guildId: meeting.guildId,
    });
    const serverContextValue =
      serverSnapshot.values[CONFIG_KEYS.context.instructions]?.value;
    if (typeof serverContextValue === "string" && serverContextValue.trim()) {
      contextData.serverContext = serverContextValue;
    }

    // Fetch channel context
    const channelContext = await fetchChannelContext(
      meeting.guildId,
      meeting.voiceChannel.id,
    );
    if (channelContext?.context) {
      contextData.channelContext = channelContext.context;
    }

    // Fetch recent meetings if memory is enabled
    if (includeMemory) {
      const memoryDepth = config.context.memoryDepth;
      const recentMeetings = await listRecentMeetingsForChannelService(
        meeting.guildId,
        meeting.voiceChannel.id,
        memoryDepth,
      );

      if (recentMeetings.length > 0) {
        contextData.recentMeetings = recentMeetings;
      }
    }
  } catch (error) {
    console.error("Error building meeting context:", error);
    // Continue with partial context if database fetch fails
  }

  return contextData;
}

/**
 * Format context data for inclusion in AI prompts
 * @param context The context data to format
 * @param promptType The type of prompt being generated
 * @returns Formatted context string for the prompt
 */
export function formatContextForPrompt(
  context: MeetingContextData,
  promptType: "transcription" | "notes" | "image",
): string {
  let formattedContext = "";
  const maxContextLength = config.context.maxContextLength;

  // Add server context
  if (context.serverContext) {
    formattedContext += `\n**Server Context:** ${context.serverContext}\n`;
  }

  // Add channel context
  if (context.channelContext) {
    formattedContext += `\n**Channel Context:** ${context.channelContext}\n`;
  }

  // Add meeting-specific context
  if (context.meetingContext) {
    formattedContext += `\n**Meeting Context:** ${context.meetingContext}\n`;
  }

  // Add recent meeting notes for relevant prompt types
  if (
    context.recentMeetings &&
    context.recentMeetings.length > 0 &&
    promptType === "notes"
  ) {
    formattedContext += "\n**Previous Meetings in This Channel:**\n";
    formattedContext +=
      "*These previous meetings provide context for understanding references and continuity.*\n";

    // Calculate available space for meeting history
    const remainingSpace = maxContextLength - formattedContext.length - 500; // Reserve 500 chars
    const spacePerMeeting = Math.floor(
      remainingSpace / context.recentMeetings.length,
    );

    for (const meeting of context.recentMeetings) {
      const meetingDate = new Date(meeting.timestamp).toLocaleDateString();
      let meetingInfo = `\n- Meeting on ${meetingDate}`;

      if (meeting.context) {
        meetingInfo += ` (Context: ${meeting.context})`;
      }

      if (meeting.notes) {
        // Use available space intelligently
        const availableSpace = spacePerMeeting - meetingInfo.length - 10;
        const truncatedNotes =
          meeting.notes.length > availableSpace
            ? meeting.notes.substring(0, availableSpace) + "..."
            : meeting.notes;
        meetingInfo += `:\n  ${truncatedNotes}`;
      }

      formattedContext += meetingInfo;
    }
  }

  // Truncate if context is too long
  if (formattedContext.length > maxContextLength) {
    formattedContext =
      formattedContext.substring(0, maxContextLength - 3) + "...";
  }

  return formattedContext;
}

/**
 * Check if memory features are enabled
 * @returns Whether memory features should be used
 */
export function isMemoryEnabled(): boolean {
  return config.context.enableMemory;
}
