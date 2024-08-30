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
import prism from 'prism-media';
import {createReadStream, readFileSync, statSync, unlinkSync, writeFileSync} from "node:fs";
import OpenAI from "openai";
import {PassThrough} from "node:stream";
import {exec} from "node:child_process";
import ffmpeg from 'fluent-ffmpeg';

dotenv.config();

const SAMPLE_RATE = 8000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const FRAME_SIZE = 960;

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

// Array of chunks of PCM data
interface AudioSnippet {
    chunks: any[],
    timestamp: number,
}

interface MeetingData {
    active: boolean;
    chatLog: string[];
    attendance: Set<string>;
    audioFilePath: string;
    connection: VoiceConnection;
    textChannel: TextChannel | null;
    guildId: string;
    channelId: string;
    audioData: Map<string, AudioSnippet[]>
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

    const audioData: Map<string, AudioSnippet[]> = new Map<string, AudioSnippet[]>();

    const attendance: Set<string> = new Set<string>();

    voiceChannel.members.forEach((member) => attendance.add(member.user.tag));

    receiver.speaking.on('start', userId => {
        const opusStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
        // @ts-ignore
        const decodedStream = opusStream.pipe(new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: FRAME_SIZE }));

        const passThrough = new PassThrough();
        // @ts-ignore
        decodedStream.pipe(passThrough);

        if (!audioData.has(userId)) {
            audioData.set(userId, []);
        }

        const snippet: AudioSnippet = {
            chunks: [],
            timestamp: Date.now(),
        }
        audioData.get(userId)!.push(snippet);

        passThrough.on('data', chunk => {
            snippet.chunks.push(chunk);
        });

        console.log(`Started recording ${userId}`);
    });

    // Cleanup when user stops speaking
    receiver.speaking.on('end', userId => {
        const opusStream = receiver.subscriptions.get(userId);
        if (opusStream) {
            opusStream.destroy();
        }
    });

    const textChannel = interaction.channel as TextChannel;

    await textChannel.send('The bot is now listening to the voice channel and monitoring this chat.');

    // Save chat messages
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
        attendance,
        audioFilePath,
        connection,
        textChannel,
        audioData,
        guildId,
        channelId,
    });
}
async function handleEndMeeting(interaction: CommandInteraction) {
    try {
        const guildId = interaction.guildId!;
        const channelId = interaction.channelId;

        const meeting = meetings.get(`${guildId}-${channelId}`);
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

        const attendanceList = Array.from(meeting.attendance).join('\n');
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

            transcriptionPromises.push(transcribeSnippet(mergedSnippet.snippet, mergedSnippet.userId));
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

        const embed = new EmbedBuilder()
            .setTitle('Meeting Summary')
            .setColor(0x00AE86)
            .setDescription('Here are the details of the recent meeting:')
            .addFields(
                { name: 'Members in Attendance', value: attendanceList || 'No members recorded.' },
            )
            .setTimestamp();

        const channel = await client.channels.fetch(meeting.channelId) as TextChannel;
        if (channel) {
            const files = [];
            if (doesFileHaveContent(chatLogFilePath)) {
                files.push({ attachment: chatLogFilePath, name: 'ChatLog.txt' });
            }
            if (doesFileHaveContent(meeting.audioFilePath)) {
                files.push({ attachment: meeting.audioFilePath, name: 'AudioRecording.wav' });
            }
            if (doesFileHaveContent(transcriptionFilePath)) {
                files.push({ attachment: transcriptionFilePath, name: 'Transcription.txt' });
            }
            await channel.send({
                embeds: [embed],
                files,
            });
        }

        // Edit the initial deferred reply to include the final message
        await interaction.editReply('Meeting ended, the summary has been posted.');

        meetings.delete(`${guildId}-${channelId}`);

    } catch (error) {
        console.error('Error during meeting end:', error);
    }
}

function mergeSnippetsAcrossUsers(audioData: Map<string, AudioSnippet[]>): { snippet: AudioSnippet, userId: string }[] {
    const allSnippets: { snippet: AudioSnippet, userId: string }[] = [];

    audioData.forEach((snippets, userId) => {
        snippets.forEach(snippet => {
            allSnippets.push({ snippet, userId });
        });
    });

    allSnippets.sort((a, b) => a.snippet.timestamp - b.snippet.timestamp);

    const mergedSnippets: { snippet: AudioSnippet, userId: string }[] = [];
    let currentSnippet: { snippet: AudioSnippet, userId: string } | null = null;
    let lastSnippetEndTime = 0;
    const maxTimeGap = 5000; // Maximum time gap in milliseconds to consider snippets as part of the same phrase

    allSnippets.forEach(({ snippet, userId }) => {
        const snippetDuration = snippet.chunks.length * (1000 / SAMPLE_RATE) / CHANNELS;
        const snippetEndTime = snippet.timestamp + snippetDuration;

        if (!currentSnippet) {
            currentSnippet = { snippet: { chunks: [...snippet.chunks], timestamp: snippet.timestamp }, userId };
            lastSnippetEndTime = snippetEndTime;
        } else {
            if (snippet.timestamp <= lastSnippetEndTime + maxTimeGap) {
                currentSnippet.snippet.chunks.push(...snippet.chunks);
                lastSnippetEndTime = snippetEndTime;
            } else {
                const silenceDuration = snippet.timestamp - lastSnippetEndTime;
                if (silenceDuration > 0) {
                    const silenceBuffer = generateSilentBuffer(silenceDuration, SAMPLE_RATE, CHANNELS);
                    currentSnippet.snippet.chunks.push(silenceBuffer);
                }
                mergedSnippets.push(currentSnippet);
                currentSnippet = { snippet: { chunks: [...snippet.chunks], timestamp: snippet.timestamp }, userId };
                lastSnippetEndTime = snippetEndTime;
            }
        }
    });

    if (currentSnippet) {
        mergedSnippets.push(currentSnippet);
    }

    return mergedSnippets;
}

