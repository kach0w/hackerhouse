/**
 * Top-level wiring: owns which view is showing, runs the transitions, and is
 * the only place that emits room:enter / room:leave.
 *
 * `view` is deliberately client-authoritative. The server's `state` field is
 * the truth for *other people*, but during a transition we're mid-fade and the
 * local view has to lead the server by a beat — so we drive rendering from
 * local state and tell the server at the right moment.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import gsap from 'gsap';

import { Jukebox } from './components/Jukebox';
import { VoiceControls } from './components/VoiceControls';
import { SocketProvider, useSocket } from './hooks/useSocket';
import {
  notificationPermission,
  requestNotificationPermission,
  usePushNotifications,
} from './hooks/usePushNotifications';
import { AgentDoneCharacter } from './world/AgentDoneCharacter';
import { Lounge } from './world/Lounge';
import { Room } from './world/Room';
import type { LoungeStage } from './world/LoungeStage';
import type { RoomStage } from './world/RoomStage';
import { TransitionRunner, type Phase, type View } from './world/transitions';

import './ui.css';

function House() {
  const {
    selfId,
    self,
    connected,
    usingMock,
    httpBase,
    connectError,
    agentDone,
    clearAgentDone,
    enterRoom,
    leaveRoom,
    jukebox,
    skipTrack,
    users,
    rooms,
  } = useSocket();

  usePushNotifications({ selfId, agentDone, rooms, users });

  const [notifPermission, setNotifPermission] = useState(notificationPermission());
  const toggleNotifications = useCallback(() => {
    void requestNotificationPermission().then(setNotifPermission);
  }, []);

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

  // `view` always starts at 'lounge' — but if a reconnect (page refresh, brief
  // network drop) restores presence with state === 'room', rendering the
  // lounge anyway leaves you invisible there (LoungeStage only shows
  // state === 'lounge' users) AND permanently deadlocks the next transition:
  // scriptedWalk waits on an avatar that was never added to the lounge stage,
  // so its promise never resolves and `runner.busy` never clears. Snap
  // straight to the correct view instead of defaulting to a stale one.
  const syncedInitialView = useRef(false);
  useEffect(() => {
    if (bootView || syncedInitialView.current || !self) return;
    syncedInitialView.current = true;
    if (self.state === 'room' && self.roomId) {
      setActiveRoomId(self.roomId);
      setView('room');
      setTerminalVisible(true);
    }
  }, [bootView, self]);

  // Visitors don't own the room they're standing in — if the owner heads back
  // to the lounge, staying behind means watching an empty desk. Follow them
  // out automatically. `goToLounge` is a no-op while another transition is
  // already running, so this can't double-fire mid-animation.
  useEffect(() => {
    if (view !== 'room' || !activeRoomId || activeRoomId === selfId) return;
    const owner = users.find((u) => u.userId === activeRoomId);
    if (owner && owner.state !== 'room') {
      goToLounge();
    }
  }, [view, activeRoomId, selfId, users, goToLounge]);

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

      {/*
        Per D's request: voice room swaps are keyed off the `voiceRoom` prop
        only — D remounts internally on change. We do NOT also fire a callback
        from the transition state machine; one signal, as agreed.
      */}
      {view === 'lounge' && !usingMock && (
        <div className="hud hud-topright">
          <VoiceControls identity={selfId} voiceRoom="lounge" serverHttpUrl={httpBase} />
        </div>
      )}

      {view === 'lounge' && !usingMock && (
        <div className="hud hud-bottomright">
          <Jukebox jukebox={jukebox} onSkip={skipTrack} />
        </div>
      )}

      {showMessenger && (
        <AgentDoneCharacter onAccept={() => goToRoom(selfId)} onDecline={clearAgentDone} />
      )}

      <div className="fade-overlay" ref={overlay} />

      <div className={`status-strip${view === 'room' ? ' is-room' : ''}`}>
        <span className={`status-dot${connected ? ' is-on' : ''}`} />
        <span>{self?.name ?? '…'}</span>
        {notifPermission !== 'unsupported' && notifPermission !== 'granted' && (
          <button
            className="status-notif-btn"
            title={
              notifPermission === 'denied'
                ? 'Notifications blocked — allow them in your browser settings'
                : 'Get notified even when this tab is in the background'
            }
            onClick={toggleNotifications}
            disabled={notifPermission === 'denied'}
          >
            🔔 enable notifications
          </button>
        )}
        {usingMock && <span className="status-mock">mock server</span>}
        {!usingMock && connectError && (
          <span className="status-error">no server at {httpBase} — {connectError}</span>
        )}
        {phase !== 'idle' && <span className="status-phase">{phase}</span>}
      </div>
    </div>
  );
}

/**
 * First-visit name entry. `?name=` still works as a bypass (fake test users,
 * bot scripts), and a returning browser skips straight past this since
 * `useSocket`'s identity is the same localStorage key — set it here once and
 * `resolveIdentity` picks it up when SocketProvider mounts.
 */
function NameGate({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [value, setValue] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    requestNotificationPermission(); // must be a real click, not a page-load call
    onSubmit(trimmed);
  };

  return (
    <div className="name-gate">
      <form className="name-gate-panel" onSubmit={submit}>
        <div className="name-gate-title">HACKER HOUSE</div>
        <p className="name-gate-sub">What should we call you?</p>
        <input
          className="name-gate-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="your name"
          maxLength={24}
          autoFocus
        />
        <button className="btn btn-primary" type="submit" disabled={!value.trim()}>
          Join the house
        </button>
      </form>
    </div>
  );
}

function useStoredName(): [string | null, (name: string) => void] {
  const [name, setNameState] = useState<string | null>(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('name');
    return fromQuery ?? localStorage.getItem('hh.name');
  });

  const setName = useCallback((n: string) => {
    localStorage.setItem('hh.name', n);
    setNameState(n);
  }, []);

  return [name, setName];
}

export default function App() {
  const [name, setName] = useStoredName();

  if (!name) {
    return <NameGate onSubmit={setName} />;
  }

  return (
    <SocketProvider>
      <House />
    </SocketProvider>
  );
}
