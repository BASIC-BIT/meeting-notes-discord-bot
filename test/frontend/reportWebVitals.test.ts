import { describe, expect, jest, test } from "@jest/globals";
import reportWebVitals from "../../src/frontend/reportWebVitals";
import { onCLS, onFCP, onFID, onINP, onLCP, onTTFB } from "web-vitals";

jest.mock("web-vitals", () => ({
  onCLS: jest.fn(),
  onFID: jest.fn(),
  onFCP: jest.fn(),
  onLCP: jest.fn(),
  onTTFB: jest.fn(),
  onINP: jest.fn(),
}));

describe("reportWebVitals", () => {
  test("invokes web vitals callbacks when handler is provided", () => {
    const handler = jest.fn();
    reportWebVitals(handler);
    expect(onCLS).toHaveBeenCalledWith(handler);
    expect(onFID).toHaveBeenCalledWith(handler);
    expect(onFCP).toHaveBeenCalledWith(handler);
    expect(onLCP).toHaveBeenCalledWith(handler);
    expect(onTTFB).toHaveBeenCalledWith(handler);
    expect(onINP).toHaveBeenCalledWith(handler);
  });

  test("does nothing when handler is missing", () => {
    if (jest.isMockFunction(onCLS)) onCLS.mockClear();
    if (jest.isMockFunction(onFID)) onFID.mockClear();
    if (jest.isMockFunction(onFCP)) onFCP.mockClear();
    if (jest.isMockFunction(onLCP)) onLCP.mockClear();
    if (jest.isMockFunction(onTTFB)) onTTFB.mockClear();
    if (jest.isMockFunction(onINP)) onINP.mockClear();

    reportWebVitals();
    expect(onCLS).not.toHaveBeenCalled();
    expect(onFID).not.toHaveBeenCalled();
    expect(onFCP).not.toHaveBeenCalled();
    expect(onLCP).not.toHaveBeenCalled();
    expect(onTTFB).not.toHaveBeenCalled();
    expect(onINP).not.toHaveBeenCalled();
  });
});
