import { VoiceConnection } from "@discordjs/voice";

// Patch Voice UDP sockets lazily (class is not exported). Attach once per connection and
// wrap send to swallow ERR_SOCKET_DGRAM_NOT_RUNNING which surfaces after region hops / ENI teardown.
const guardFlag = Symbol("udpGuardApplied");

type GuardedUdp = {
  send: (buffer: Buffer) => unknown;
  destroy: () => void;
  [guardFlag]?: boolean;
};

function patchUdpSend(udp: GuardedUdp) {
  if (udp[guardFlag]) return;
  const originalSend = udp.send.bind(udp);
  udp.send = (buffer: Buffer) => {
    try {
      return originalSend(buffer);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | { code?: string }).code;
      if (code === "ERR_SOCKET_DGRAM_NOT_RUNNING") {
        try {
          udp.destroy();
        } catch {
          // best-effort cleanup
        }
        return;
      }

      throw err;
    }
  };
  udp[guardFlag] = true;
}

const originalConfigureNetworking =
  VoiceConnection.prototype.configureNetworking;

VoiceConnection.prototype.configureNetworking =
  function patchedConfigureNetworking(
    ...args: Parameters<VoiceConnection["configureNetworking"]>
  ) {
    type GuardableConnection = VoiceConnection & {
      _udpGuardListenerAttached?: boolean;
    };

    const self = this as GuardableConnection;

    if (!self._udpGuardListenerAttached) {
      this.on(
        "stateChange",
        (
          _oldState: unknown,
          newState: { networking?: { state?: { udp?: GuardedUdp } } },
        ) => {
          const udp = newState?.networking?.state?.udp;
          if (udp && typeof udp.send === "function") {
            patchUdpSend(udp);
          }
        },
      );
      self._udpGuardListenerAttached = true;
    }

    return originalConfigureNetworking.apply(this, args);
  };
