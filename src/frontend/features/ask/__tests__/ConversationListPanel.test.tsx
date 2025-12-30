import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { ConversationListPanel } from "../ConversationListPanel";
import type {
  AskConversation,
  AskSharedConversation,
} from "../../../../types/ask";

const baseConversation: AskConversation = {
  id: "1",
  title: "First chat",
  summary: "Summary",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-02T00:00:00Z",
};

const sharedConversation: AskSharedConversation = {
  conversationId: "s1",
  title: "Shared chat",
  summary: "Shared summary",
  ownerUserId: "owner-1",
  ownerTag: "User#0001",
  updatedAt: "2024-01-02T00:00:00Z",
};

describe("ConversationListPanel", () => {
  const noop = () => {};
  const renderWithProvider = (ui: React.ReactElement) =>
    render(<MantineProvider>{ui}</MantineProvider>);

  it("renders my chats by default and navigates on click", () => {
    const navigate = jest.fn();
    renderWithProvider(
      <ConversationListPanel
        listMode="mine"
        onListModeChange={noop}
        query=""
        onQueryChange={noop}
        mineConversations={[baseConversation]}
        sharedConversations={[]}
        listBusy={false}
        listError={null}
        activeId={"1"}
        onNewConversation={noop}
        navigateToConversation={navigate}
        sharingEnabled={true}
        askAccessAllowed={true}
      />,
    );

    const item = screen.getByTestId("ask-conversation-item");
    fireEvent.click(item);
    expect(navigate).toHaveBeenCalledWith("1", "mine");
  });

  it("shows shared conversations list when mode is shared", () => {
    renderWithProvider(
      <ConversationListPanel
        listMode="shared"
        onListModeChange={noop}
        query=""
        onQueryChange={noop}
        mineConversations={[]}
        sharedConversations={[sharedConversation]}
        listBusy={false}
        listError={null}
        activeId={"s1"}
        onNewConversation={noop}
        navigateToConversation={noop}
        sharingEnabled={true}
        askAccessAllowed={true}
      />,
    );

    expect(screen.getByText("Shared chat")).toBeInTheDocument();
    expect(screen.getByText("User#0001")).toBeInTheDocument();
  });
});
