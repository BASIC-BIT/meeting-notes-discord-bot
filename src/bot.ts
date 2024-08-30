import {CLIENT_ID, TOKEN} from "./constants";
import {
    Client,
    CommandInteraction,
    GatewayIntentBits,
    Partials,
    REST,
    SlashCommandBuilder, VoiceState
} from "discord.js";
import {Routes} from "discord-api-types/v10";
import {getMeeting, hasMeeting} from "./meetings";
import {subscribeToUserVoice} from "./audio";
import {handleStartMeeting} from "./commands/startMeeting";
import {handleEndMeeting} from "./commands/endMeeting";
import {MeetingData} from "./types/meeting-data";


export async function setupBot() {
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
            await handleEndMeeting(client, commandInteraction);
        }
    });

    client.on('voiceStateUpdate', subscribeToUserVoiceUponJoiningChannel);

    setupApplicationCommands();

    client.login(TOKEN);
}

function subscribeToUserVoiceUponJoiningChannel(oldState: VoiceState, newState: VoiceState) {
    const guildId = newState.guild.id;

    if(!oldState.channel && newState.channel && newState.member && newState.member.user && hasMeeting(guildId, newState.channel.id)) {
        const meeting = getMeeting(guildId, newState.channel.id)!;
        const member = newState.member;

        meeting.attendance.add(member.user.tag);

        meeting.connection.receiver.speaking.on('start', (userId) => {
            subscribeToUserVoice(meeting, userId);
        });
    }
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
