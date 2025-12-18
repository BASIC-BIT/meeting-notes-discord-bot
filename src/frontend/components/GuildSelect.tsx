import { Select, SelectProps } from "@mantine/core";
import { useGuildContext } from "../contexts/GuildContext";

export function GuildSelect(props: Partial<SelectProps>) {
  const { guilds, selectedGuildId, setSelectedGuildId, loading } =
    useGuildContext();

  const data = guilds.map((g) => ({
    value: g.id,
    label: g.name,
  }));

  return (
    <Select
      label="Server"
      placeholder={loading ? "Loading servers…" : "Select a server"}
      data={data}
      value={selectedGuildId}
      onChange={setSelectedGuildId}
      searchable
      clearable={false}
      disabled={loading || data.length === 0}
      {...props}
    />
  );
}

export default GuildSelect;
