import { MODEL_SELECTION_DEFAULTS } from "../../src/config/modelChoices";
import { resolveModelChoicesByRole } from "../../src/services/modelChoiceService";

describe("modelChoiceService", () => {
  test("resolves defaults when snapshot values are missing", () => {
    const snapshot = {
      values: {},
      experimentalEnabled: false,
      missingRequired: [],
    };
    const resolved = resolveModelChoicesByRole(snapshot);
    expect(resolved.notes).toBe(MODEL_SELECTION_DEFAULTS.notes);
    expect(resolved.transcription).toBe(MODEL_SELECTION_DEFAULTS.transcription);
  });
});
