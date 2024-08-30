import {
    Client,
    CommandInteraction,
    EmbedBuilder,
    GatewayIntentBits,
    GuildMember,
    Partials,
    REST,
    SlashCommandBuilder,
    TextChannel
} from 'discord.js';
import {Routes} from 'discord-api-types/v10';
import dotenv from 'dotenv';
import {
    EndBehaviorType,
    joinVoiceChannel,
    VoiceConnection,
    VoiceConnectionStatus
} from '@discordjs/voice';
import prism, {opus} from 'prism-media';
import {writeFileSync, readFileSync, createReadStream} from "node:fs";
import ffmpeg, {FfmpegCommand} from 'fluent-ffmpeg';
import Decoder = opus.Decoder;
import OpenAI from "openai";
import {PassThrough} from "node:stream";

dotenv.config();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    throw new Error("Bot token or client ID is not defined in the environment variables");
}

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

const openAIClient = new OpenAI({
    apiKey: process.env['OPENAI_API_KEY'],
});

interface MeetingData {
    active: boolean;
    chatLog: string[];
    attendance: Set<string>;
    audioFilePath: string;
    pcmStream: Decoder;
    ffmpeg: FfmpegCommand
    connection: VoiceConnection;
    combinedOpusStream: PassThrough;
    textChannel: TextChannel | null;
    guildId: string;
    channelId: string;
}

const meetings = new Map<string, MeetingData>();

const commands = [
    new SlashCommandBuilder()
        .setName('startmeeting')
        .setDescription('Starts the meeting and begins recording attendance and chat logs.'),
    new SlashCommandBuilder()
        .setName('endmeeting')
        .setDescription('Ends the meeting and compiles the notes.'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
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
})();

