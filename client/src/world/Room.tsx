/**
 * The room view — a full-screen pixel room with your avatar at a desk, and the
 * real terminal embedded in the monitor they're looking at.
 *
 * The terminal is genuine DOM (Builder C's xterm component) positioned over the
 * monitor's glass, using the rect `RoomStage` reports. It is not drawn into the
 * canvas and it is not a screenshot — you can type into it. The canvas just
 * frames it.
 *
 * `<Terminal>` and `<VoiceControls>` are sealed components; this file only ever
 * passes props into them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Terminal } from '../components/Terminal';
import { VoiceControls } from '../components/VoiceControls';
import { useSocket } from '../hooks/useSocket';
import { RoomStage, type ScreenRect } from './RoomStage';

interface Props {
  roomId: string;
  /** Hands the stage up to App so transitions can drive scripted walks. */
  onStageReady: (stage: RoomStage | null) => void;
  onLeave: () => void;
  /** Drives the monitor powering on. Owned by the transition runner. */
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

  const [screen, setScreen] = useState<ScreenRect | null>(null);

  const isOwner = roomId === selfId;
  const room = rooms.get(roomId);
  const owner = users.find((u) => u.userId === roomId);

  // Pixi's init is async and can finish after the last presence update, so the
  // stage has to be handed the current occupants the moment it's ready.
  const latest = useRef({ users, selfId, roomId });
  latest.current = { users, selfId, roomId };

  const onLayout = useCallback((rect: ScreenRect) => setScreen(rect), []);

  // Builder C's Terminal refits xterm on `window.resize`. Our glass rect can
  // change without the window changing (first layout, expand toggle), and a
  // stale fit means the terminal wraps at the wrong column count. Nudging the
  // event is the least invasive fix from outside C's file — see CROSSTALK for
  // the standing request to expose an imperative refit or use a ResizeObserver.
  useEffect(() => {
    if (!screen) return;
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => cancelAnimationFrame(id);
  }, [screen?.width, screen?.height, expanded]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const stage = new RoomStage(host, { onLayout });

    stage
      .init()
      .then(() => {
        if (disposed) {
          stage.destroy();
          return;
        }
        stageRef.current = stage;
        onStageReady(stage);
        setScreen(stage.screenRect());

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
  }, [onStageReady, onLayout]);

  useEffect(() => {
    const occupants = users.filter((u) => u.state === 'room' && u.roomId === roomId);
    stageRef.current?.syncOccupants(occupants, selfId, roomId);
  }, [users, selfId, roomId]);

  const visitors = users.filter(
    (u) => u.state === 'room' && u.roomId === roomId && u.userId !== roomId,
  );

  // Expanded lifts the terminal out of the monitor to fill the viewport.
  const screenStyle = expanded
    ? undefined
    : screen
      ? {
          left: `${screen.left}px`,
          top: `${screen.top}px`,
          width: `${screen.width}px`,
          height: `${screen.height}px`,
        }
      : { display: 'none' };

  return (
    <div className={`scene room-scene${expanded ? ' is-expanded' : ''}`}>
      <div className="canvas-host" ref={hostRef} />

      <div
        className={`monitor-screen${terminalVisible ? ' is-on' : ''}`}
        style={screenStyle}
      >
        {usingMock ? (
          <div className="stub-pane">
            <code>?mock=1</code> — the in-browser mock has no PTY. Drop the flag and
            start the server to get a real terminal.
          </div>
        ) : (
          // Mount only once the glass rect is known. Mounting at zero size makes
          // xterm fit to ~1 column, which is then sent to the PTY — and `claude`
          // draws its entire UI wrapped at that width. A later resize won't
          // un-wrap output that was already emitted.
          screen && (
            <Terminal
              roomId={roomId}
              mode={isOwner ? 'owner' : 'visitor'}
              userId={selfId}
              serverUrl={httpBase}
            />
          )
        )}
      </div>

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

          <button
            className="btn btn-icon"
            title={expanded ? 'Back to the room' : 'Fill the screen with the terminal'}
            onClick={onToggleExpanded}
          >
            {expanded ? '🗗' : '🗖'}
          </button>

          <button className="btn btn-primary" onClick={onLeave}>
            Head to the lounge
          </button>
        </div>
      </div>
    </div>
  );
}
