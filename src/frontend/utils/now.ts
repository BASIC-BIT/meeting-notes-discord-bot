type MockNowGlobal = {
  __MOCK_FIXED_NOW__?: string;
};

export const resolveNowMs = (): number => {
  const raw =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as MockNowGlobal).__MOCK_FIXED_NOW__ === "string"
      ? (globalThis as MockNowGlobal).__MOCK_FIXED_NOW__
      : "";
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Date.now();
};
