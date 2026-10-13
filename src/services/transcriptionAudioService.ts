import ffmpeg from "fluent-ffmpeg";
import {
  RECORD_SAMPLE_RATE,
  TRANSCRIBE_SAMPLE_RATE,
  CHANNELS,
} from "../constants";

export function convertTranscriptionPcmToWav(
  inputFile: string,
  outputFile: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputFile)
      .inputOptions([
        "-f s16le",
        `-ar ${RECORD_SAMPLE_RATE}`,
        `-ac ${CHANNELS}`,
      ])
      .outputOptions([
        "-f wav",
        "-c:a pcm_s16le",
        `-ar ${TRANSCRIBE_SAMPLE_RATE}`,
      ])
      .on("end", () => resolve())
      .on("error", reject)
      .save(outputFile);
  });
}
