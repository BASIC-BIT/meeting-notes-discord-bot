import { createHash } from "node:crypto";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const manifestPath = new URL(
  "../../assets/speech-detection/manifest.json",
  import.meta.url,
);
const modelSha256 =
  "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const { values } = parseArgs({
    options: {
      "runtime-dir": { type: "string" },
      model: { type: "string" },
    },
  });
  if (!values["runtime-dir"] || !values.model) {
    throw new Error(
      "Usage: runtime-smoke.mjs --runtime-dir <node_modules-directory> --model <onnx-path>",
    );
  }
  // Validate model bytes before importing the engine or creating a session.
  const model = await readFile(path.resolve(values.model));
  if (sha256(model) !== modelSha256) throw new Error("Model SHA-256 mismatch");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest.model.sha256 !== modelSha256 ||
    manifest.model.bytes !== model.length
  ) {
    throw new Error("Model manifest mismatch");
  }
  const runtimeRoot = path.resolve(values["runtime-dir"], "onnxruntime-web");
  const runtimePackage = JSON.parse(
    await readFile(path.join(runtimeRoot, "package.json"), "utf8"),
  );
  if (
    runtimePackage.name !== "onnxruntime-web" ||
    runtimePackage.version !== "1.30.0" ||
    manifest.runtime.version !== runtimePackage.version
  ) {
    throw new Error("Runtime version mismatch");
  }
  for (const asset of manifest.runtime.assets) {
    const bytes = await readFile(path.join(runtimeRoot, asset.file));
    if (sha256(bytes) !== asset.sha256 || bytes.length !== asset.bytes) {
      throw new Error(`Runtime asset SHA-256 mismatch: ${asset.file}`);
    }
  }
  const require = createRequire(path.join(runtimeRoot, "package.json"));
  const ort = require(path.join(runtimeRoot, "dist/ort.node.min.js"));
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = pathToFileURL(
    path.join(runtimeRoot, "dist") + path.sep,
  ).href;
  const started = performance.now();
  const session = await ort.InferenceSession.create(new Uint8Array(model), {
    executionProviders: ["wasm"],
  });
  try {
    let state = new ort.Tensor("float32", new Float32Array(256), [2, 1, 128]);
    const context = new Float32Array(64);
    let silenceProbability = 0;
    // Carry recurrent state and the trailing 64 samples across ten 512-sample frames.
    for (let frame = 0; frame < 10; frame++) {
      const samples = new Float32Array(576);
      samples.set(context);
      const result = await session.run({
        input: new ort.Tensor("float32", samples, [1, 576]),
        state,
        sr: new ort.Tensor("int64", BigInt64Array.of(16000n), []),
      });
      const probability = result.output.data[0];
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new Error("Invalid speech probability");
      }
      state = result.stateN;
      if (
        state.dims.join(",") !== "2,1,128" ||
        !state.data.every(Number.isFinite)
      ) {
        throw new Error("Invalid recurrent state");
      }
      context.set(samples.subarray(512));
      silenceProbability = Math.max(silenceProbability, probability);
    }
    if (silenceProbability >= 0.35)
      throw new Error("Silence probability exceeds rejection ceiling");
    process.stdout.write(
      JSON.stringify({
        engine: runtimePackage.name,
        engineVersion: runtimePackage.version,
        nodeVersion: process.version,
        modelSha256,
        silenceProbability,
        stateShape: [...state.dims],
        frames: 10,
        wasmThreads: ort.env.wasm.numThreads,
        startupAndInferenceMs: performance.now() - started,
      }) + "\n",
    );
  } finally {
    await session.release();
  }
}

main().catch((error) => {
  process.stderr.write(`Speech runtime smoke failed: ${error.message}\n`);
  process.exitCode = 1;
});
