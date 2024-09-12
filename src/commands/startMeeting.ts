import {
    ActionRowBuilder,
    ButtonBuilder, ButtonInteraction,
    ButtonStyle,
    CommandInteraction,
    EmbedBuilder,
    GuildMember, PermissionsBitField,
    TextChannel
} from "discord.js";
import {addMeeting, deleteMeeting, getMeeting, hasMeeting} from "../meetings";
import { joinVoiceChannel } from "@discordjs/voice";
import { MeetingData } from "../types/meeting-data";
import { openOutputFile, subscribeToUserVoice, updateSnippetsIfNecessary, userStopTalking } from "../audio";
import { GuildChannel } from "discord.js/typings";
import { handleEndMeetingOther } from "./endMeeting";
import { MAXIMUM_MEETING_DURATION, MAXIMUM_MEETING_DURATION_PRETTY } from "../constants";
import { AudioSnippet } from "../types/audio";

export async function handleRequestStartMeeting(interaction: CommandInteraction) {
    const guildId = interaction.guildId!;

    const channel = interaction.channel;

    if (!channel || !interaction.guild) {
        await interaction.reply('Unable to find the channel or guild.');
        return;
    }

    if (channel.isDMBased()) {
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

    const chatChannelPermissions = guildChannel.permissionsFor(botMember);

    if (!chatChannelPermissions || !chatChannelPermissions.has(PermissionsBitField.Flags.SendMessages) || !chatChannelPermissions.has(PermissionsBitField.Flags.ViewChannel)) {
        await interaction.reply('I do not have permission to send messages in this channel.');
        return;
    }

    if (hasMeeting(guildId)) {
        const meeting = getMeeting(guildId)!;
        if(meeting.finished) {
            // Cleanup the old meeting in preparation for a new one
            // TODO: Eventually, store meetings in a database and get rid of this, no need to remove data unnecessarily
            deleteMeeting(guildId);
        } else {
            await interaction.reply('A meeting is already active in this server.');
            return;
        }
    }

    const untypedMember = interaction.member;
    if (!untypedMember || !interaction.guild) return;
    const member = untypedMember as GuildMember;

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
        await interaction.reply('You need to join a voice channel first!');
        return;
    }

    const voiceChannelPermissions = voiceChannel.permissionsFor(botMember);

    if (!voiceChannelPermissions || !voiceChannelPermissions.has(PermissionsBitField.Flags.ViewChannel) || !voiceChannelPermissions.has(PermissionsBitField.Flags.Connect)) {
        await interaction.reply('I do not have permission to join your voice channel.');
        return;
    }

    const withTranscription = new ButtonBuilder()
        .setCustomId('with_transcription')
        .setLabel('With Transcription')
        .setStyle(ButtonStyle.Primary);

    const withoutTranscription = new ButtonBuilder()
        .setCustomId('without_transcription')
        .setLabel('NO Transcription')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(withTranscription, withoutTranscription);

    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle("Meeting Setup")
                .setColor('#3498db')
                .setDescription("Would you like a transcription of your meeting? Please be aware that the transcription service I use is *not* free~ please consider [donating here](https://ko-fi.com/basicbit) if you use this feature regularly!")
        ],
        components: [
            row
        ]
    });
}

export async function handleStartMeeting(interaction: ButtonInteraction, transcribe: boolean) {
    // TODO: Enable this code, using the meeting setup store to get the initial interaction to edit it.
    // try {
    //     await interaction.message.editReply({
    //         components: [],
    //     }); //Remove "End Meeting" button from initial reply if able
    // } catch (e) {
    //     console.log("Initial Interaction timed out, couldn't remove End Meeting button from initial reply, continuing...")
    // }

    const guildId = interaction.guildId!;
    const channelId = interaction.channelId;

    const channel = interaction.channel;

    if (!channel || !interaction.guild) {
        await interaction.reply('Unable to find the channel or guild.');
        return;
    }

    if (channel.isDMBased()) {
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

    const chatChannelPermissions = guildChannel.permissionsFor(botMember);

    if (!chatChannelPermissions || !chatChannelPermissions.has(PermissionsBitField.Flags.SendMessages) || !chatChannelPermissions.has(PermissionsBitField.Flags.ViewChannel)) {
        await interaction.reply('I do not have permission to send messages in this channel.');
        return;
    }

    if (hasMeeting(guildId)) {
        const meeting = getMeeting(guildId)!;
        if(meeting.finished) {
            // Cleanup the old meeting in preparation for a new one
            // TODO: Eventually, store meetings in a database and get rid of this, no need to remove data unnecessarily
            deleteMeeting(guildId);
        } else {
            await interaction.reply('A meeting is already active in this server.');
            return;
        }
    }

    const untypedMember = interaction.member;
    if (!untypedMember || !interaction.guild) return;
    const member = untypedMember as GuildMember;

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
        await interaction.reply('You need to join a voice channel first!');
        return;
    }

    const voiceChannelPermissions = voiceChannel.permissionsFor(botMember);

    if (!voiceChannelPermissions || !voiceChannelPermissions.has(PermissionsBitField.Flags.ViewChannel) || !voiceChannelPermissions.has(PermissionsBitField.Flags.Connect)) {
        await interaction.reply('I do not have permission to join your voice channel.');
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

    let setFinished: ((val?: any) => void) | undefined = undefined;
    const isFinished = new Promise<void>((resolve, reject) => {
        setFinished = resolve;
    });
    const meeting: MeetingData = {
        chatLog: [],
        attendance,
        connection,
        textChannel,
        audioData: {
            audioFiles: [],
            currentSnippets: new Map<string, AudioSnippet>(),
        },
        voiceChannel,
        guildId,
        channelId,
        startTime: new Date(),
        creator: interaction.user,
        isFinished,
        setFinished: () => setFinished && setFinished(),
        finishing: false,
        finished: false,
        guild: interaction.guild,
        initialInteraction: interaction,
        transcribeMeeting: transcribe,
    };

    openOutputFile(meeting);

    connection.on('error', (error) => {
        console.error('Voice connection error:', error);
        interaction.reply('There was an error trying to join the voice channel.');
    });

    recordInitialAttendance(meeting);
    await subscribeToInitialMembersVoice(meeting);

    receiver.speaking.on('start', userId => {
        updateSnippetsIfNecessary(meeting, userId);
    });

    // Cleanup when user stops speaking
    receiver.speaking.on('end',  userId => {
        // await onUserEndTalking(meeting, userId);
        userStopTalking(meeting, userId);
    });

    await setupChatCollector(meeting);

    addMeeting(meeting);

    // Set a timer to automatically end the meeting after the specified duration
    meeting.timeoutTimer = setTimeout(() => {
        meeting.initialInteraction.followUp(`Ending meeting due to maximum meeting time of ${MAXIMUM_MEETING_DURATION_PRETTY} having been reached.`);
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

async function subscribeToInitialMembersVoice(meeting: MeetingData) {
    await Promise.all(
        meeting.voiceChannel.members.map((member) =>
            subscribeToUserVoice(meeting, member.user.id)));
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