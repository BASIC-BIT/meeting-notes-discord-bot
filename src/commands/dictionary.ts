import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionsBitField,
} from "discord.js";
import {
  clearDictionaryEntriesService,
  listDictionaryEntriesService,
  removeDictionaryEntryService,
  upsertDictionaryEntryService,
} from "../services/dictionaryService";

const MAX_PREVIEW_ENTRIES = 20;
const MAX_PREVIEW_CHARS = 1500;
const MAX_DEFINITION_PREVIEW = 120;

const truncateText = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const buildPreview = (
  entries: Awaited<ReturnType<typeof listDictionaryEntriesService>>,
) => {
  const lines: string[] = [];
  let chars = 0;
  let included = 0;

  for (const entry of entries) {
    if (included >= MAX_PREVIEW_ENTRIES) break;
    const definition = entry.definition
      ? truncateText(entry.definition, MAX_DEFINITION_PREVIEW)
      : undefined;
    const line = definition
      ? `- ${entry.term}: ${definition}`
      : `- ${entry.term}`;
    const nextChars = chars + line.length + (lines.length > 0 ? 1 : 0);
    if (nextChars > MAX_PREVIEW_CHARS) break;
    lines.push(line);
    chars = nextChars;
    included += 1;
  }

  const remaining = entries.length - included;
  if (remaining > 0) {
    lines.push(`...and ${remaining} more.`);
  }

  return lines.join("\n");
};

export async function handleDictionaryCommand(
  interaction: ChatInputCommandInteraction,
) {
  const { guild } = interaction;
  if (!guild || !interaction.member) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const member = guild.members.cache.get(interaction.user.id);
  if (
    !member ||
    !member.permissions.has(PermissionsBitField.Flags.ManageChannels)
  ) {
    await interaction.reply({
      content: "You need the 'Manage Channels' permission to use this command.",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  switch (subcommand) {
    case "list": {
      const entries = await listDictionaryEntriesService(guild.id);
      if (entries.length === 0) {
        await interaction.reply({
          content: "No dictionary entries yet.",
          ephemeral: true,
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle("Dictionary entries")
        .setDescription(buildPreview(entries))
        .setColor(0x3498db);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    case "add": {
      const term = interaction.options.getString("term", true);
      const definition = interaction.options.getString("definition");
      const entry = await upsertDictionaryEntryService({
        guildId: guild.id,
        term,
        definition,
        userId: interaction.user.id,
      });
      const embed = new EmbedBuilder()
        .setTitle("Dictionary entry saved")
        .addFields(
          { name: "Term", value: entry.term },
          {
            name: "Definition",
            value: entry.definition ?? "None",
          },
        )
        .setColor(0x00ae86);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    case "remove": {
      const term = interaction.options.getString("term", true);
      await removeDictionaryEntryService({ guildId: guild.id, term });
      await interaction.reply({
        content: `Removed dictionary entry for "${term}".`,
        ephemeral: true,
      });
      return;
    }
    case "clear": {
      await clearDictionaryEntriesService(guild.id);
      await interaction.reply({
        content: "Cleared all dictionary entries for this server.",
        ephemeral: true,
      });
      return;
    }
    default: {
      await interaction.reply({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
    }
  }
}
