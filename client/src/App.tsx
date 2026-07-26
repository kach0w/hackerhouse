/**
 * Top-level wiring: owns which view is showing, runs the transitions, and is
 * the only place that emits room:enter / room:leave.
 *
 * `view` is deliberately client-authoritative. The server's `state` field is
 * the truth for *other people*, but during a transition we're mid-fade and the
 * local view has to lead the server by a beat — so we drive rendering from
 * local state and tell the server at the right moment.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';

import { VoiceControls } from './components/VoiceControls';
import { SocketProvider, useSocket } from './hooks/useSocket';
import { AgentDoneCharacter } from './world/AgentDoneCharacter';
import { Lounge } from './world/Lounge';
import { Room } from './world/Room';
import type { LoungeStage } from './world/LoungeStage';
import type { RoomStage } from './world/RoomStage';
import { TransitionRunner, type Phase, type View } from './world/transitions';

import './ui.css';

function House() {
  const { selfId, self, connected, usingMock, agentDone, clearAgentDone, enterRoom, leaveRoom } =
    useSocket();

  // Dev shortcut: `?view=room` boots straight into your room with the terminal
  // already down, so you can iterate on the Room without walking there each
  // reload. Builder C in particular shouldn't have to cross the lounge to see
  // a terminal change.
  const bootView = new URLSearchParams(window.location.search).get('view') === 'room';

  const [view, setView] = useState<View>(bootView ? 'room' : 'lounge');
  const [phase, setPhase] = useState<Phase>('idle');
  const [terminalVisible, setTerminalVisible] = useState(bootView);
  const [expanded, setExpanded] = useState(false);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  const loungeStage = useRef<LoungeStage | null>(null);
  const roomStage = useRef<RoomStage | null>(null);
  const overlay = useRef<HTMLDivElement>(null);

  const onLoungeReady = useCallback((s: LoungeStage | null) => {
    loungeStage.current = s;
  }, []);
  const onRoomReady = useCallback((s: RoomStage | null) => {
    roomStage.current = s;
  }, []);

  const runner = useMemo(
    () =>
      new TransitionRunner({
        getLoungeStage: () => loungeStage.current,
        getRoomStage: () => roomStage.current,
        setPhase,
        setView,
        setTerminalVisible,
        fade: (opacity, ms) =>
          new Promise<void>((resolve) => {
            const el = overlay.current;
            if (!el) return resolve();
            gsap.to(el, {
              opacity,
              duration: ms / 1000,
              ease: 'power2.inOut',
              onComplete: () => resolve(),
            });
          }),
        onEnterRoom: (roomId) => {
          setActiveRoomId(roomId);
          enterRoom(roomId);
        },
        onLeaveRoom: (roomId) => {
          leaveRoom(roomId);
          setActiveRoomId(null);
        },
      }),
    [enterRoom, leaveRoom],
  );

  const goToRoom = useCallback(
    (roomId: string) => {
      clearAgentDone();
      void runner.goToRoom(roomId, roomId === selfId);
    },
    [runner, selfId, clearAgentDone],
  );

  const goToLounge = useCallback(() => {
    setExpanded(false);
    void runner.goToLounge(activeRoomId ?? selfId);
  }, [runner, activeRoomId, selfId]);

  // The dev shortcut skips the transition, so tell the server we're in the room
  // — otherwise presence still says 'lounge' and no avatar renders at the desk.
  // Gated on `self` appearing in presence, not just on selfId: React runs child
  // effects before parent ones, so this fires before SocketProvider has even
  // emitted `join` — and the server drops a room:enter from an unknown user.
  const bootEntered = useRef(false);
  useEffect(() => {
    if (!bootView || bootEntered.current || !self) return;
    bootEntered.current = true;
    setActiveRoomId(selfId);
    enterRoom(selfId);
  }, [bootView, self, selfId, enterRoom]);

  const showMessenger = view === 'lounge' && !!agentDone && phase === 'idle';

  return (
    <div className="house">
      {view === 'lounge' ? (
        <Lounge onStageReady={onLoungeReady} onGoToRoom={goToRoom} />
      ) : (
        <Room
          roomId={activeRoomId ?? selfId}
          onStageReady={onRoomReady}
          onLeave={goToLounge}
          terminalVisible={terminalVisible}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((v) => !v)}
        />
      )}

      {view === 'lounge' && (
        <div className="hud hud-topright">
          <VoiceControls channel="lounge" />
        </div>
      )}

      {showMessenger && (
        <AgentDoneCharacter onAccept={() => goToRoom(selfId)} onDecline={clearAgentDone} />
      )}

      <div className="fade-overlay" ref={overlay} />

      <div className={`status-strip${view === 'room' ? ' is-room' : ''}`}>
        <span className={`status-dot${connected ? ' is-on' : ''}`} />
        <span>{self?.name ?? '…'}</span>
        {usingMock && <span className="status-mock">mock server</span>}
        {phase !== 'idle' && <span className="status-phase">{phase}</span>}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SocketProvider>
      <House />
    </SocketProvider>
  );
}
