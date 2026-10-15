/** @jest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import ts from "typescript";

function loadConnectionBoundary(send: () => Promise<void>) {
  const file = path.join(__dirname, "../src/meetings.ts");
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const registrations: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(source) === "connection" &&
      node.expression.name.text === "on" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "error"
    )
      registrations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(registrations).toHaveLength(1);
  const connection = new EventEmitter();
  const warn = jest.fn();
  const textChannel = { send: jest.fn(send) };
  const context = vm.createContext({
    connection,
    textChannel,
    isAutoRecording: false,
    meeting: { meetingId: "synthetic-meeting" },
    console: { warn, error: jest.fn() },
  });
  vm.runInContext(
    ts.transpileModule(registrations[0].getText(source), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  return { connection, textChannel, warn };
}

test("a rejected connection-error notification is consumed once without another notification", async () => {
  const { connection, textChannel, warn } = loadConnectionBoundary(async () => {
    throw new Error("private notification detail");
  });
  connection.emit("error", new Error("synthetic connection fault"));
  await new Promise((resolve) => setImmediate(resolve));
  expect(textChannel.send).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls).toEqual([
    [
      "Voice error notification failed:",
      {
        stage: "connection-error-notification",
        meetingId: "synthetic-meeting",
      },
    ],
  ]);
});

test("a delivered connection-error notification does not log a failure", async () => {
  const { connection, textChannel, warn } = loadConnectionBoundary(
    async () => {},
  );
  connection.emit("error", new Error("synthetic connection fault"));
  await new Promise((resolve) => setImmediate(resolve));
  expect(textChannel.send).toHaveBeenCalledTimes(1);
  expect(warn).not.toHaveBeenCalled();
});

test("initial meeting setup still awaits and rejects a failed subscription", async () => {
  const file = path.join(__dirname, "../src/meetings.ts");
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "initializeMeeting",
  );
  if (!declaration) throw new Error("Missing meeting initializer");
  const failure = new Error("synthetic initial subscription failure");
  const connection = new EventEmitter();
  Object.assign(connection, { receiver: {} });
  const context = vm.createContext({
    joinVoiceChannel: () => connection,
    config: { liveVoice: { mode: "off" } },
    MEETING_START_REASONS: { MANUAL_COMMAND: "manual" },
    DEFAULT_PREFIX_MODE: "none",
    uuidv4: () => "synthetic-meeting",
    openOutputFile: jest.fn(),
    buildParticipantSnapshot: async () => undefined,
    subscribeToUserVoice: async () => {
      throw failure;
    },
  });
  vm.runInContext(
    ts.transpileModule(declaration.getText(source).replace(/^export /, ""), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  context.options = {
    guild: { id: "synthetic-guild" },
    textChannel: { id: "synthetic-text" },
    voiceChannel: {
      id: "synthetic-voice",
      members: [{ user: { id: "synthetic-user" } }],
    },
  };
  await expect(
    vm.runInContext("initializeMeeting(options)", context),
  ).rejects.toBe(failure);
});
