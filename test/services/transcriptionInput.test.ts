/** @jest-environment node */
import { Readable } from "node:stream";
import { withTranscriptionInput } from "../../src/services/transcriptionInput";
const mockOpen = jest.fn();
jest.mock("node:fs", () => ({
  createReadStream: (...args: unknown[]) => mockOpen(...args),
}));
test("a completed provider response still owns its input until actual stream close", async () => {
  let close!: () => void;
  const stream = new Readable({
    read() {},
    destroy(_error, done) {
      close = () => done();
    },
  });
  mockOpen.mockReturnValueOnce(stream);
  let settled = false;
  const task = withTranscriptionInput(
    "synthetic",
    async () => "provider response",
  ).then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(stream.destroyed).toBe(true);
  expect(stream.closed).toBe(false);
  expect(settled).toBe(false);
  close();
  await expect(task).resolves.toBe("provider response");
  expect(stream.closed).toBe(true);
});
