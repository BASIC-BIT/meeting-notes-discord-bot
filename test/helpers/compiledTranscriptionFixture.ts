import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  TRANSCRIPTION_IMPLEMENTATION_SOURCES,
  writeTranscriptionBuildAssociation,
} from "../../src/evals/transcriptionImplementation";
import {
  compileSpeechFixture,
  removeOwnedFixture,
} from "./compiledSpeechDetectionFixture";

export async function prepareTranscriptionFixture(
  root: string,
  dependencyRoot = root,
): Promise<string> {
  const fixture = mkdtempSync(
    path.join(tmpdir(), "vad-build-contract-compiled-"),
  );
  try {
    const sources = compileSpeechFixture(
      root,
      fixture,
      [
        "evals/transcriptionEval.ts",
        ...TRANSCRIPTION_IMPLEMENTATION_SOURCES.map((file) => file.slice(4)),
      ],
      dependencyRoot,
    );
    for (const file of [
      ...sources,
      "package.json",
      "tsconfig.json",
      "yarn.lock",
    ]) {
      mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      cpSync(path.join(root, file), path.join(fixture, file));
    }
    await writeTranscriptionBuildAssociation(fixture);
    return fixture;
  } catch (error) {
    removeOwnedFixture(fixture, "vad-build-contract-");
    throw error;
  }
}

export async function prepareTranscriptionAcceptanceFixture(
  root: string,
  dependencyRoot = root,
): Promise<string> {
  const fixture = await prepareTranscriptionFixture(root, dependencyRoot);
  try {
    const scripts = "scripts/speech-detection";
    mkdirSync(path.join(fixture, scripts), { recursive: true });
    for (const file of [
      "check-acceptance.mjs",
      "acceptance-evidence.mjs",
      "evidence.mjs",
    ])
      cpSync(path.join(root, scripts, file), path.join(fixture, scripts, file));
    // ESM package resolution does not use NODE_PATH. Copy its one script dependency
    // into the owned fixture; CommonJS dependencies remain read-only through NODE_PATH.
    cpSync(
      path.join(dependencyRoot, "node_modules/zod"),
      path.join(fixture, "node_modules/zod"),
      { recursive: true },
    );
    return fixture;
  } catch (error) {
    removeOwnedFixture(fixture, "vad-build-contract-");
    throw error;
  }
}
