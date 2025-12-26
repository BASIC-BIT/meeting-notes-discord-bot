// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom";

// Provide API base for tests so apiClient can build URLs without import.meta
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__API_BASE_URL__ = process.env.VITE_API_BASE_URL || "";
