import {MeetingData} from "./types/meeting-data";


const meetings = new Map<string, MeetingData>();

function getId(guildId: string, channelId: string) {
    return `${guildId}-${channelId}`;
}

export function getMeeting(guildId: string, channelId: string) {
    return meetings.get(getId(guildId, channelId));
}

export function hasMeeting(guildId: string, channelId: string) {
    const meeting = getMeeting(guildId, channelId);
    return meeting && meeting.active;
}

export function addMeeting(meeting: MeetingData) {
    meetings.set(getId(meeting.guildId, meeting.channelId), meeting);
}

export function deleteMeeting(guildId: string, channelId: string) {
    meetings.delete(getId(guildId, channelId));
}