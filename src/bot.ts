import {CHANNELS, CLIENT_ID, FRAME_SIZE, SAMPLE_RATE_LOW, TOKEN} from "./constants";
import {
    Client,
    CommandInteraction,
    GatewayIntentBits,
    GuildMember,
    Partials,
    REST,
    SlashCommandBuilder, TextChannel
} from "discord.js";
import {Routes} from "discord-api-types/v10";
import {MeetingData} from "./types/meeting-data";
import {addMeeting, deleteMeeting, getMeeting, hasMeeting} from "./meetings";
import {EndBehaviorType, joinVoiceChannel, VoiceConnectionStatus} from "@discordjs/voice";
import {writeFileSync} from "node:fs";
import {combineAudioWithFFmpeg, mergeSnippetsAcrossUsers, synchronizeUserAudio} from "./audio";
import {transcribeSnippet} from "./transcription";
import {sendMeetingEndEmbed} from "./embed";
import prism from "prism-media";
import {PassThrough} from "node:stream";
import {AudioSnippet} from "./types/audio";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.User],
});

export async function setupBot() {
    if (!TOKEN || !CLIENT_ID) {
        throw new Error("Bot token or client ID is not defined in the environment variables");
    }

    client.once('ready', () => {
        console.log(`Logged in as ${client.user?.tag}!`);
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isCommand()) return;

        const commandInteraction = interaction as CommandInteraction;

        const { commandName } = interaction;

        if (commandName === 'startmeetingdev') {
            await handleStartMeeting(commandInteraction);
        } else if (commandName === 'endmeetingdev') {
            await handleEndMeeting(commandInteraction);
        }
    });

    client.on('voiceStateUpdate', (oldState, newState) => {
        const guildId = newState.guild.id;

        if(!oldState.channel && newState.channel && newState.member && newState.member.user && hasMeeting(guildId, newState.channel.id)) {
            const meeting = getMeeting(guildId, newState.channel.id)!;
            const member = newState.member;

            meeting.attendance.add(member.user.tag);

            meeting.connection.receiver.speaking.on('start', (userId) => {
                subscribeToUserVoice(meeting, userId);
            });
        }
    });

    setupApplicationCommands();

    client.login(TOKEN);
}

async function setupApplicationCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('startmeetingdev')
            .setDescription('Starts the meeting and begins recording attendance and chat logs.'),
        new SlashCommandBuilder()
            .setName('endmeetingdev')
            .setDescription('Ends the meeting and compiles the notes.'),
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
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

async function handleStartMeeting(interaction: CommandInteraction) {
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

async function handleEndMeeting(interaction: CommandInteraction) {
    try {
        const guildId = interaction.guildId!;
        const channelId = interaction.channelId;

        const meeting = getMeeting(guildId, channelId);
        if (!meeting || !meeting.active) {
            await interaction.reply('No active meeting to end in this channel.');
            return;
        }

        // Acknowledge the interaction immediately
        await interaction.deferReply();

        if (meeting.connection) {
            meeting.connection.disconnect();
            meeting.connection.destroy();
        }

        const chatLogFilePath = `./logs/chatlog-${guildId}-${channelId}-${Date.now()}.txt`;
        writeFileSync(chatLogFilePath, meeting.chatLog.join('\n'));

        const userBuffers: string[] = [];
        const transcriptionPromises: Promise<string>[] = [];

        const mergedSnippets = mergeSnippetsAcrossUsers(meeting.audioData);

        mergedSnippets.forEach(mergedSnippet => {
            const synchronizedBuffer = synchronizeUserAudio([mergedSnippet.snippet]);

            if (synchronizedBuffer.length > 0) {
                const fileName = `./temp_user_${mergedSnippet.userId}_${mergedSnippet.snippet.timestamp}.pcm`;
                writeFileSync(fileName, synchronizedBuffer);
                userBuffers.push(fileName);
            } else {
                console.warn(`Empty buffer detected for user ${mergedSnippet.userId} at timestamp ${mergedSnippet.snippet.timestamp}, skipping.`);
            }

            const userTag = client.users.cache.get(mergedSnippet.userId)?.tag ?? mergedSnippet.userId;

            transcriptionPromises.push(transcribeSnippet(mergedSnippet.snippet, mergedSnippet.userId, userTag));
        });

        if (userBuffers.length > 0) {
            await combineAudioWithFFmpeg(userBuffers, meeting.audioFilePath);
        } else {
            console.error('No valid audio files to combine.');
            throw new Error('No valid audio files to combine.');
        }

        const transcriptions = await Promise.all(transcriptionPromises);
        const transcriptionFilePath = `./logs/transcription-${guildId}-${channelId}-${Date.now()}.txt`;
        writeFileSync(transcriptionFilePath, transcriptions.join('\n'));

        await sendMeetingEndEmbed(meeting, chatLogFilePath, transcriptionFilePath);

        // Edit the initial deferred reply to include the final message
        await interaction.editReply('Meeting ended, the summary has been posted.');

        deleteMeeting(guildId, channelId);

    } catch (error) {
        console.error('Error during meeting end:', error);
    }
}


async function subscribeToUserVoice(meeting: MeetingData, userId: string) {
    const opusStream = meeting.connection.receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.Manual,
        },
    });

    // @ts-ignore
    const decodedStream = opusStream.pipe(new prism.opus.Decoder({ rate: SAMPLE_RATE_LOW, channels: CHANNELS, frameSize: FRAME_SIZE }));
    const passThrough = new PassThrough();
    // @ts-ignore
    decodedStream.pipe(passThrough);

    if (!meeting.audioData.has(userId)) {
        meeting.audioData.set(userId, []);
    }

    const snippet: AudioSnippet = {
        chunks: [],
        timestamp: Date.now(),
    };
    meeting.audioData.get(userId)!.push(snippet);

    passThrough.on('data', chunk => {
        snippet.chunks.push(chunk);
    });
}