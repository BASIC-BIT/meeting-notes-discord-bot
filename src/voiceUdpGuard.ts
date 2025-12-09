import { VoiceUDPSocket } from "@discordjs/voice";

// Guard against ERR_SOCKET_DGRAM_NOT_RUNNING caused by keepAlive firing after the UDP
// socket has already been closed (e.g., Discord region hop, task ENI tear-down).
// Swallow that specific error, destroy the socket to clear the keepAlive interval,
// and rethrow anything else.
const originalSend = VoiceUDPSocket.prototype.send;

VoiceUDPSocket.prototype.send = function patchedSend(
  this: VoiceUDPSocket,
  buffer: Buffer,
) {
  try {
    return originalSend.call(this, buffer);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | { code?: string }).code;
    if (code === "ERR_SOCKET_DGRAM_NOT_RUNNING") {
      try {
        this.destroy();
      } catch {
        // Best effort cleanup; ignore secondary errors.
      }
      return;
    }

    throw err;
  }
};
