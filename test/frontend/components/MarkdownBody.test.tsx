import React from "react";
import { describe, expect, test } from "@jest/globals";
import { screen } from "@testing-library/react";
import MarkdownBody from "../../../src/frontend/components/MarkdownBody";
import { renderWithMantine } from "../testUtils";

describe("MarkdownBody", () => {
  test("renders markdown content", () => {
    renderWithMantine(<MarkdownBody content="Hello **world**" />);
    expect(screen.getByText("Hello **world**")).toBeInTheDocument();
  });
});
