import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    CommandInteraction,
    EmbedBuilder,
    GuildMember, PermissionsBitField,
    TextChannel
} from "discord.js";
import {addMeeting, hasMeeting} from "../meetings";
import {joinVoiceChannel, VoiceConnectionStatus} from "@discordjs/voice";
import {MeetingData} from "../types/meeting-data";
import { openOutputFile, subscribeToUserVoice } from "../audio";
import { GuildChannel } from "discord.js/typings";
import { handleEndMeetingOther } from "./endMeeting";
import { MAXIMUM_MEETING_DURATION, MAXIMUM_MEETING_DURATION_PRETTY } from "../constants";

export async function handleStartMeeting(interaction: CommandInteraction) {
    const guildId = interaction.guildId!;
    const channelId = interaction.channelId;

    const channel = interaction.channel;

    if (!channel || !interaction.guild) {
        await interaction.reply('Unable to find the channel or guild.');
        return;
    }

    if(channel.isDMBased()) {
        await interaction.reply('Bot cannot be used within DMs.');
        return;
    }

    const guildChannel = channel as GuildChannel;

    // Check if the bot has permission to send messages in the channel
    const botMember = interaction.guild.members.cache.get(interaction.client.user!.id);

    if (!botMember) {
        await interaction.reply('Bot not found in guild.');
        return;
    }

    const permissions = guildChannel.permissionsFor(botMember);

    if (!permissions || !permissions.has(PermissionsBitField.Flags.SendMessages) || !permissions.has(PermissionsBitField.Flags.ViewChannel)) {
        await interaction.reply('I do not have permission to send messages in this channel.');
        return;
    }

    if (hasMeeting(guildId)) {
        await interaction.reply('A meeting is already active in this server.');
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

    const receiver = connection.receiver;

    const attendance: Set<string> = new Set<string>();

    const meeting: MeetingData = {
        chatLog: [],
        attendance,
        connection,
        textChannel,
        audioData: {
            audioFiles: [],
            currentSnippet: null,
        },
        voiceChannel,
        guildId,
        channelId,
        startTime: new Date(),
    };

    openOutputFile(meeting);

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

    await setupChatCollector(meeting);

    addMeeting(meeting);

    // Set a timer to automatically end the meeting after the specified duration
    meeting.timeoutTimer = setTimeout(() => {
        meeting.textChannel.send(`Ending meeting due to maximum meeting time of ${MAXIMUM_MEETING_DURATION_PRETTY} having been reached.`);
        handleEndMeetingOther(interaction.client, meeting);
    }, MAXIMUM_MEETING_DURATION);

    const embed = new EmbedBuilder()
        .setTitle('Meeting Started')
        .setDescription(`The meeting has started in **${voiceChannel.name}**.`)
        .addFields(
            { name: 'Start Time', value: `<t:${Math.floor(meeting.startTime.getTime() / 1000)}:F>` },
        )
        .setColor(0x00AE86)
        .setTimestamp();

    const endButton = new ButtonBuilder()
        .setCustomId('end_meeting')
        .setLabel('End Meeting')
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(endButton);

    await interaction.reply({ embeds: [embed], components: [row] });
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
    const collector = meeting.voiceChannel.createMessageCollector();
    collector.on('collect', message => {
        if (message.author.bot) return;

        meeting.chatLog.push(`[${message.author.tag} @ ${new Date(message.createdTimestamp).toLocaleString()}]: ${message.content}`);
        meeting.attendance.add(message.author.tag);
    });
}