function generateSilentBuffer(durationMs: number, sampleRate: number, channels: number): Buffer {
    const numSamples = Math.floor((durationMs / 1000) * sampleRate) * channels;
    return Buffer.alloc(numSamples * BYTES_PER_SAMPLE);
}

async function transcribeSnippet(snippet: AudioSnippet, userId: string): Promise<string> {
    const tempPcmFileName = `./temp_snippet_${userId}_${snippet.timestamp}.pcm`;
    const tempWavFileName = `./temp_snippet_${userId}_${snippet.timestamp}.wav`;

    const buffer = Buffer.concat(snippet.chunks);
    writeFileSync(tempPcmFileName, buffer);

    await new Promise<void>((resolve, reject) => {
        ffmpeg(tempPcmFileName)
            .inputOptions([
                `-f s16le`,
                `-ar ${SAMPLE_RATE}`,
                `-ac ${CHANNELS}`
            ])
            .outputOptions([
                `-f wav`,
                `-c:a pcm_s16le`
            ])
            .on('end', () => {
                resolve();
            })
            .on('error', (err) => {
                console.error(`Error converting PCM to WAV: ${err.message}`);
                reject(err);
            })
            .save(tempWavFileName);
    });

    try {
        const transcription = await openAIClient.audio.transcriptions.create({
            file: createReadStream(tempWavFileName),
            model: "whisper-1",
            language: "en",
        });

        // Cleanup temporary files
        unlinkSync(tempPcmFileName);
        unlinkSync(tempWavFileName);

        return `[${userId} @ ${new Date(snippet.timestamp).toLocaleString()}]: ${transcription.text}`;
    } catch (e) {
        console.error(`Failed to transcribe snippet for user ${userId}:`, e);
        unlinkSync(tempPcmFileName);
        unlinkSync(tempWavFileName);
        return `[${userId} @ ${new Date(snippet.timestamp).toLocaleString()}]: [Transcription failed]`;
    }
}

function doesFileHaveContent(path: string): boolean {
    return readFileSync(path).length > 0;
}

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

        meeting.connection.receiver.speaking.on('start', (userId) => {
            const opusStream = meeting.connection.receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.Manual,
                },
            });

            // @ts-ignore
            const decodedStream = opusStream.pipe(new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: FRAME_SIZE }));
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
        });
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
function synchronizeUserAudio(userChunks: AudioSnippet[]) {
    const finalUserBuffer: Buffer[] = [];
    let lastTimestamp = userChunks[0].timestamp;
    let lastPacketCount = 0;

    for (let i = 0; i < userChunks.length; i++) {
        const currentData = userChunks[i];
        const timeDiff = currentData.timestamp - lastTimestamp;

        if (timeDiff > 0) {
            // Insert silence if there is a gap
            const silenceBuffer = generateSilentBuffer(timeDiff, SAMPLE_RATE, CHANNELS);
            finalUserBuffer.push(silenceBuffer);
        }

        finalUserBuffer.push(...currentData.chunks);
        lastTimestamp = currentData.timestamp;
        lastPacketCount = currentData.chunks.length;
    }

    return Buffer.concat(finalUserBuffer);
}

function combineAudioWithFFmpeg(userBuffers: string[], audioFilePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const validBuffers = userBuffers.filter(fileName => {
            try {
                const stats = statSync(fileName);
                return stats.size > 0;
            } catch (err) {
                console.error(`Error checking file ${fileName}:`, err);
                return false;
            }
        });

        if (validBuffers.length === 0) {
            return reject(new Error('No valid audio files to combine.'));
        }

        // Concatenate audio files with proper timing
        let ffmpegCommand = `ffmpeg -y `;

        validBuffers.forEach((fileName, index) => {
            ffmpegCommand += `-f s16le -ar ${SAMPLE_RATE} -ac ${CHANNELS} -i ${fileName} `;
        });

        // Use concat filter to join all audio files together
        const concatFilter = validBuffers.map((_, index) => `[${index}:a]`).join('') + `concat=n=${validBuffers.length}:v=0:a=1[out]`;

        ffmpegCommand += `-filter_complex "${concatFilter}" -map "[out]" -f wav -c:a pcm_s16le ${audioFilePath}`;

        exec(ffmpegCommand, (err, stdout, stderr) => {
            if (err) {
                console.error('Error combining audio with ffmpeg:', err);
                reject(err);
                return;
            }

            console.log(`Final mixed audio file created as ${audioFilePath}`);
            validBuffers.forEach(fileName => unlinkSync(fileName)); // Cleanup temp files
            resolve();
        });
    });
}


client.login(TOKEN);