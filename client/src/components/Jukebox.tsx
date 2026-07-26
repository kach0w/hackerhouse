/**
 * Shared lounge jam — a server-authoritative "radio station" everyone in the
 * lounge hears in sync. `useSocket().jukebox` carries { playlist, index,
 * startedAt }; every client derives its own playback position from
 * `Date.now() - startedAt` rather than trusting a play/pause message, so a
 * late joiner drops in mid-song at the right spot instead of from zero.
 *
 * Real audio comes from YouTube's own IFrame player (no audio files hosted or
 * redistributed by us) — see the "audio source" decision. Browsers block
 * unmuted autoplay, so playback starts muted and a click un-mutes it.
 */
import { useEffect, useRef, useState } from 'react';

import type { JukeboxState } from '@hackerhouse/shared';

// Minimal shape of the bits of the YT IFrame API this component touches.
interface YTPlayer {
  loadVideoById(opts: { videoId: string; startSeconds: number }): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
}
interface YTPlayerConstructor {
  new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width: string | number;
      height: string | number;
      playerVars: Record<string, number>;
      events: { onReady: () => void };
    },
  ): YTPlayer;
}

declare global {
  interface Window {
    YT?: { Player: YTPlayerConstructor };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;

function loadYouTubeAPI(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT) {
      resolve();
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return apiPromise;
}

function elapsedSeconds(state: JukeboxState): number {
  return Math.max(0, (Date.now() - state.startedAt) / 1000);
}

export interface JukeboxProps {
  jukebox: JukeboxState | null;
  onSkip: () => void;
}

export function Jukebox({ jukebox, onSkip }: JukeboxProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const loadedVideoId = useRef<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);

  // Create the player once.
  useEffect(() => {
    let disposed = false;
    void loadYouTubeAPI().then(() => {
      if (disposed || !hostRef.current || !window.YT) return;
      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId: '',
        width: 120,
        height: 68,
        playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1 },
        events: { onReady: () => setReady(true) },
      });
    });
    return () => {
      disposed = true;
    };
  }, []);

  // Keep the player pinned to the server's shared timeline.
  useEffect(() => {
    if (!ready || !jukebox || !playerRef.current) return;
    const track = jukebox.playlist[jukebox.index];
    if (!track) return;
    const elapsed = elapsedSeconds(jukebox);

    if (loadedVideoId.current !== track.videoId) {
      loadedVideoId.current = track.videoId;
      playerRef.current.loadVideoById({ videoId: track.videoId, startSeconds: elapsed });
      if (muted) playerRef.current.mute();
    }

    // Correct drift (buffering, tab throttling) every 5s instead of fighting
    // the player every render.
    const drift = window.setInterval(() => {
      const p = playerRef.current;
      if (!p || !jukebox) return;
      const target = elapsedSeconds(jukebox);
      if (Math.abs(p.getCurrentTime() - target) > 2) p.seekTo(target, true);
    }, 5000);
    return () => window.clearInterval(drift);
  }, [ready, jukebox, muted]);

  const toggleMute = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isMuted()) {
      p.unMute();
      setMuted(false);
    } else {
      p.mute();
      setMuted(true);
    }
  };

  const track = jukebox?.playlist[jukebox.index];

  return (
    <div className="jukebox">
      <div className="jukebox-video" ref={hostRef} />
      <div className="jukebox-meta">
        <span className="jukebox-label">🎵 LOUNGE JAM</span>
        <span className="jukebox-title">{track?.title ?? 'tuning in…'}</span>
        <div className="jukebox-actions">
          <button className="btn btn-icon" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? '🔇' : '🔊'}
          </button>
          <button className="btn btn-icon" onClick={onSkip} title="Skip track">
            ⏭
          </button>
        </div>
      </div>
    </div>
  );
}

export default Jukebox;
