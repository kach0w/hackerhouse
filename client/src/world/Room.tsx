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
  const sceneRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<RoomStage | null>(null);
  const { selfId, users, rooms, setLocked, httpBase, usingMock, sessionToken } = useSocket();

  const [screen, setScreen] = useState<ScreenRect | null>(null);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [copied, setCopied] = useState(false);

  const isOwner = roomId === selfId;
  const room = rooms.get(roomId);
  const owner = users.find((u) => u.userId === roomId);

  // Pixi's init is async and can finish after the last presence update, so the
  // stage has to be handed the current occupants the moment it's ready.
  const latest = useRef({ users, selfId, roomId });
  latest.current = { users, selfId, roomId };

  const onLayout = useCallback((rect: ScreenRect) => setScreen(rect), []);

  // The existing "expand" toggle only fills the browser tab's viewport — it
  // doesn't hide browser chrome. Requesting real Fullscreen API alongside it
  // gets an actual OS-level fullscreen terminal. Esc exits fullscreen outside
  // our control, so `fullscreenchange` is what keeps `expanded` in sync then.
  const toggleFullscreen = useCallback(() => {
    // Fullscreen can be denied (embedded contexts, permissions policy, some
    // browsers) — that's fine, the CSS fill-viewport toggle below still
    // works as a fallback either way, so failures here are silent.
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      sceneRef.current?.requestFullscreen().catch(() => {});
    }
    onToggleExpanded();
  }, [onToggleExpanded]);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && expanded) onToggleExpanded();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [expanded, onToggleExpanded]);

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

  const installCmd = sessionToken
    ? `curl -fsSL ${httpBase}/agent/install.sh | bash -s -- ${sessionToken} ${httpBase} ${selfId}`
    : '';

  const copyInstallCmd = () => {
    if (!installCmd) return;
    navigator.clipboard.writeText(installCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

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
    <div className={`scene room-scene${expanded ? ' is-expanded' : ''}`} ref={sceneRef}>
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

        <button
          className="monitor-fullscreen-btn"
          title={expanded ? 'Exit fullscreen' : 'Fullscreen the terminal'}
          onClick={toggleFullscreen}
        >
          {expanded ? '🗗' : '⛶'}
        </button>
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

          {isOwner && sessionToken && (
            <button
              className="btn btn-icon"
              title="Run your terminal on your own machine, under your own claude login"
              onClick={() => setShowAgentPanel((v) => !v)}
            >
              🖥
            </button>
          )}

          <button className="btn btn-primary" onClick={onLeave}>
            Head to the lounge
          </button>
        </div>
      </div>

      {showAgentPanel && isOwner && sessionToken && (
        <div className="agent-panel">
          <div className="agent-panel-title">run this on your own machine</div>
          <p className="agent-panel-sub">
            One-time install. After this, your room's terminal runs on your machine under
            your own <code>claude</code> login — no command needed again, even after a
            reboot.
          </p>
          <code className="agent-panel-cmd">{installCmd}</code>
          <div className="agent-panel-actions">
            <button className="btn btn-primary" onClick={copyInstallCmd}>
              {copied ? 'copied!' : 'copy command'}
            </button>
            <button className="btn" onClick={() => setShowAgentPanel(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
