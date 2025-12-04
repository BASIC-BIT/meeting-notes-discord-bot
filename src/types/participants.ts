export interface Participant {
  id: string; // Discord user snowflake
  tag: string; // username#discriminator (or new global tag)
  nickname?: string; // guild nickname/display name
  globalName?: string; // Discord global display name
}
