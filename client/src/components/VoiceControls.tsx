/**
 * Builder D — black-box voice UI for Builder B to mount.
 *
 * Props contract (do not reach into internals):
 *   identity      — current user's userId
 *   voiceRoom     — "lounge" | `room-${roomId}`
 *   serverHttpUrl — Express base, e.g. http://localhost:3001
 *
 * Room swaps: pass a new `voiceRoom` when presence.state changes (B can derive
 * from A's presence:update). This component tears down the old LiveKitRoom
 * and connects to the new one via React key — never two rooms at once.
 *
 * Requires client deps (see CROSSTALK.md Builder D pins):
 *   @livekit/components-react, @livekit/components-styles, livekit-client
 */
import { useEffect, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  useLocalParticipant,
} from '@livekit/components-react';
import '@livekit/components-styles';

export interface VoiceControlsProps {
  identity: string;
  voiceRoom: string;
  serverHttpUrl: string;
}

type TokenPayload = { token: string; url: string };

async function fetchVoiceToken(
  serverHttpUrl: string,
  identity: string,
  room: string,
): Promise<TokenPayload> {
  const res = await fetch(`${serverHttpUrl.replace(/\/$/, '')}/voice/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, room }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`voice token failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<TokenPayload>;
}

function MuteToggle() {
  const { localParticipant } = useLocalParticipant();
  const muted = localParticipant?.isMicrophoneEnabled === false;

  return (
    <button
      type="button"
      onClick={() => {
        void localParticipant?.setMicrophoneEnabled(muted);
      }}
      aria-pressed={muted}
    >
      {muted ? 'Unmute' : 'Mute'}
    </button>
  );
}

function PeerCount() {
  const participants = useParticipants();
  // includes local
  return <span>{participants.length} in voice</span>;
}

function VoiceSession({
  token,
  url,
}: {
  token: string;
  url: string;
}) {
  return (
    <LiveKitRoom
      token={token}
      serverUrl={url}
      connect
      audio
      video={false}
      style={{ display: 'contents' }}
    >
      <RoomAudioRenderer />
      <div className="voice-controls">
        <MuteToggle />
        <PeerCount />
      </div>
    </LiveKitRoom>
  );
}

export function VoiceControls({ identity, voiceRoom, serverHttpUrl }: VoiceControlsProps) {
  const [creds, setCreds] = useState<TokenPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCreds(null);
    setError(null);

    fetchVoiceToken(serverHttpUrl, identity, voiceRoom)
      .then((payload) => {
        if (!cancelled) setCreds(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [identity, voiceRoom, serverHttpUrl]);

  if (error) {
    return <div className="voice-controls voice-controls--error">Voice: {error}</div>;
  }
  if (!creds) {
    return <div className="voice-controls">Voice connecting…</div>;
  }

  // key forces full remount on lounge↔room swap (one LiveKit room at a time)
  return (
    <VoiceSession
      key={`${identity}:${voiceRoom}`}
      token={creds.token}
      url={creds.url}
    />
  );
}

export default VoiceControls;
