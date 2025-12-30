import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { FiltersBar } from "../FiltersBar";

describe("FiltersBar", () => {
  const baseProps = {
    query: "",
    onQueryChange: jest.fn(),
    tagOptions: ["alpha", "beta"],
    selectedTags: [],
    onTagsChange: jest.fn(),
    selectedRange: "30",
    onRangeChange: jest.fn(),
    selectedChannel: null,
    onChannelChange: jest.fn(),
    channelOptions: [{ value: "1", label: "Channel 1" }],
  };

  it("updates query", () => {
    const props = { ...baseProps, onQueryChange: jest.fn() };
    render(
      <MantineProvider>
        <FiltersBar {...props} />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByTestId("library-search"), {
      target: { value: "hello" },
    });
    expect(props.onQueryChange).toHaveBeenCalledWith("hello");
  });
});
