import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalClientToServer, TerminalServerToClient } from '@hackerhouse/shared';

interface TerminalProps {
  roomId: string;
  /**
   * Signed session token from `join:ok`. Owner write access is gated on this
   * server-side — a claimed userId is not enough, since presence broadcasts
   * everyone's userId. Visitors can pass null and still get the read-only feed.
   */
  token: string | null;
  mode: 'owner' | 'visitor';
  userId: string;
  serverUrl: string; // e.g. http://localhost:3001
}

export function Terminal({ roomId, mode, userId, token, serverUrl }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new XTerm({ convertEol: true, fontSize: 14, theme: { background: '#111' } });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    if (containerRef.current) term.open(containerRef.current);

    const socket: Socket<TerminalServerToClient, TerminalClientToServer> = io(
      `${serverUrl}/terminal`,
      { auth: { userId, token } }
    );

    socket.on('connect', () => {
      socket.emit('terminal:join', { roomId, role: mode });
    });

    socket.on('terminal:output', ({ data }) => term.write(data));

    if (mode === 'owner') {
      term.onData((data) => socket.emit('terminal:input', { roomId, data }));
    }
    // visitor mode: no input handler attached at all, belt-and-suspenders
    // on top of the server-side enforcement, which is the real boundary.

    const fitAndSync = () => {
      fitAddon.fit();
      if (mode === 'owner') {
        socket.emit('terminal:resize', { roomId, cols: term.cols, rows: term.rows });
      }
    };

    // Fitting immediately on mount reads wrong character metrics if the
    // monospace font hasn't finished loading yet (or layout hasn't fully
    // settled) — cols/rows come out wrong and output wraps/garbles until
    // *something* triggers another fit. Gate the first one on fonts.ready
    // instead of hoping a later resize event happens to fix it.
    void document.fonts.ready.then(fitAndSync);

    // A ResizeObserver on the terminal's own container reacts to any real
    // size change (window resizing, the fullscreen/expand toggle, the
    // monitor's glass rect updating) without needing Room.tsx to dispatch
    // synthetic window 'resize' events as a workaround.
    const ro = new ResizeObserver(() => fitAndSync());
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      socket.disconnect();
      term.dispose();
    };
  }, [roomId, mode, userId, token, serverUrl]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
