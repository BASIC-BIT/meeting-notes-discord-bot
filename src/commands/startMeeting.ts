import {CommandInteraction, GuildMember, TextChannel} from "discord.js";
import {addMeeting, hasMeeting} from "../meetings";
import {joinVoiceChannel, VoiceConnectionStatus} from "@discordjs/voice";
import {AudioSnippet} from "../types/audio";
import {MeetingData} from "../types/meeting-data";
import {subscribeToUserVoice} from "../audio";

export async function handleStartMeeting(interaction: CommandInteraction) {
    const guildId = interaction.guildId!;
    const channelId = interaction.channelId;

    if (hasMeeting(guildId, channelId)) {
        await interaction.reply('A meeting is already active in this channel.');
        return;
    }

    const untypedMember = interaction.member;
    if (!untypedMember || !interaction.guild) return;
    const member = untypedMember as GuildMember;

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
        await interaction.reply('You need to join a voice channel first!');
        return;
    }

    const textChannel = interaction.channel as TextChannel;

    // TODO: Set voice channel status to RECORDING

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true,
    });

    const audioFilePath = `./recordings/meeting-${guildId}-${channelId}-${Date.now()}.wav`;

    const receiver = connection.receiver;

    const audioData: Map<string, AudioSnippet[]> = new Map<string, AudioSnippet[]>();

    const attendance: Set<string> = new Set<string>();

    const meeting: MeetingData = {
        active: true,
        chatLog: [],
        attendance,
        audioFilePath,
        connection,
        textChannel,
        audioData,
        guildId,
        channelId,
        voiceChannel,
    };

    connection.on(VoiceConnectionStatus.Ready, () => {
        console.log('The bot has connected to the voice channel!');
        interaction.reply('Meeting started, the bot has joined the voice channel.');
    });

    connection.on(VoiceConnectionStatus.Connecting, () => {
        console.log('Bot is connecting');
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
        console.log('The bot has been disconnected from the voice channel.');
    });

    connection.on('error', (error) => {
        console.error('Voice connection error:', error);
        interaction.reply('There was an error trying to join the voice channel.');
    });

    recordInitialAttendance(meeting);

    receiver.speaking.on('start', async userId => {
        await subscribeToUserVoice(meeting, userId);
    });

    // Cleanup when user stops speaking
    receiver.speaking.on('end', async userId => {
        await onUserEndTalking(meeting, userId);
    });


    await textChannel.send('The bot is now listening to the voice channel and monitoring this chat.');

    await setupChatCollector(meeting);

    addMeeting(meeting);
}

function recordInitialAttendance(meeting: MeetingData) {
    meeting.voiceChannel.members.forEach((member) =>
        meeting.attendance.add(member.user.tag));
}

async function onUserEndTalking(meeting: MeetingData, userId: string) {
    const opusStream = meeting.connection.receiver.subscriptions.get(userId);
    if (opusStream) {
        opusStream.destroy();
    }
}

async function setupChatCollector(meeting: MeetingData) {
    // Save chat messages
    const collector = meeting.textChannel.createMessageCollector();
    collector.on('collect', message => {
        if (message.author.bot) return;

        meeting.chatLog.push(`[${message.author.tag}]: ${message.content} (${new Date(message.createdTimestamp).toLocaleString()})`);
        meeting.attendance.add(message.author.tag);
    });
}