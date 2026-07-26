export type UserState = 'lounge' | 'room';

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface User {
  userId: string;
  name: string;
  state: UserState;
  x: number;
  y: number;
  facing: Facing;
  roomId: string | null; // set when state === 'room'
}

export interface RoomState {
  roomId: string; // == owner's userId
  ownerId: string;
  locked: boolean;
  occupants: string[]; // userIds currently visiting (excludes owner)
}

export interface JukeboxTrack {
  videoId: string; // YouTube video id
  title: string;
  durationSec: number;
}

export interface JukeboxState {
  playlist: JukeboxTrack[];
  index: number;
  startedAt: number; // server Date.now() when the current track began
}
