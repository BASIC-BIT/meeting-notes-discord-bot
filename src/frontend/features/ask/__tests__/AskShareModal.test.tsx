import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { AskShareModal } from "../AskShareModal";
import type { AskConversation } from "../../../../types/ask";

const baseConversation: AskConversation = {
  id: "c1",
  title: "Q4 planning",
  summary: "Notes",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T01:00:00Z",
};

const renderWithProvider = (ui: React.ReactElement) =>
  render(<MantineProvider>{ui}</MantineProvider>);

const buildProps = (
  overrides?: Partial<React.ComponentProps<typeof AskShareModal>>,
) => ({
  opened: true,
  onClose: jest.fn(),
  publicSharingEnabled: true,
  sharingEnabled: true,
  activeConversation: baseConversation,
  isShared: true,
  shareDisplayVisibility: "public",
  shareUrl: "https://chronote.gg/share",
  activeVisibility: "public",
  shareError: null,
  onCopyShareLink: jest.fn(),
  onShareChange: jest.fn(),
  sharePending: false,
  ...overrides,
});

describe("AskShareModal", () => {
  it("renders shared link controls when sharing is enabled", () => {
    renderWithProvider(<AskShareModal {...buildProps()} />);

    expect(screen.getByText("Public link")).toBeInTheDocument();
    expect(screen.getByText("Turn off sharing")).toBeInTheDocument();
    expect(screen.getByText("Make server-only")).toBeInTheDocument();
    expect(screen.getByLabelText("Copy share link")).toBeInTheDocument();
  });

  it("shows disabled notice when sharing is turned off", () => {
    renderWithProvider(
      <AskShareModal
        {...buildProps({
          sharingEnabled: false,
          isShared: false,
          publicSharingEnabled: false,
        })}
      />,
    );

    expect(
      screen.getByText("Sharing is disabled for this server."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Share with server")).toBeNull();
  });
});
