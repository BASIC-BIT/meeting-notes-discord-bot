type BotMemberNameSource = {
  displayName?: string | null;
  nickname?: string | null;
  user?: {
    displayName?: string | null;
    username?: string | null;
  } | null;
};

type BotUserNameSource = {
  displayName?: string | null;
  username?: string | null;
};

const DEFAULT_BOT_NAMES = ["Chronote", "Meeting Notes Bot", "MeetingNotesBot"];

export function getBotNameVariants(
  botMember?: BotMemberNameSource | null,
  clientUser?: BotUserNameSource | null,
  extraNames: string[] = [],
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const addName = (value?: string | null) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(trimmed);
  };

  for (const name of DEFAULT_BOT_NAMES) addName(name);
  for (const name of extraNames) addName(name);
  addName(botMember?.displayName ?? null);
  addName(botMember?.nickname ?? null);
  addName(botMember?.user?.displayName ?? null);
  addName(botMember?.user?.username ?? null);
  addName(clientUser?.displayName ?? null);
  addName(clientUser?.username ?? null);

  return names;
}
