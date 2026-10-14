/** @jest-environment node */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { z } from "zod";

const root = path.resolve(__dirname, "../..");
const silence = path.join(
  root,
  "test/fixtures/speech-detection/tune-silence.wav",
);
const yes = path.join(root, "test/fixtures/speech-detection/yes-quiet.wav");
const outputSchema = z.object({
  warm: z.literal(true),
  coldStartMs: z.number().nonnegative(),
  silence: z.literal("non_speech"),
  speech: z.literal("speech"),
  repeated: z.literal(true),
  unchanged: z.literal(true),
});
function removeFixture(fixture: string): void {
  const resolved = path.resolve(fixture);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith("chronote-vad-")
  )
    throw Error("Unexpected cleanup path");
  rmSync(resolved, { recursive: true, force: true });
}
function prepareCompiledFixture(): string {
  const fixture = mkdtempSync(path.join(tmpdir(), "chronote-vad-compiled-"));
  try {
    const config = ts.readConfigFile(
      path.join(root, "tsconfig.json"),
      ts.sys.readFile,
    );
    if (config.error)
      throw Error(
        ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
      );
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    // Both runtime entry points are roots; TypeScript follows every transitive import.
    // Ambient declarations participate in typechecking but do not emit UI modules.
    const program = ts.createProgram({
      rootNames: [
        path.join(root, "src/services/speechDetectionService.ts"),
        path.join(root, "src/services/speechDetectionWorker.ts"),
        ...parsed.fileNames.filter((file) => file.endsWith(".d.ts")),
      ],
      options: {
        ...parsed.options,
        types: [...new Set(["node", ...(parsed.options.types ?? [])])],
        rootDir: path.join(root, "src"),
        outDir: path.join(fixture, "dist"),
        noEmit: false,
        noEmitOnError: true,
        incremental: false,
      },
    });
    const diagnostics = [
      ...parsed.errors,
      ...ts.getPreEmitDiagnostics(program),
    ];
    const host = {
      getCanonicalFileName: (file: string) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    };
    if (diagnostics.length)
      throw Error(ts.formatDiagnostics(diagnostics, host));
    const emitted = program.emit();
    if (emitted.emitSkipped || emitted.diagnostics.length) {
      throw Error(
        `Speech fixture compilation failed\n${ts.formatDiagnostics(emitted.diagnostics, host)}`,
      );
    }
    cpSync(
      path.join(root, "assets/speech-detection"),
      path.join(fixture, "dist/assets/speech-detection"),
      { recursive: true },
    );
    return fixture;
  } catch (error) {
    removeFixture(fixture);
    throw error;
  }
}
let compiledFixture: string | undefined;
beforeAll(() => {
  compiledFixture = prepareCompiledFixture();
}, 60000);
afterAll(() => {
  if (compiledFixture) removeFixture(compiledFixture);
});
function withCompiledFixture(check: (fixture: string) => void): void {
  if (!compiledFixture) throw Error("Compiled fixture was not prepared");
  const fixture = mkdtempSync(path.join(tmpdir(), "chronote-vad-case-"));
  try {
    cpSync(path.join(compiledFixture, "dist"), path.join(fixture, "dist"), {
      recursive: true,
    });
    expect(existsSync(path.join(fixture, "src"))).toBe(false);
    expect(existsSync(path.join(fixture, "tsconfig.json"))).toBe(false);
    check(fixture);
  } finally {
    removeFixture(fixture);
  }
}
function run(entry: string, cwd: string, source: boolean) {
  const script = `const {readFileSync}=require('node:fs'); const {performance}=require('node:perf_hooks'); const {getSpeechDetector,shutdownSpeechDetector}=require(${JSON.stringify(entry)}); (async()=>{await shutdownSpeechDetector();const d=getSpeechDetector();const start=performance.now();const warm=await d.warm();const coldStartMs=performance.now()-start;try{if(!warm)throw Error('worker not ready');const wav=readFileSync(${JSON.stringify(silence)});const before=Buffer.from(wav);const s=await d.assess(wav,'slow');const a=await d.assess(readFileSync(${JSON.stringify(yes)}),'slow');const b=await d.assess(readFileSync(${JSON.stringify(yes)}),'slow');process.stdout.write(JSON.stringify({warm,coldStartMs,silence:s.kind,speech:a.kind,repeated:JSON.stringify(a)===JSON.stringify(b),unchanged:before.equals(wav)})+'\\n');}finally{await shutdownSpeechDetector();}})().catch(e=>{console.error(e);process.exitCode=1;});`;
  return spawnSync(
    process.execPath,
    [
      ...(source ? ["-r", require.resolve("ts-node/register")] : []),
      "-e",
      script,
    ],
    {
      cwd,
      encoding: "utf8",
      timeout: 45000,
      env: {
        ...process.env,
        NODE_PATH: path.join(root, "node_modules"),
        TS_NODE_TRANSPILE_ONLY: "true",
      },
    },
  );
}
it("starts source worker locally, preserves WAV, and resets recurrent state per clip", () => {
  const result = run(
    path.join(root, "src/services/speechDetectionService.ts"),
    root,
    true,
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const output = outputSchema.parse(JSON.parse(result.stdout));
  expect(output.coldStartMs).toBeLessThan(30000);
  console.info("source worker evidence", output);
}, 60000);
it(
  "starts a dist-only worker compiled from current sources with no source tree",
  () =>
    withCompiledFixture((fixture) => {
      const result = run(
        path.join(fixture, "dist/services/speechDetectionService.js"),
        fixture,
        false,
      );
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const output = outputSchema.parse(JSON.parse(result.stdout));
      expect(output.coldStartMs).toBeLessThan(30000);
      console.info("dist-only worker evidence", output);
    }),
  60000,
);
it.each(["missing", "corrupt"])(
  "returns unavailable for %s owned model assets",
  (damage) =>
    withCompiledFixture((fixture) => {
      const model = path.join(
        fixture,
        "dist/assets/speech-detection/silero-v6.2.1.onnx",
      );
      if (damage === "missing") rmSync(model);
      else {
        const bytes = readFileSync(model);
        bytes[0] ^= 1;
        writeFileSync(model, bytes);
      }
      const script = `const {getSpeechDetector,shutdownSpeechDetector}=require(${JSON.stringify(path.join(fixture, "dist/services/speechDetectionService.js"))});(async()=>{const d=getSpeechDetector();try{const warm=await d.warm();const assessment=await d.assess(Uint8Array.of(1),'fast');process.stdout.write(JSON.stringify({warm,assessment}));}finally{await shutdownSpeechDetector();}})().catch(e=>{console.error(e);process.exitCode=1;});`;
      const result = spawnSync(process.execPath, ["-e", script], {
        cwd: fixture,
        encoding: "utf8",
        timeout: 45000,
        env: {
          ...process.env,
          NODE_PATH: path.join(root, "node_modules"),
          TS_NODE_TRANSPILE_ONLY: "true",
        },
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        warm: false,
        assessment: { kind: "unavailable", reason: "not_ready" },
      });
    }),
  60000,
);
it(
  "withholds ready when first inference fails in a dist-only IPC worker",
  () =>
    withCompiledFixture((fixture) => {
      const assets = path.join(fixture, "dist/assets/speech-detection");
      const runtime = path.join(fixture, "node_modules/onnxruntime-web");
      mkdirSync(path.join(runtime, "dist"), { recursive: true });
      writeFileSync(
        path.join(runtime, "package.json"),
        JSON.stringify({
          name: "onnxruntime-web",
          version: "1.30.0",
          main: "dist/ort.node.min.js",
        }),
      );
      // Only this isolated failure-boundary fixture replaces the engine. Real success tests use the verified bundle.
      const fakeRuntime = `exports.env={wasm:{}};exports.Tensor=class {constructor(type,data,dims){this.type=type;this.data=data;this.dims=dims;}};exports.InferenceSession={create:async()=>({run:async()=>{require('node:fs').writeFileSync(${JSON.stringify(path.join(fixture, "inference-ran"))},'ran');throw Error('fixture inference failure');},release:async()=>{}})};`;
      const fixtureManifest = z
        .object({
          runtime: z
            .object({
              assets: z.array(
                z.object({
                  file: z.string(),
                  bytes: z.number(),
                  sha256: z.string(),
                }),
              ),
            })
            .passthrough(),
        })
        .passthrough()
        .parse(
          JSON.parse(readFileSync(path.join(assets, "manifest.json"), "utf8")),
        );
      for (const asset of fixtureManifest.runtime.assets) {
        const bytes = Buffer.from(
          asset.file.endsWith(".js") ? fakeRuntime : "fixture-only-placeholder",
        );
        writeFileSync(path.join(runtime, asset.file), bytes);
        asset.bytes = bytes.length;
        asset.sha256 = createHash("sha256").update(bytes).digest("hex");
      }
      writeFileSync(
        path.join(assets, "manifest.json"),
        JSON.stringify(fixtureManifest),
      );
      const script = `const {getSpeechDetector,shutdownSpeechDetector}=require(${JSON.stringify(path.join(fixture, "dist/services/speechDetectionService.js"))});(async()=>{try{process.stdout.write(JSON.stringify({warm:await getSpeechDetector().warm()}));}finally{await shutdownSpeechDetector();}})().catch(e=>{console.error(e);process.exitCode=1;});`;
      const result = spawnSync(process.execPath, ["-e", script], {
        cwd: fixture,
        encoding: "utf8",
        timeout: 45000,
        env: { ...process.env, NODE_PATH: path.join(root, "node_modules") },
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({ warm: false });
      expect(readFileSync(path.join(fixture, "inference-ran"), "utf8")).toBe(
        "ran",
      );
    }),
  60000,
);
