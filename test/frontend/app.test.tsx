import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import App from "../../src/frontend/App";

jest.mock("../../src/frontend/router", () => ({
  router: { name: "mock-router" },
}));

jest.mock("@tanstack/react-router", () => ({
  RouterProvider: ({ router }: { router: { name: string } }) => (
    <div data-testid="router-provider" data-router={router.name} />
  ),
}));

describe("App", () => {
  test("renders router provider", () => {
    render(<App />);
    const node = screen.getByTestId("router-provider");
    expect(node).toHaveAttribute("data-router", "mock-router");
  });
});
