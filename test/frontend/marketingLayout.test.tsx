import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { screen } from "@testing-library/react";
import { renderWithMantine, resetFrontendMocks } from "./testUtils";
import MarketingLayout from "../../src/frontend/layouts/MarketingLayout";

jest.mock("../../src/frontend/pages/Home", () => () => (
  <div data-testid="home-page" />
));

describe("MarketingLayout", () => {
  test("renders marketing shell and footer content", () => {
    resetFrontendMocks();
    renderWithMantine(<MarketingLayout />);
    expect(screen.getByTestId("portal-cta")).toBeInTheDocument();
    expect(screen.getByText(/Chronote by/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "BASICBIT" })).toBeInTheDocument();
  });
});
