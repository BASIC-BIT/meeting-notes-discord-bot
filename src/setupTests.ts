// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom";

const requiredTestEnv = {
  MOCK_MODE: "true",
  ENABLE_OAUTH: "false",
  DISCORD_BOT_TOKEN: "test-discord-bot-token",
  DISCORD_CLIENT_ID: "test-discord-client-id",
  DISCORD_CLIENT_SECRET: "test-discord-client-secret",
  DISCORD_CALLBACK_URL: "http://localhost:3001/callback",
  OAUTH_SECRET: "test-oauth-secret",
  OPENAI_API_KEY: "test-openai-api-key",
  STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: "test-stripe-secret-key",
  STRIPE_WEBHOOK_SECRET: "test-stripe-webhook-secret",
  STRIPE_SUCCESS_URL: "http://localhost:3001/stripe/success",
  STRIPE_CANCEL_URL: "http://localhost:3001/stripe/cancel",
};

Object.entries(requiredTestEnv).forEach(([key, value]) => {
  if (!process.env[key]) {
    process.env[key] = value;
  }
});

// Minimal matchMedia polyfill for Mantine components in tests
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (typeof window.ResizeObserver === "undefined") {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserver;
}
