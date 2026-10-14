/** @jest-environment node */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { z } from "zod";

const root = path.resolve(__dirname, "../..");
let compiled: string;
function removeFixture(fixture: string): void {
  if (
    path.dirname(path.resolve(fixture)) !== path.resolve(tmpdir()) ||
    !path.basename(fixture).startsWith("chronote-packaging-")
  )
    throw Error("Unexpected cleanup path");
  rmSync(fixture, { recursive: true, force: true });
}
beforeAll(() => {
  compiled = mkdtempSync(path.join(tmpdir(), "chronote-packaging-build-"));
  const config = ts.readConfigFile(
    path.join(root, "tsconfig.json"),
    ts.sys.readFile,
  );
  if (config.error)
    throw Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
    );
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram({
    rootNames: ["speechDetectionService", "speechDetectionWorker"]
      .map((name) => path.join(root, `src/services/${name}.ts`))
      .concat(parsed.fileNames.filter((file) => file.endsWith(".d.ts"))),
    options: {
      ...parsed.options,
      rootDir: path.join(root, "src"),
      outDir: path.join(compiled, "dist"),
      noEmitOnError: true,
      incremental: false,
    },
  });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length)
    throw Error(
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => root,
        getNewLine: () => "\n",
      }),
    );
  if (program.emit().emitSkipped) throw Error("Fixture compilation failed");
  cpSync(
    path.join(root, "assets/speech-detection"),
    path.join(compiled, "dist/assets/speech-detection"),
    { recursive: true },
  );
  cpSync(
    path.join(root, "scripts/speech-detection"),
    path.join(compiled, "scripts/speech-detection"),
    { recursive: true },
  );
  cpSync(
    path.join(root, "test/fixtures/speech-detection"),
    path.join(compiled, "test/fixtures/speech-detection"),
    { recursive: true },
  );
  cpSync(
    path.join(root, "node_modules/onnxruntime-web"),
    path.join(compiled, "node_modules/onnxruntime-web"),
    { recursive: true },
  );
  writeFileSync(
    path.join(compiled, "offline.cjs"),
    `const blocked=()=>{throw Error('Network forbidden in packaging proof')};globalThis.fetch=blocked;for(const name of ['node:http','node:https'])require(name).request=blocked;require('node:net').connect=blocked;require('node:tls').connect=blocked;`,
  );
}, 60000);
afterAll(() => {
  if (compiled) removeFixture(compiled);
});
function checkFixture(check: (fixture: string) => void): void {
  const fixture = mkdtempSync(path.join(tmpdir(), "chronote-packaging-case-"));
  try {
    cpSync(compiled, fixture, { recursive: true });
    check(fixture);
  } finally {
    removeFixture(fixture);
  }
}
function run(fixture: string) {
  return spawnSync(
    process.execPath,
    [
      "--require",
      path.join(fixture, "offline.cjs"),
      "scripts/speech-detection/runtime-smoke.mjs",
      "--compiled",
    ],
    {
      cwd: fixture,
      encoding: "utf8",
      timeout: 45000,
      env: {
        ...process.env,
        NODE_PATH: path.join(root, "node_modules"),
        NODE_OPTIONS: `--require=${JSON.stringify(path.join(fixture, "offline.cjs"))}`,
      },
    },
  );
}
it(
  "compiledSmokeNeedsNoSourceTreeOrNetwork",
  () =>
    checkFixture((fixture) => {
      for (const file of ["src", "tsconfig.json", ".cache"])
        expect(existsSync(path.join(fixture, file))).toBe(false);
      const smoke = run(fixture);
      expect(smoke.stderr).toBe("");
      expect(smoke.status).toBe(0);
      const result = z
        .object({
          silence: z.object({ kind: z.literal("non_speech") }),
          normalSpeech: z.object({ kind: z.literal("speech") }),
          shutdownComplete: z.literal(true),
        })
        .parse(JSON.parse(smoke.stdout));
      expect(result.shutdownComplete).toBe(true);
      console.info("compiled packaging evidence", result);
    }),
  60000,
);
it.each([
  ["missing worker", "dist/services/speechDetectionWorker.js", "missing"],
  ["corrupt worker", "dist/services/speechDetectionWorker.js", "corrupt"],
  [
    "missing model",
    "dist/assets/speech-detection/silero-v6.2.1.onnx",
    "missing",
  ],
  [
    "corrupt model",
    "dist/assets/speech-detection/silero-v6.2.1.onnx",
    "corrupt",
  ],
  [
    "missing runtime",
    "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
    "missing",
  ],
  [
    "corrupt runtime",
    "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
    "corrupt",
  ],
  ["mismatched engine", "node_modules/onnxruntime-web/package.json", "version"],
])(
  "fails explicitly for %s",
  (_name, file, damage) =>
    checkFixture((fixture) => {
      const target = path.join(fixture, file);
      if (damage === "missing") rmSync(target);
      else if (damage === "version")
        writeFileSync(
          target,
          readFileSync(target, "utf8").replace('"1.30.0"', '"1.29.0"'),
        );
      else writeFileSync(target, "corrupt packaging fixture");
      const result = run(fixture);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Speech runtime smoke failed:");
      expect(result.stderr).not.toContain("Unknown option");
    }),
  60000,
);
