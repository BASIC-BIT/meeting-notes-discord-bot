const fs = require("node:fs");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../..");
const audioPath = path.join(root, "src/audio.ts");
const source = ts.createSourceFile(
  audioPath,
  fs.readFileSync(audioPath, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const names = new Set(["getVoiceSubscriptions", "clearVoiceSubscription"]);
const declarations = source.statements.filter(
  (node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text),
);
if (declarations.length !== names.size)
  throw new Error("Missing production teardown functions");
const transpile = (code) =>
  ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const helperPath = path.join(root, "src/utils/disposeVoiceStream.ts");
const helperModule = { exports: {} };
if (fs.existsSync(helperPath)) {
  new Function(
    "require",
    "exports",
    transpile(fs.readFileSync(helperPath, "utf8")),
  )(require, helperModule.exports);
}
const voiceSubscriptions = new WeakMap();
const clear = new Function(
  "voiceSubscriptions",
  "disposeVoiceStream",
  `${transpile(declarations.map((node) => node.getText(source)).join("\n"))}\nreturn clearVoiceSubscription;`,
)(voiceSubscriptions, helperModule.exports.disposeVoiceStream);

const opusStream = new PassThrough();
const decoder = new PassThrough();
opusStream.pipe(decoder);
const onError = () => {};
opusStream.on("error", onError);
decoder.on("error", onError);
const state = {
  opusStream,
  decoder,
  decodedStream: decoder,
  ownedListenerCleanups: new Map([
    [opusStream, [() => opusStream.removeListener("error", onError)]],
    [decoder, [() => decoder.removeListener("error", onError)]],
  ]),
};
const meeting = {
  connection: {
    receiver: { subscriptions: new Map([["synthetic", opusStream]]) },
  },
};
voiceSubscriptions.set(meeting, new Map([["synthetic", state]]));
const failing = process.argv[2] === "pending-decoder" ? decoder : opusStream;
failing.destroy(new Error("synthetic queued fault"));
clear(meeting, "synthetic");
clear(meeting, "synthetic");
setImmediate(() => process.stdout.write("teardownCompleted=true\n"));