client.once('ready', () => {
    console.log(`Logged in as ${client.user?.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const commandInteraction = interaction as CommandInteraction;

    const { commandName } = interaction;

    if (commandName === 'startmeeting') {
        await handleStartMeeting(commandInteraction);
    } else if (commandName === 'endmeeting') {
        await handleEndMeeting(commandInteraction);
    }
});

async function handleStartMeeting(interaction: CommandInteraction) {
    const guildId = interaction.guildId!;
    const channelId = interaction.channelId;

    if (meetings.has(`${guildId}-${channelId}`) && meetings.get(`${guildId}-${channelId}`)!.active) {
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

    // TODO: Set voice channel status to RECORDING

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true,
    });

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

    const audioFilePath = `./recordings/meeting-${guildId}-${channelId}-${Date.now()}.wav`;

    const receiver = connection.receiver;

    const combinedOpusStream = new PassThrough();

    const attendance = new Set();

    voiceChannel.members.forEach((member) => {
        if (member.id === client.user?.id) return; // Skip the bot itself

        const opusStream = receiver.subscribe(member.id, {
            end: {
                behavior: EndBehaviorType.Manual,
            },
        });

        // @ts-ignore
        opusStream.pipe(combinedOpusStream, { end: false });

        attendance.add(member.user.tag);
    });

    //@ts-ignore
    const pcmStream = combinedOpusStream.pipe(new prism.opus.Decoder({ rate: 8000, channels: 2, frameSize: 960 }));


    const ffmpegProcess = ffmpeg()
        // @ts-ignore
        .input(pcmStream)
        .inputOptions(["-f", "s16le", "-ar", "8k", "-ac", "2"])
        .outputFormat('wav')
        .save(audioFilePath)
        .on('error', (err: Error) => {
            console.error('Error processing audio with ffmpeg:', err);
        })


    const textChannel = interaction.channel as TextChannel;

    await textChannel.send('The bot is now listening to the voice channel and monitoring this chat.');

    const collector = textChannel.createMessageCollector();

    collector.on('collect', message => {
        if (message.author.bot) return;
        const meeting = meetings.get(`${guildId}-${channelId}`);
        if (meeting) {
            meeting.chatLog.push(`[${message.author.tag}]: ${message.content} (${new Date(message.createdTimestamp).toLocaleString()})`);
            meeting.attendance.add(message.author.tag);
        }
    });

    meetings.set(`${guildId}-${channelId}`, {
        active: true,
        chatLog: [],
        attendance: new Set(),
        audioFilePath,
        ffmpeg: ffmpegProcess,
        connection,
        textChannel,
        combinedOpusStream,
        // @ts-ignore
        pcmStream,
        guildId,
        channelId,
    });
}
async function handleEndMeeting(interaction: CommandInteraction) {
    const guildId = interaction.guildId!;
    const channelId = interaction.channelId;

    const meeting = meetings.get(`${guildId}-${channelId}`);
    if (!meeting || !meeting.active) {
        await interaction.reply('No active meeting to end in this channel.');
        return;
    }

    if(meeting.pcmStream) {
        meeting.pcmStream.end();
    }

    meeting.ffmpeg.on('end', async () => {
        console.log('Recording finished and saved.');

        const chatLogFilePath = `./logs/chatlog-${guildId}-${channelId}-${Date.now()}.txt`;
        const attendanceList = Array.from(meeting.attendance).join('\n');
        writeFileSync(chatLogFilePath, meeting.chatLog.join('\n'));

        const transcriptionFilePath = `./logs/transcription-${guildId}-${channelId}-${Date.now()}.txt`;
        const transcription = await transcribe(meeting.audioFilePath);

        if(transcription !== null) {
            writeFileSync(transcriptionFilePath, transcription);
        }

        const embed = new EmbedBuilder()
            .setTitle('Meeting Summary')
            .setColor(0x00AE86)
            .setDescription('Here are the details of the recent meeting:')
            .addFields(
                { name: 'Members in Attendance', value: attendanceList || 'No members recorded.' },
            )
            .setTimestamp();

        const preconfiguredChannel = await client.channels.fetch(meeting.channelId) as TextChannel;
        if (preconfiguredChannel) {
            const files = [];
            if (doesFileHaveContent(chatLogFilePath)) {
                files.push({ attachment: chatLogFilePath, name: 'ChatLog.txt' });
            }
            if (doesFileHaveContent(meeting.audioFilePath)) {
                files.push({ attachment: meeting.audioFilePath, name: 'AudioRecording.wav' });
            }
            if (doesFileHaveContent(transcriptionFilePath)) {
                files.push({ attachment: transcriptionFilePath, name: 'Transcription.txt' })
            }
            await preconfiguredChannel.send({
                embeds: [embed],
                files,
            });
        }

        await interaction.reply('Meeting ended, the summary has been posted.');

        meetings.delete(`${guildId}-${channelId}`);
    });

    if (meeting.connection) {
        meeting.connection.disconnect();
        meeting.connection.destroy();
    }
}

function doesFileHaveContent(path: string): boolean {
    return readFileSync(path).length > 0;
}

client.login(TOKEN);


async function transcribe(file: string): Promise<string | null> {
    try {
        const transcription = await openAIClient.audio.transcriptions.create({
            file: createReadStream(file),
            model: "whisper-1",
            language: "en",
        })

        return transcription.text;
    } catch (e) {
        return null;
    }
}

client.on('voiceStateUpdate', (oldState, newState) => {
    const guildId = newState.guild.id;

    if(!oldState.channel && newState.channel && newState.member && newState.member.user && hasMeeting(guildId, newState.channel.id)) {
        const meeting = getMeeting(guildId, newState.channel.id)!;

        const member = newState.member;

        meeting.attendance.add(member.user.tag);
        const opusStream = meeting.connection.receiver.subscribe(member.id, {
            end: {
                behavior: EndBehaviorType.Manual,
            },
        });

        // @ts-ignore
        opusStream.pipe(combinedOpusStream, { end: false });
    }
});

function getMeeting(guildId: string, channelId: string) {
    const id = `${guildId}-${channelId}`;
    return meetings.get(id);
}

function hasMeeting(guildId: string, channelId: string) {
    const meeting = getMeeting(guildId, channelId);
    return meeting && meeting.active;
}