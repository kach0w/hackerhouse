/**
 * Real OS-level notifications (the Notification API), not just the in-app
 * agent-done character — those only help while the tab is actually focused.
 * Permission has to be requested from a genuine user gesture (browsers
 * silently ignore/block a bare page-load request), so `requestPermission`
 * is exported separately for the caller to wire to a click handler.
 */
import { useEffect, useRef } from 'react';
import type { RoomState, User } from '@hackerhouse/shared';

const supported = typeof window !== 'undefined' && 'Notification' in window;

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return supported ? Notification.permission : 'unsupported';
}

export function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!supported) return Promise.resolve('unsupported');
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
  return Notification.requestPermission();
}

function notify(title: string, body: string) {
  if (!supported || Notification.permission !== 'granted') return;
  // Only bother with an OS notification when you're not already looking at
  // the tab — otherwise the in-app UI (the agent-done character, the room
  // bar's visitor count) already covers it, and a redundant notification is
  // just noise.
  if (!document.hidden) return;
  new Notification(title, { body, icon: '/favicon.svg' });
}

export function usePushNotifications(params: {
  selfId: string;
  agentDone: { userId: string; roomId: string } | null;
  rooms: Map<string, RoomState>;
  users: User[];
}) {
  const { selfId, agentDone, rooms, users } = params;

  const lastAgentDoneRoomId = useRef<string | null>(null);
  useEffect(() => {
    if (!agentDone || agentDone.roomId === lastAgentDoneRoomId.current) return;
    lastAgentDoneRoomId.current = agentDone.roomId;
    notify('Your session is done', "Head back to your room? It's waiting for you.");
  }, [agentDone]);

  const prevOccupants = useRef<Set<string>>(new Set());
  useEffect(() => {
    const occupants = new Set(rooms.get(selfId)?.occupants ?? []);
    for (const id of occupants) {
      if (prevOccupants.current.has(id)) continue;
      const visitor = users.find((u) => u.userId === id);
      notify(`${visitor?.name ?? 'Someone'} is visiting your room`, 'Watching your terminal right now.');
    }
    prevOccupants.current = occupants;
  }, [rooms, selfId, users]);
}
