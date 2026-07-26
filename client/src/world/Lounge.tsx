/**
 * The lounge view: a Pixi canvas plus the HUD layered over it.
 *
 * There is no movement control here by design — your avatar runs its own
 * ambient loop. The only player agency in the lounge is clicking another
 * character to visit their room, and the button to head back to your own.
 */

import { useEffect, useRef, useState } from 'react';

import { Pong } from '../games/pong/Pong';
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
  const { selfId, self, users, loungeUsers, rooms, sendMove, deniedRoomId } = useSocket();

  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pong, setPong] = useState(false);

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
      onAvatarClick: (userId) => setSelected(userId),
      onStationClick: (stationId) => {
        const station = STATIONS.find((s) => s.id === stationId);
        if (station?.minigame === 'pong') setPong(true);
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

  const selectedUser = selected ? users.find((u) => u.userId === selected) : undefined;
  const selectedRoom = selected ? rooms.get(selected) : undefined;
  const myRoom = rooms.get(selfId);

  return (
    <div className="scene">
      <div className="canvas-host" ref={hostRef} />

      <div className="hud hud-topleft">
        <div className="hud-title">THE LOUNGE</div>
        <div className="hud-sub">{loungeUsers.length} building tonight</div>
      </div>

      <div className="hud hud-bottom">
        <button className="btn btn-primary" onClick={() => onGoToRoom(selfId)}>
          Head up to my room
        </button>
        {myRoom?.locked && <span className="hud-note">your door is locked</span>}
      </div>

      {selectedUser && selectedUser.userId !== selfId && (
        <div className="popover">
          <div className="popover-name">{selectedUser.name}</div>
          <div className="popover-sub">
            {selectedRoom?.locked ? 'door is locked' : 'door is open'}
          </div>
          <div className="popover-actions">
            <button
              className="btn btn-primary"
              disabled={selectedRoom?.locked}
              onClick={() => {
                setSelected(null);
                onGoToRoom(selectedUser.userId);
              }}
            >
              Visit their room
            </button>
            <button className="btn" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {/*
        No transport passed yet, so this runs practice-vs-bot. Wiring the real
        1v1 is swapping in a SignalTransport once Builder A lands `game:signal`
        — the game and rendering code don't change. See CROSSTALK.
      */}
      {pong && (
        <Pong
          role="host"
          names={{ left: self?.name ?? 'you', right: 'bot' }}
          onClose={() => setPong(false)}
        />
      )}
    </div>
  );
}
