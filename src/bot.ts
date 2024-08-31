import { CLIENT_ID, TOKEN } from "./constants";
import {
	ButtonInteraction,
	Client,
	CommandInteraction,
	GatewayIntentBits,
	Partials, RepliableInteraction,
	REST,
	SlashCommandBuilder, VoiceState
} from "discord.js";
import { Routes } from "discord-api-types/v10";
import { getMeeting } from "./meetings";
import { handleStartMeeting } from "./commands/startMeeting";
import { handleEndMeeting } from "./commands/endMeeting";

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
        console.log(`Logged in as ${client.user?.tag}!`)

        client.on('voiceStateUpdate', handleVoiceStateUpdate);

    });

    client.on('interactionCreate', async interaction => {
        try {
            if (interaction.isCommand()) {
                const commandInteraction = interaction as CommandInteraction;

                const { commandName } = interaction;

                if (commandName === 'startmeeting') {
                    await handleStartMeeting(commandInteraction);
                }
            }
			if(interaction.isButton()) {
				const buttonInteraction = interaction as ButtonInteraction;

				if(buttonInteraction.customId === "end_meeting") {
					await handleEndMeeting(client, buttonInteraction);
				}
			}
        } catch (e) {
            if (interaction.isRepliable()) {
                const repliableInteraction = interaction as RepliableInteraction;
                await repliableInteraction.reply("Unknown Error handling request.");
            }
        }
    });

    setupApplicationCommands();

    client.login(TOKEN);
}

function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
    if (!oldState.channel && newState.channel && newState.member) {
        handleUserJoin(newState);
    }
    // Check if the user left a voice channel
    else if (oldState.channel && !newState.channel && oldState.member) {
        handleUserLeave(oldState);
    }
}

function handleUserJoin(newState: VoiceState) {
    const meeting = getMeeting(newState.guild.id);
    if (meeting && newState.member && newState.member.user.id !== client.user!.id && meeting.voiceChannel.id === newState.channelId) {
        const userTag = newState.member!.user.tag;
        console.log(`${userTag} joined the voice channel.`);
        meeting.attendance.add(userTag);
        // Optionally, log the time they joined
        meeting.chatLog.push(`[${userTag}] joined the channel at ${new Date().toLocaleTimeString()}`);
    }
}

function handleUserLeave(oldState: VoiceState) {
    const meeting = getMeeting(oldState.guild.id);
    if (meeting && oldState.member && oldState.member.user.id !== client.user!.id && meeting.voiceChannel.id === oldState.channelId) {
        const userTag = oldState.member!.user.tag;
        console.log(`${userTag} left the voice channel.`);
        // Optionally, log the time they left
        meeting.chatLog.push(`[${userTag}] left the channel at ${new Date().toLocaleTimeString()}`);
    }
}

async function setupApplicationCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('startmeeting')
            .setDescription('Record a meeting with voice and chat logs.'),
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
