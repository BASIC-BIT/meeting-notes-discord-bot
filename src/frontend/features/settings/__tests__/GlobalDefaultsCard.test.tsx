import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { GlobalDefaultsCard } from "../GlobalDefaultsCard";

describe("GlobalDefaultsCard", () => {
  const baseProps = {
    busy: false,
    canSave: true,
    saving: false,
    serverContext: "",
    onServerContextChange: jest.fn(),
    defaultNotesChannelId: null,
    onDefaultNotesChannelChange: jest.fn(),
    defaultTags: "",
    onDefaultTagsChange: jest.fn(),
    textChannels: [],
    defaultNotesAccess: undefined,
    globalLiveVoiceEnabled: false,
    onGlobalLiveVoiceEnabledChange: jest.fn(),
    globalLiveVoiceCommandsEnabled: false,
    onGlobalLiveVoiceCommandsEnabledChange: jest.fn(),
    globalLiveVoiceTtsVoice: null,
    onGlobalLiveVoiceTtsVoiceChange: jest.fn(),
    globalChatTtsEnabled: false,
    onGlobalChatTtsEnabledChange: jest.fn(),
    globalChatTtsVoice: null,
    onGlobalChatTtsVoiceChange: jest.fn(),
    recordAllEnabled: false,
    onRecordAllEnabledChange: jest.fn(),
    onSave: jest.fn(),
  };

  it("invokes save", () => {
    const props = { ...baseProps, onSave: jest.fn() };
    render(
      <MantineProvider>
        <GlobalDefaultsCard {...props} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("settings-save-defaults"));
    expect(props.onSave).toHaveBeenCalled();
  });
});
