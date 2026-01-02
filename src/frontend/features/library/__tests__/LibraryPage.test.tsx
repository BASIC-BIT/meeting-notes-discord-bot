import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MeetingList } from "../MeetingList";
import { MEETING_STATUS } from "../../../../types/meetingLifecycle";
import type { MeetingListItem } from "../../../pages/Library";

const baseItem: MeetingListItem = {
  id: "m1",
  meetingId: "meeting-1",
  channelId: "c1",
  channelName: "General",
  timestamp: "2024-01-02T00:00:00Z",
  duration: 3600,
  tags: ["tag"],
  notes: "notes",
  summarySentence: "Summary sentence",
  summaryLabel: "Summary label",
  notesChannelId: "n1",
  notesMessageId: "msg1",
  audioAvailable: true,
  transcriptAvailable: true,
  status: MEETING_STATUS.COMPLETE,
  title: "Weekly sync",
  summary: "Summary",
  dateLabel: "Jan 2",
  durationLabel: "1h",
  channelLabel: "#general",
};

describe("MeetingList", () => {
  it("calls onSelect when clicking a row", () => {
    const onSelect = jest.fn();
    render(
      <MantineProvider>
        <MeetingList
          items={[baseItem]}
          listLoading={false}
          listError={false}
          onRefresh={jest.fn()}
          onSelect={onSelect}
          selectedMeetingId={null}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("Summary label")).toBeInTheDocument();
    expect(screen.getByTestId("library-refresh")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("library-meeting-row"));
    expect(onSelect).toHaveBeenCalledWith("m1");
  });

  it("shows empty state when no items", () => {
    render(
      <MantineProvider>
        <MeetingList
          items={[]}
          listLoading={false}
          listError={false}
          onRefresh={jest.fn()}
          onSelect={jest.fn()}
          selectedMeetingId={null}
        />
      </MantineProvider>,
    );

    expect(
      screen.getByText("No meetings match these filters yet."),
    ).toBeInTheDocument();
  });

  it("shows archived badge when meeting is archived", () => {
    const archivedItem: MeetingListItem = {
      ...baseItem,
      id: "m2",
      meetingId: "meeting-2",
      archivedAt: "2025-12-30T12:00:00.000Z",
      title: "Archived sync",
    };
    render(
      <MantineProvider>
        <MeetingList
          items={[archivedItem]}
          listLoading={false}
          listError={false}
          onRefresh={jest.fn()}
          onSelect={jest.fn()}
          selectedMeetingId={null}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("Archived")).toBeInTheDocument();
  });
});
