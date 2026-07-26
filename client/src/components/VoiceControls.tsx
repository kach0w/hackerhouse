/**
 * ⚠️ PLACEHOLDER — Builder D owns this file. Overwrite it wholesale.
 *
 * Builder B mounts this in both the Lounge and the Room and passes the channel
 * the user should currently be connected to:
 *
 *     <VoiceControls channel="lounge" />
 *     <VoiceControls channel={`room-${roomId}`} />
 *
 * That prop is B's answer to coordination point #4 in the engineering plan:
 * rather than VoiceControls subscribing to presence or reaching into B's
 * transition state machine, B tells it which room to be in and re-renders it on
 * every Lounge↔Room transition. One signal, one direction, no shared state.
 *
 * D: keep the prop, do the connect/disconnect internally, and the swap happens
 * for free.
 */

interface Props {
  channel: string;
}

export function VoiceControls({ channel }: Props) {
  return (
    <div className="voice-stub" title="placeholder — Builder D wires LiveKit here">
      <span className="voice-stub-dot" />
      <span className="voice-stub-label">{channel}</span>
      <span className="voice-stub-tag">voice stub</span>
    </div>
  );
}
