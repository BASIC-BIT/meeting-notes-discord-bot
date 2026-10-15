import { createReadStream, type ReadStream } from "node:fs";

/** The SDK response does not prove its local upload stream has closed. */
export async function withTranscriptionInput<T>(
  filePath: string,
  request: (file: ReadStream) => Promise<T>,
): Promise<T> {
  const file = createReadStream(filePath);
  let readError: Error | undefined;
  file.on("error", (error) => {
    readError = error;
  });
  const closed = new Promise<void>((resolve) => {
    file.once("close", resolve);
  });
  let result: T;
  try {
    result = await request(file);
  } finally {
    file.destroy();
    await closed;
  }
  if (readError) throw readError;
  return result;
}
