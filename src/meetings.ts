import {MeetingData} from "./types/meeting-data";


const meetings = new Map<string, MeetingData>();


// Since the bot can't be in multiple channels at once, we can just track a single meeting per guild, that's good enough.
// This actually solves a separate issue of having to track meeting by both voice channel and text channel

export function getMeeting(guildId: string) {
    return meetings.get(guildId);
}

export function hasMeeting(guildId: string) {
    return meetings.has(guildId);
}

export function addMeeting(meeting: MeetingData) {
    meetings.set(meeting.guildId, meeting);
}

export function deleteMeeting(guildId: string) {
    meetings.delete(guildId);
}