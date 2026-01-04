import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { FiltersBar } from "../../library/FiltersBar";
import { GlobalDefaultsCard } from "../GlobalDefaultsCard";

describe("Settings components", () => {
  it("FiltersBar updates query", () => {
    const onQueryChange = jest.fn();
    render(
      <MantineProvider>
        <FiltersBar
          query=""
          onQueryChange={onQueryChange}
          tagOptions={["alpha"]}
          selectedTags={[]}
          onTagsChange={jest.fn()}
          selectedRange="30"
          onRangeChange={jest.fn()}
          archiveFilter="active"
          onArchiveFilterChange={jest.fn()}
          selectedChannel={null}
          onChannelChange={jest.fn()}
          channelOptions={[]}
        />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByTestId("library-search"), {
      target: { value: "hello" },
    });
    expect(onQueryChange).toHaveBeenCalledWith("hello");
  });

  it("GlobalDefaultsCard save triggers callback", () => {
    const onSave = jest.fn();
    render(
      <MantineProvider>
        <GlobalDefaultsCard
          busy={false}
          canSave
          saving={false}
          serverContext=""
          onServerContextChange={jest.fn()}
          defaultNotesChannelId={null}
          onDefaultNotesChannelChange={jest.fn()}
          defaultTags=""
          onDefaultTagsChange={jest.fn()}
          textChannels={[]}
          defaultNotesAccess={undefined}
          globalLiveVoiceEnabled={false}
          onGlobalLiveVoiceEnabledChange={jest.fn()}
          globalLiveVoiceCommandsEnabled={false}
          onGlobalLiveVoiceCommandsEnabledChange={jest.fn()}
          globalLiveVoiceTtsVoice={null}
          onGlobalLiveVoiceTtsVoiceChange={jest.fn()}
          globalChatTtsEnabled={false}
          onGlobalChatTtsEnabledChange={jest.fn()}
          globalChatTtsVoice={null}
          onGlobalChatTtsVoiceChange={jest.fn()}
          recordAllEnabled={false}
          onRecordAllEnabledChange={jest.fn()}
          onSave={onSave}
        />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("settings-save-defaults"));
    expect(onSave).toHaveBeenCalled();
  });
});
