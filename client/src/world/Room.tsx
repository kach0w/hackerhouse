/**
 * The room view: a real terminal filling the top 3/4, your pixel room in the
 * bottom 1/4.
 *
 * `<Terminal>` (Builder C) and `<VoiceControls>` (Builder D) are mounted here
 * as sealed components — this file only ever passes props into them.
 */

import { useEffect, useRef } from 'react';

import { Terminal } from '../components/Terminal';
import { VoiceControls } from '../components/VoiceControls';
import { useSocket } from '../hooks/useSocket';
import { RoomStage } from './RoomStage';

interface Props {
  roomId: string;
  /** Hands the stage up to App so transitions can drive scripted walks. */
  onStageReady: (stage: RoomStage | null) => void;
  onLeave: () => void;
  /** Drives the terminal's drop-in / retract. Owned by the transition runner. */
  terminalVisible: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export function Room({
  roomId,
  onStageReady,
  onLeave,
  terminalVisible,
  expanded,
  onToggleExpanded,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<RoomStage | null>(null);
  const { selfId, users, rooms, setLocked, httpBase, usingMock } = useSocket();

  const isOwner = roomId === selfId;
  const room = rooms.get(roomId);
  const owner = users.find((u) => u.userId === roomId);

  // Pixi's init is async and can finish after the last presence update, so the
  // stage has to be handed the current occupants the moment it's ready.
  const latest = useRef({ users, selfId, roomId });
  latest.current = { users, selfId, roomId };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const stage = new RoomStage(host);

    stage
      .init()
      .then(() => {
        if (disposed) {
          stage.destroy();
          return;
        }
        stageRef.current = stage;
        onStageReady(stage);

        const { users: u, selfId: s, roomId: r } = latest.current;
        stage.syncOccupants(
          u.filter((x) => x.state === 'room' && x.roomId === r),
          s,
          r,
        );
      })
      .catch((err) => {
        console.error('[RoomStage] init failed', err);
      });

    return () => {
      disposed = true;
      onStageReady(null);
      stageRef.current?.cancelScript();
      stageRef.current?.destroy();
      stageRef.current = null;
    };
  }, [onStageReady]);

  useEffect(() => {
    const occupants = users.filter((u) => u.state === 'room' && u.roomId === roomId);
    stageRef.current?.syncOccupants(occupants, selfId, roomId);
  }, [users, selfId, roomId]);

  const visitors = users.filter(
    (u) => u.state === 'room' && u.roomId === roomId && u.userId !== roomId,
  );

  return (
    <div className={`scene room-scene${expanded ? ' is-expanded' : ''}`}>
      <div className={`terminal-pane${terminalVisible ? ' is-in' : ''}`}>
        {usingMock ? (
          <div className="stub-pane">
            no VITE_SERVER_URL — running against the in-browser mock, so there's no
            PTY to attach to. Point at Builder A&apos;s server to get a real terminal.
          </div>
        ) : (
          <Terminal
            roomId={roomId}
            mode={isOwner ? 'owner' : 'visitor'}
            userId={selfId}
            serverUrl={httpBase}
          />
        )}
      </div>

      <div className="room-pane">
        <div className="canvas-host" ref={hostRef} />

        <div className="room-bar">
          <div className="room-bar-left">
            <span className="room-title">
              {isOwner ? 'your room' : `${owner?.name ?? roomId}'s room`}
            </span>
            {visitors.length > 0 && (
              <span className="room-visitors">
                {visitors.length} watching: {visitors.map((v) => v.name).join(', ')}
              </span>
            )}
            {!isOwner && <span className="room-readonly">read-only</span>}
          </div>

          <div className="room-bar-right">
            {!usingMock && (
              <VoiceControls
                identity={selfId}
                voiceRoom={`room-${roomId}`}
                serverHttpUrl={httpBase}
              />
            )}

            {isOwner && (
              <button
                className={`btn btn-icon${room?.locked ? ' is-on' : ''}`}
                title={room?.locked ? 'Room locked — nobody can enter' : 'Room open to visitors'}
                onClick={() => setLocked(!room?.locked)}
              >
                {room?.locked ? '🔒' : '🔓'}
              </button>
            )}

            <button className="btn btn-icon" title="Expand terminal" onClick={onToggleExpanded}>
              {expanded ? '🗗' : '🗖'}
            </button>

            <button className="btn btn-primary" onClick={onLeave}>
              Head to the lounge
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
