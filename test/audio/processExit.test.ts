/** @jest-environment node */
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("voice teardown process survival", () => {
  test.each(["pending-opus", "pending-decoder"])(
    "survives %s through the production subscription cleanup",
    (fault) => {
      const result = spawnSync(
        process.execPath,
        [path.join(__dirname, "fixtures/voiceCaptureExit.cjs"), fault],
        { encoding: "utf8", timeout: 10_000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("teardownCompleted=true\n");
      expect(result.stderr).toBe("");
    },
  );
});
