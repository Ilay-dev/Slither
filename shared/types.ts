export const MAX_HUMAN_PLAYERS = 8;
export const MIN_BOT_COUNT = 0;
export const MAX_BOT_COUNT = 30;
export const DEFAULT_BOT_COUNT = 20;
export const ARENA_RADIUS = 2600;

export type SnakeColorId =
  | 'white'
  | 'emerald'
  | 'crimson'
  | 'electric'
  | 'amber'
  | 'violet'
  | 'cyan'
  | 'rose';

export interface SnakeColorMeta {
  id: SnakeColorId;
  labelDe: string;
  primary: string;
  secondary: string;
  glow: string;
}

export const SNAKE_COLORS: Record<SnakeColorId, SnakeColorMeta> = {
  white: {
    id: 'white',
    labelDe: 'Silber',
    primary: '#ffffff',
    secondary: '#a1a1aa',
    glow: 'rgba(255,255,255,0.45)',
  },
  emerald: {
    id: 'emerald',
    labelDe: 'Smaragd',
    primary: '#10b981',
    secondary: '#047857',
    glow: 'rgba(16,185,129,0.45)',
  },
  crimson: {
    id: 'crimson',
    labelDe: 'Karmesin',
    primary: '#ef4444',
    secondary: '#b91c1c',
    glow: 'rgba(239,68,68,0.45)',
  },
  electric: {
    id: 'electric',
    labelDe: 'Kobalt',
    primary: '#3b82f6',
    secondary: '#1d4ed8',
    glow: 'rgba(59,130,246,0.45)',
  },
  amber: {
    id: 'amber',
    labelDe: 'Bernstein',
    primary: '#f59e0b',
    secondary: '#b45309',
    glow: 'rgba(245,158,11,0.45)',
  },
  violet: {
    id: 'violet',
    labelDe: 'Violett',
    primary: '#8b5cf6',
    secondary: '#6d28d9',
    glow: 'rgba(139,92,246,0.45)',
  },
  cyan: {
    id: 'cyan',
    labelDe: 'Cyan',
    primary: '#06b6d4',
    secondary: '#0e7490',
    glow: 'rgba(6,182,212,0.45)',
  },
  rose: {
    id: 'rose',
    labelDe: 'Neon-Rose',
    primary: '#ec4899',
    secondary: '#be185d',
    glow: 'rgba(236,72,153,0.45)',
  },
};

export const SNAKE_COLOR_LIST: SnakeColorMeta[] = Object.values(SNAKE_COLORS);

export type RoomPhase = 'lobby' | 'playing';

export interface RoomConfig {
  botCount: number;
  arenaRadius: number;
}

export interface PublicLobbyPlayer {
  id: string;
  name: string;
  colorId: SnakeColorId;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
  bestScore: number;
  kills: number;
}

export interface KillEvent {
  id: string;
  killerName: string;
  victimName: string;
  victimMass: number;
  timestamp: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  isBot: boolean;
  colorId: SnakeColorId;
  length: number;
  kills: number;
  alive: boolean;
}

export interface CompactSnakeSnapshot {
  id: string;
  name: string;
  isBot: boolean;
  colorId: SnakeColorId;
  alive: boolean;
  score: number;
  kills: number;
  angle: number;
  targetAngle: number;
  speed: number;
  radius: number;
  boosting: boolean;
  spawnProtected: boolean;
  respawnInMs: number;
  lastRunScore: number;
  lastRunKills: number;
  eliminatedBy: string | null;
  pts: number[];
}

/**
 * Compact orb tuple: [id, x, y, value, colorIdx]
 */
export type CompactOrb = [number, number, number, number, number];

export interface WorldSnapshot {
  tick: number;
  timestamp: number;
  arenaRadius: number;
  snakes: CompactSnakeSnapshot[];
  orbs: CompactOrb[];
  leaderboard: LeaderboardEntry[];
  killFeed: KillEvent[];
}

export interface ClientRoomState {
  roomCode: string;
  phase: RoomPhase;
  myPlayerId: string;
  hostId: string;
  config: RoomConfig;
  players: PublicLobbyPlayer[];
  countdownSeconds: number | null;
  world: WorldSnapshot | null;
}

export interface SessionCredentials {
  roomCode: string;
  playerId: string;
  reconnectToken: string;
}

export interface RoomActionResponse {
  ok: boolean;
  error?: string;
  credentials?: SessionCredentials;
}

