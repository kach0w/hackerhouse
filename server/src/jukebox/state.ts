import type { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  JukeboxState,
  JukeboxTrack,
} from '@hackerhouse/shared';
import { fetchMergePlaylist, mergeJukeboxConfigured } from './merge.js';

// Fallback if Merge isn't configured or the fetch fails — same 2010s pop jam.
const FALLBACK_PLAYLIST: JukeboxTrack[] = [
  { videoId: 'QGJuMBdaqIw', title: 'Katy Perry - Firework', durationSec: 228 },
  { videoId: 'fWNaR-rxAic', title: 'Carly Rae Jepsen - Call Me Maybe', durationSec: 211 },
  { videoId: 'iP6XpLQM2Cs', title: 'Ke$ha - TiK ToK', durationSec: 200 },
  { videoId: 'KQ6zr6kCPj8', title: 'LMFAO - Party Rock Anthem', durationSec: 260 },
  { videoId: 'nfWlot6h_JM', title: 'Taylor Swift - Shake It Off', durationSec: 219 },
  { videoId: 'ZbZSe6N_BXs', title: 'Pharrell Williams - Happy', durationSec: 240 },
  { videoId: '7PCkvCPvDXk', title: 'Meghan Trainor - All About That Bass', durationSec: 191 },
  { videoId: 'CevxZvSJLk8', title: 'Katy Perry - Roar', durationSec: 222 },
  { videoId: 'OPf0YbXqDm0', title: 'Mark Ronson ft. Bruno Mars - Uptown Funk', durationSec: 270 },
  { videoId: 'QJO3ROT-A4E', title: 'One Direction - What Makes You Beautiful', durationSec: 199 },
  { videoId: '09R8_2nJtjg', title: 'Maroon 5 - Sugar', durationSec: 236 },
];

let playlist: JukeboxTrack[] = FALLBACK_PLAYLIST;
let index = 0;
let startedAt = Date.now();

function currentState(): JukeboxState {
  return { playlist, index, startedAt };
}

function advance(io: Server<ClientToServerEvents, ServerToClientEvents>) {
  if (playlist.length === 0) return;
  index = (index + 1) % playlist.length;
  startedAt = Date.now();
  io.emit('jukebox:state', currentState());
}

function replacePlaylist(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  next: JukeboxTrack[],
) {
  if (next.length === 0) return;
  playlist = next;
  index = 0;
  startedAt = Date.now();
  io.emit('jukebox:state', currentState());
}

/** Server-authoritative playlist clock — every client derives playback position from `startedAt`. */
export function registerJukebox(io: Server<ClientToServerEvents, ServerToClientEvents>) {
  setInterval(() => {
    if (playlist.length === 0) return;
    const elapsed = (Date.now() - startedAt) / 1000;
    if (elapsed >= playlist[index].durationSec) advance(io);
  }, 1000);

  io.on('connection', (socket) => {
    socket.emit('jukebox:state', currentState());
    socket.on('jukebox:skip', () => advance(io));
  });

  if (!mergeJukeboxConfigured()) {
    console.log('[jukebox] Merge not configured — using fallback playlist');
    return;
  }

  void fetchMergePlaylist()
    .then((tracks) => {
      if (tracks.length === 0) {
        console.warn('[jukebox] Merge returned no tracks — keeping fallback');
        return;
      }
      replacePlaylist(io, tracks);
      console.log(`[jukebox] loaded ${tracks.length} tracks via Merge YouTube`);
    })
    .catch((err) => {
      console.warn('[jukebox] Merge playlist fetch failed — keeping fallback:', err);
    });
}
