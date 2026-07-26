import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalClientToServer, TerminalServerToClient } from '@hackerhouse/shared';

interface TerminalProps {
  roomId: string;
  mode: 'owner' | 'visitor';
  userId: string;
  serverUrl: string; // e.g. http://localhost:3001
}

export function Terminal({ roomId, mode, userId, serverUrl }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new XTerm({ convertEol: true, fontSize: 14, theme: { background: '#111' } });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    if (containerRef.current) term.open(containerRef.current);
    fitAddon.fit();

    const socket: Socket<TerminalServerToClient, TerminalClientToServer> = io(
      `${serverUrl}/terminal`,
      { auth: { userId } }
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

    const handleResize = () => {
      fitAddon.fit();
      if (mode === 'owner') {
        socket.emit('terminal:resize', { roomId, cols: term.cols, rows: term.rows });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.disconnect();
      term.dispose();
    };
  }, [roomId, mode, userId, serverUrl]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
