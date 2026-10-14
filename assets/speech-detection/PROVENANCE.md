# Speech runtime assets

The Silero v6.2.1 ONNX model is checked in here with its upstream MIT license. Its SHA-256 is pinned in manifest.json and the smoke script. The cached model and a fresh download from the exact upstream tag both matched that pin on October 13, 2026.

The ONNX Runtime Web package is the local runtime bundle. Its exact package version, registry tarball integrity and hashes for the executed Node entrypoint and matching WASM/.mjs pair are in manifest.json. The runtime assets live in node_modules/onnxruntime-web/dist and are installed from yarn.lock into the image. They are not fetched from a CDN during inference. The upstream ONNX Runtime MIT license is included here because the published npm package does not include a LICENSE file at its root.

Run the packaging smoke from the repository root:

```sh
node scripts/speech-detection/runtime-smoke.mjs --runtime-dir node_modules --model assets/speech-detection/silero-v6.2.1.onnx
```

The smoke verifies model and runtime file hashes before importing the engine, selects single-threaded WASM, and runs ten silence frames with the upstream 16 kHz / 512-sample / 64-context protocol and [2,1,128] recurrent state. It checks finite probabilities, the silence ceiling and finite state values. This is engine compatibility evidence; worker budgets and speech classification are later checkpoints.

Primary sources: [versioned model](https://github.com/snakers4/silero-vad/blob/v6.2.1/src/silero_vad/data/silero_vad.onnx), [Silero protocol](https://github.com/snakers4/silero-vad/blob/v6.2.1/src/silero_vad/utils_vad.py), [Silero license](https://github.com/snakers4/silero-vad/blob/v6.2.1/LICENSE), [ONNX Runtime license](https://github.com/microsoft/onnxruntime/blob/v1.30.0/LICENSE), and [ONNX runtime environment flags](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html).
