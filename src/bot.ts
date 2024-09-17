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
import { getAllMeetings, getMeeting } from "./meetings";
import {handleRequestStartMeeting, handleStartMeeting} from "./commands/startMeeting";
import { handleEndMeetingButton, handleEndMeetingOther } from "./commands/endMeeting";
import { subscribeToUserVoice, unsubscribeToVoiceUponLeaving } from "./audio";
import {generateAndSendTodoList} from "./commands/generateTodoList";
import {generateAndSendSummary} from "./commands/generateSummary";
import {generateAndSendImage} from "./commands/generateImage";
import { generateAndSendNotes } from "./commands/generateNotes";

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
        if(isShuttingDown) {
            // Assume another instance has already been spun up to handle traffic, and don't handle it
            console.log("Interaction received but bot is shutting down. Not handling");
            return;
        }
        try {
            if (interaction.isCommand()) {
                const commandInteraction = interaction as CommandInteraction;

                const { commandName } = interaction;

                if (commandName === 'startmeeting') {
                    await handleRequestStartMeeting(commandInteraction);
                }
            }
			if(interaction.isButton()) {
				const buttonInteraction = interaction as ButtonInteraction;

				if(buttonInteraction.customId === "end_meeting") {
					await handleEndMeetingButton(client, buttonInteraction);
				}
                if(buttonInteraction.customId === "with_transcription") {
                    await handleStartMeeting(buttonInteraction, true);
                }
                if(buttonInteraction.customId === "without_transcription") {
                    await handleStartMeeting(buttonInteraction, false);
                }
                if(buttonInteraction.customId === "generate_summary") {
                    await generateAndSendSummary(interaction);
                }
                if(buttonInteraction.customId === "generate_todo") {
                    await generateAndSendTodoList(interaction);
                }
                if(buttonInteraction.customId === "generate_image") {
                    await generateAndSendImage(interaction);
                }
                if(buttonInteraction.customId === "generate_notes") {
                    await generateAndSendNotes(interaction);
                }
			}
        } catch (e) {
            console.log("Unknown error processing command: ", e);
            if (interaction.isRepliable()) {
                const repliableInteraction = interaction as RepliableInteraction;
                await repliableInteraction.reply("Unknown Error handling request.");
            }
        }
    });

    setupApplicationCommands();

    client.login(TOKEN);
}

async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
    if (!oldState.channel && newState.channel && newState.member) {
        await handleUserJoin(newState);
    }
    // Check if the user left a voice channel
    else if (oldState.channel && !newState.channel && oldState.member) {
        await handleUserLeave(oldState);
    }
}

async function handleUserJoin(newState: VoiceState) {
    const meeting = getMeeting(newState.guild.id);
    if (meeting && newState.member && newState.member.user.id !== client.user!.id && meeting.voiceChannel.id === newState.channelId) {
        const userTag = newState.member!.user.tag;
        console.log(`${userTag} joined the voice channel.`);
        meeting.attendance.add(userTag);
        // Optionally, log the time they joined
        meeting.chatLog.push(`[${userTag}] joined the channel at ${new Date().toLocaleTimeString()}`);

        await subscribeToUserVoice(meeting, newState.member!.user.id);
    }
}

async function handleUserLeave(oldState: VoiceState) {
    const meeting = getMeeting(oldState.guild.id);
    if (meeting && oldState.member && oldState.member.user.id !== client.user!.id && meeting.voiceChannel.id === oldState.channelId) {
        const userTag = oldState.member!.user.tag;
        console.log(`${userTag} left the voice channel.`);
        // Optionally, log the time they left
        meeting.chatLog.push(`[${userTag}] left the channel at ${new Date().toLocaleTimeString()}`);

        unsubscribeToVoiceUponLeaving(meeting, oldState.member!.user.id);

        if(meeting.voiceChannel.members.size <= 1 && !meeting.finishing) {
            await meeting.textChannel.send("Meeting ending due to nobody being left in the voice channel.");
            await handleEndMeetingOther(client, meeting);
        }
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

// Signal listener to start graceful shutdown
process.on('SIGTERM', async () => {
    console.log("Received SIGTERM, initiating graceful shutdown");

    // Stop accepting new meetings/requests
    stopHandlingNewMeetings();

    // Wait for ongoing meetings to finish
    await completeOngoingMeetings();

    // Shut down the bot gracefully
    console.log("Shutting down...");
    process.exit(0); // Exit the process when all meetings are done
});
let isShuttingDown = false;

function stopHandlingNewMeetings() {
    isShuttingDown = true;
}

async function completeOngoingMeetings() {
    const meetings = getAllMeetings();
    if (meetings.length > 0) {
        console.log("Waiting for ongoing meetings to finish...");
        await Promise.all(meetings.map(meeting => meeting.isFinished));
    } else {
        console.log("No ongoing meetings, ready to shut down.");
    }
}