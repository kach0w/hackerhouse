/**
 * The lounge view: a Pixi canvas plus the HUD layered over it.
 *
 * There is no movement control here by design — your avatar runs its own
 * ambient loop. Avatars in the scene are purely decorative — the only way to
 * visit anyone's room is the sidebar roster, not clicking a character. That
 * also covers owners currently in their own room, whose avatar isn't in the
 * lounge scene at all while they're in there.
 */

import { useEffect, useRef, useState } from 'react';

import { Pong } from '../games/pong/Pong';
import { Snake } from '../games/snake/Snake';
import { useSocket } from '../hooks/useSocket';
import { LoungeStage } from './LoungeStage';
import { STATIONS } from './stations';

interface Props {
  /** Hands the stage up to App so the transition can drive scripted walks. */
  onStageReady: (stage: LoungeStage | null) => void;
  /** Ask App to run the Lounge→Room transition into this room. */
  onGoToRoom: (roomId: string) => void;
}

export function Lounge({ onStageReady, onGoToRoom }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<LoungeStage | null>(null);
  const { selfId, self, users, loungeUsers, rooms, sendMove, deniedRoomId, activeRooms } =
    useSocket();

  // Everyone but yourself, each with a room you can visit regardless of
  // whether they're currently sitting in it or out in the lounge.
  const others = users.filter((u) => u.userId !== selfId);

  const [toast, setToast] = useState<string | null>(null);
  /** Which minigame overlay is open, if any. Driven by clicking a station. */
  const [game, setGame] = useState<'pong' | 'snake' | null>(null);

  // Keep the latest callbacks and presence reachable from the Pixi loop without
  // re-creating the stage on every render.
  const sendMoveRef = useRef(sendMove);
  sendMoveRef.current = sendMove;

  // Pixi's init is async, so the stage can become ready *after* the last
  // presence update. Without replaying the latest snapshot on ready, the stage
  // sits empty until the next one — and if presence has gone quiet, forever.
  const latest = useRef({ users, selfId });
  latest.current = { users, selfId };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const stage = new LoungeStage(host, {
      onSelfMove: (x, y, facing) => sendMoveRef.current(x, y, facing),
      onStationClick: (stationId) => {
        const station = STATIONS.find((s) => s.id === stationId);
        if (station?.minigame === 'pong') setGame('pong');
        else if (station?.minigame === 'snake') setGame('snake');
      },
    });

    stage
      .init()
      .then(() => {
        if (disposed) {
          stage.destroy();
          return;
        }
        stageRef.current = stage;
        onStageReady(stage);
        stage.syncUsers(latest.current.users, latest.current.selfId);
      })
      .catch((err) => {
        console.error('[LoungeStage] init failed', err);
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
    stageRef.current?.syncUsers(users, selfId);
  }, [users, selfId]);

  useEffect(() => {
    if (!deniedRoomId) return;
    const owner = users.find((u) => u.userId === deniedRoomId);
    setToast(`${owner?.name ?? 'That room'} is locked — they're heads-down.`);
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [deniedRoomId, users]);

  const myRoom = rooms.get(selfId);

  return (
    <div className="scene">
      <div className="canvas-host" ref={hostRef} />

      <div className="hud hud-topleft">
        <div className="hud-title">THE LOUNGE</div>
        <div className="hud-sub">{loungeUsers.length} building tonight</div>
      </div>

      {others.length > 0 && (
        <div className="hud hud-left">
          <div className="room-roster-label">visit a room</div>
          <div className="room-roster">
            {others.map((u) => {
              const locked = rooms.get(u.userId)?.locked;
              const agentRunning = activeRooms.has(u.userId);
              return (
                <button
                  key={u.userId}
                  className="room-roster-item"
                  disabled={locked}
                  title={locked ? `${u.name}'s door is locked` : `Visit ${u.name}'s room`}
                  onClick={() => onGoToRoom(u.userId)}
                >
                  <span className="room-roster-name">
                    {agentRunning && <span className="room-roster-agent-dot" />}
                    {u.name}
                  </span>
                  <span className={`room-roster-status${agentRunning ? ' is-running' : ''}`}>
                    {agentRunning
                      ? 'running claude'
                      : locked
                        ? '🔒'
                        : u.state === 'room'
                          ? 'at desk →'
                          : 'in lounge →'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="hud hud-bottom">
        <button className="btn btn-primary btn-big" onClick={() => onGoToRoom(selfId)}>
          Head up to my room
        </button>
        {myRoom?.locked && <span className="hud-note">your door is locked</span>}
      </div>

      {toast && <div className="toast">{toast}</div>}

      {/*
        No transport passed, so this always runs practice-vs-bot. Wiring a
        real 1v1 is swapping in a networked transport once there's a
        `game:signal` socket event — the game and rendering code don't change.
      */}
      {game === 'pong' && (
        <Pong
          role="host"
          names={{ left: self?.name ?? 'you', right: 'bot' }}
          onClose={() => setGame(null)}
        />
      )}

      {game === 'snake' && (
        <Snake playerName={self?.name ?? 'you'} onClose={() => setGame(null)} />
      )}
    </div>
  );
}
