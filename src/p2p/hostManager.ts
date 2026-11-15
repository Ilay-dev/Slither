import {
  clampBotCount,
  createRoomConfig,
  createWorld,
  type InternalWorld,
  respawnExistingSnake,
  serializeWorld,
  setSnakeInput,
  spawnSnake,
  stepWorld,
  syncBotCount,
} from '../../shared/gameEngine.ts';
import {
  DEFAULT_BOT_COUNT,
  MAX_HUMAN_PLAYERS,
  SNAKE_COLORS,
  SNAKE_COLOR_LIST,
  type ClientRoomState,
  type PublicLobbyPlayer,
  type RoomActionResponse,
  type RoomConfig,
  type RoomPhase,
  type SessionCredentials,
  type SnakeColorId,
  type WorldSnapshot,
} from '../../shared/types.ts';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function secureRandomInt(min: number, max: number): number {
  const range = max - min;
  if (range <= 0) return min;
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return min + (buf[0] % range);
}

export function generateBrowserRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_ALPHABET[secureRandomInt(0, ROOM_ALPHABET.length)];
  }
  return code;
}

export interface InternalLobbyPlayer {
  id: string;
  name: string;
  colorId: SnakeColorId;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  reconnectToken: string;
  socketId: string | null;
  bestScore: number;
  kills: number;
}

export interface BrowserSlitherRoom {
  code: string;
  phase: RoomPhase;
  config: RoomConfig;
  hostId: string;
  players: InternalLobbyPlayer[];
  countdownSeconds: number | null;
  countdownTimer: ReturnType<typeof setInterval> | null;
  simTimer: ReturnType<typeof setInterval> | null;
  lastStepAt: number;
  simSubTick: number;
  world: InternalWorld | null;
}

export type PeerSendFn = (peerId: string, state: ClientRoomState) => void;
export type PeerKickFn = (peerId: string, reason: string) => void;

export class BrowserHostManager {
  public readonly room: BrowserSlitherRoom;
  private onBroadcast: PeerSendFn;
  private onKicked: PeerKickFn;

  constructor(
    roomCode: string,
    hostName: string,
    hostColorId: SnakeColorId = 'white',
    initialBotCount: number = DEFAULT_BOT_COUNT,
    onBroadcast: PeerSendFn,
    onKicked: PeerKickFn
  ) {
    this.onBroadcast = onBroadcast;
    this.onKicked = onKicked;

    const config = createRoomConfig(initialBotCount);
    const hostId = globalThis.crypto.randomUUID();
    const safeColor = hostColorId in SNAKE_COLORS ? hostColorId : 'white';

    const host: InternalLobbyPlayer = {
      id: hostId,
      name: this.sanitizeName(hostName),
      colorId: safeColor,
      isHost: true,
      isReady: false,
      connected: true,
      disconnectedAt: null,
      reconnectToken: globalThis.crypto.randomUUID(),
      socketId: 'HOST_LOCAL',
      bestScore: 50,
      kills: 0,
    };

    this.room = {
      code: roomCode,
      phase: 'lobby',
      config,
      hostId,
      players: [host],
      countdownSeconds: null,
      countdownTimer: null,
      simTimer: null,
      lastStepAt: Date.now(),
      simSubTick: 0,
      world: null,
    };
  }

  public getHostPlayerId(): string {
    return this.room.hostId;
  }

  public destroy(): void {
    this.clearCountdown();
    this.stopLoops();
  }

  private sanitizeName(rawName: string): string {
    const cleaned = rawName.trim().replace(/\s+/g, ' ').slice(0, 18);
    return cleaned || 'Spieler';
  }

  private uniqueName(baseName: string): string {
    const existing = new Set(this.room.players.map((p) => p.name.toLowerCase()));
    if (!existing.has(baseName.toLowerCase())) return baseName;
    for (let i = 2; i <= 20; i++) {
      const candidate = `${baseName.slice(0, 14)} (${i})`;
      if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return `${baseName.slice(0, 12)}-${secureRandomInt(10, 99)}`;
  }

  private clearCountdown(): void {
    if (this.room.countdownTimer) {
      clearInterval(this.room.countdownTimer);
      this.room.countdownTimer = null;
    }
    this.room.countdownSeconds = null;
  }

  private stopLoops(): void {
    if (this.room.simTimer) {
      clearInterval(this.room.simTimer);
      this.room.simTimer = null;
    }
  }

  private buildPublicPlayers(): PublicLobbyPlayer[] {
    return this.room.players.map((p) => ({
      id: p.id,
      name: p.name,
      colorId: p.colorId,
      isHost: p.isHost,
      isReady: p.isReady,
      connected: p.connected,
      bestScore: p.bestScore,
      kills: p.kills,
    }));
  }

  public broadcast(
    precomputedSnapshot?: WorldSnapshot | null,
    options?: { localOnly?: boolean }
  ): void {
    const publicPlayers = this.buildPublicPlayers();
    const worldSnap =
      precomputedSnapshot !== undefined
        ? precomputedSnapshot
        : this.room.phase === 'playing' && this.room.world
          ? serializeWorld(this.room.world)
          : null;

    for (const player of this.room.players) {
      if (!player.socketId || !player.connected) continue;
      if (options?.localOnly && player.socketId !== 'HOST_LOCAL') continue;

      const state: ClientRoomState = {
        roomCode: this.room.code,
        phase: this.room.phase,
        myPlayerId: player.id,
        hostId: this.room.hostId,
        config: { ...this.room.config },
        players: publicPlayers,
        countdownSeconds: this.room.countdownSeconds,
        world: worldSnap,
      };
      this.onBroadcast(player.socketId, state);
    }
  }

  public serializeForPlayer(playerId: string): ClientRoomState {
    return {
      roomCode: this.room.code,
      phase: this.room.phase,
      myPlayerId: playerId,
      hostId: this.room.hostId,
      config: { ...this.room.config },
      players: this.buildPublicPlayers(),
      countdownSeconds: this.room.countdownSeconds,
      world:
        this.room.phase === 'playing' && this.room.world
          ? serializeWorld(this.room.world)
          : null,
    };
  }

  private findPlayerByPeer(peerId: string): InternalLobbyPlayer | undefined {
    return this.room.players.find((p) => p.socketId === peerId);
  }

  public joinGuest(
    peerId: string,
    rawName: string,
    preferredColorId?: SnakeColorId
  ): RoomActionResponse {
    if (this.room.players.length >= MAX_HUMAN_PLAYERS) {
      return {
        ok: false,
        error: `Dieser Room ist voll (maximal ${MAX_HUMAN_PLAYERS} Spieler).`,
      };
    }

    const existing = this.findPlayerByPeer(peerId);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      this.broadcast();
      return {
        ok: true,
        credentials: {
          roomCode: this.room.code,
          playerId: existing.id,
          reconnectToken: existing.reconnectToken,
        },
      };
    }

    const playerId = globalThis.crypto.randomUUID();
    const reconnectToken = globalThis.crypto.randomUUID();
    const name = this.uniqueName(this.sanitizeName(rawName));

    const usedColors = new Set(this.room.players.map((p) => p.colorId));
    const fallbackColor =
      SNAKE_COLOR_LIST.find((c) => !usedColors.has(c.id))?.id ??
      SNAKE_COLOR_LIST[this.room.players.length % SNAKE_COLOR_LIST.length].id;
    const colorId =
      preferredColorId && preferredColorId in SNAKE_COLORS ? preferredColorId : fallbackColor;

    const newPlayer: InternalLobbyPlayer = {
      id: playerId,
      name,
      colorId,
      isHost: false,
      isReady: this.room.phase === 'playing',
      connected: true,
      disconnectedAt: null,
      reconnectToken,
      socketId: peerId,
      bestScore: 50,
      kills: 0,
    };

    this.room.players.push(newPlayer);

    if (this.room.phase === 'playing' && this.room.world) {
      this.room.world.snakes.push(
        spawnSnake(this.room.world, {
          id: newPlayer.id,
          name: newPlayer.name,
          isBot: false,
          colorId: newPlayer.colorId,
          bestScore: newPlayer.bestScore,
          totalKills: newPlayer.kills,
        })
      );
    } else {
      this.clearCountdown();
    }

    this.broadcast();

    return {
      ok: true,
      credentials: { roomCode: this.room.code, playerId, reconnectToken },
    };
  }

  public rejoinGuest(peerId: string, creds: SessionCredentials): RoomActionResponse {
    if (creds.roomCode.trim().toUpperCase() !== this.room.code) {
      return { ok: false, error: 'Falscher Room-Code.' };
    }

    const player = this.room.players.find(
      (p) => p.id === creds.playerId && p.reconnectToken === creds.reconnectToken
    );
    if (!player) {
      return { ok: false, error: 'Sitzung abgelaufen.' };
    }

    player.socketId = peerId;
    player.connected = true;
    player.disconnectedAt = null;

    if (this.room.phase === 'playing' && this.room.world) {
      const hasSnake = this.room.world.snakes.some((s) => s.id === player.id);
      if (!hasSnake) {
        this.room.world.snakes.push(
          spawnSnake(this.room.world, {
            id: player.id,
            name: player.name,
            isBot: false,
            colorId: player.colorId,
            bestScore: player.bestScore,
            totalKills: player.kills,
          })
        );
      }
    }

    this.broadcast();
    return { ok: true, credentials: creds };
  }

  public handlePeerDisconnect(peerId: string): void {
    const player = this.findPlayerByPeer(peerId);
    if (!player) return;

    if (this.room.phase === 'lobby') {
      this.removePlayerInternal(player.id);
      return;
    }

    player.connected = false;
    player.disconnectedAt = Date.now();
    if (this.room.world) {
      const snake = this.room.world.snakes.find((s) => s.id === player.id);
      if (snake) {
        snake.wantBoost = false;
      }
    }
    this.broadcast();
  }

  public leaveGuest(peerId: string): RoomActionResponse {
    const player = this.findPlayerByPeer(peerId);
    if (!player) return { ok: true };
    this.removePlayerInternal(player.id);
    return { ok: true };
  }

  private removePlayerInternal(playerId: string): void {
    const idx = this.room.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;

    this.room.players.splice(idx, 1);
    if (this.room.world) {
      this.room.world.snakes = this.room.world.snakes.filter((s) => s.id !== playerId);
    }

    if (this.room.phase === 'lobby') {
      this.clearCountdown();
      this.evaluateAutoStart();
    }

    this.broadcast();
  }

  public handlePlayerInput(peerId: string, angle: number, boosting: boolean): void {
    if (this.room.phase !== 'playing' || !this.room.world) return;
    const player = this.findPlayerByPeer(peerId);
    if (!player) return;
    setSnakeInput(this.room.world, player.id, angle, boosting);
  }

  public handleAction(
    peerId: string,
    action: string,
    payload?: Record<string, unknown>
  ): RoomActionResponse {
    switch (action) {
      case 'room:toggle_ready':
        return this.toggleReady(peerId);
      case 'room:set_config': {
        const botCount = Number(payload?.botCount);
        return this.setConfig(peerId, botCount);
      }
      case 'room:set_color': {
        const colorId = String(payload?.colorId ?? '') as SnakeColorId;
        return this.setPlayerColor(peerId, colorId);
      }
      case 'room:start_now':
        return this.startNowByHost(peerId);
      case 'room:remove_player': {
        const targetPlayerId = String(payload?.targetPlayerId ?? '');
        return this.removePlayerByHost(peerId, targetPlayerId);
      }
      case 'room:return_to_lobby':
        return this.returnToLobby(peerId);
      case 'room:leave':
        return this.leaveGuest(peerId);
      case 'game:respawn':
        return this.respawnPlayer(peerId);
      default:
        return { ok: false, error: 'Unbekannte Aktion.' };
    }
  }

  public toggleReady(peerId: string): RoomActionResponse {
    const player = this.findPlayerByPeer(peerId);
    if (!player) return { ok: false, error: 'Nicht im Room.' };
    if (this.room.phase !== 'lobby') {
      return { ok: false, error: 'Nur in der Lobby verfügbar.' };
    }

    player.isReady = !player.isReady;
    this.evaluateAutoStart();
    this.broadcast();
    return { ok: true };
  }

  public setConfig(peerId: string, botCount: number): RoomActionResponse {
    const player = this.findPlayerByPeer(peerId);
    if (!player || player.id !== this.room.hostId) {
      return { ok: false, error: 'Nur der Host kann die Bot-Anzahl ändern.' };
    }
    if (!Number.isFinite(botCount)) {
      return { ok: false, error: 'Ungültige Bot-Anzahl.' };
    }

    const cleanBots = clampBotCount(botCount);
    this.room.config = createRoomConfig(cleanBots);

    if (this.room.phase === 'playing' && this.room.world) {
      syncBotCount(this.room.world, cleanBots);
    }

    this.broadcast();
    return { ok: true };
  }

  public setPlayerColor(peerId: string, colorId: SnakeColorId): RoomActionResponse {
    const player = this.findPlayerByPeer(peerId);
    if (!player) return { ok: false, error: 'Nicht im Room.' };
    if (!(colorId in SNAKE_COLORS)) {
      return { ok: false, error: 'Ungültige Farbe.' };
    }

    player.colorId = colorId;
    if (this.room.world) {
      const snake = this.room.world.snakes.find((s) => s.id === player.id);
      if (snake) snake.colorId = colorId;
    }

    this.broadcast();
    return { ok: true };
  }

  public startNowByHost(peerId: string): RoomActionResponse {
    const player = this.findPlayerByPeer(peerId);
    if (!player || player.id !== this.room.hostId) {
      return { ok: false, error: 'Nur der Host kann sofort starten.' };
    }
    if (this.room.phase !== 'lobby') {
      return { ok: false, error: 'Arena läuft bereits.' };
    }
    this.clearCountdown();
    this.startNewMatch();
    return { ok: true };
  }

  public removePlayerByHost(peerId: string, targetPlayerId: string): RoomActionResponse {
    const player = this.findPlayerByPeer(peerId);
    if (!player || player.id !== this.room.hostId) {
      return { ok: false, error: 'Nur der Host darf Spieler entfernen.' };
    }
    if (targetPlayerId === player.id) {
      return { ok: false, error: 'Du kannst dich nicht selbst entfernen.' };
    }
    const target = this.room.players.find((p) => p.id === targetPlayerId);
    if (!target) return { ok: false, error: 'Spieler nicht gefunden.' };
    if (target.socketId) {
      this.onKicked(target.socketId, 'Du wurdest vom Host aus dem Room entfernt.');
    }
    this.removePlayerInternal(target.id);
    return { ok: true };
  }

  public returnToLobby(peerId: string): RoomActionResponse {
    const player = this.findPlayerByPeer(peerId);
    if (!player || player.id !== this.room.hostId) {
      return { ok: false, error: 'Nur der Host kann in die Lobby zurückkehren.' };
    }
    if (this.room.phase === 'lobby') {
      return { ok: false, error: 'Du bist bereits in der Lobby.' };
    }

    this.clearCountdown();
    this.stopLoops();
    this.room.phase = 'lobby';
    this.room.world = null;
    for (const p of this.room.players) {
      p.isReady = false;
    }
    this.broadcast(null);
    return { ok: true };
  }

  public respawnPlayer(peerId: string): RoomActionResponse {
    if (this.room.phase !== 'playing' || !this.room.world) {
      return { ok: false, error: 'Keine aktive Arena.' };
    }
    const player = this.findPlayerByPeer(peerId);
    if (!player) return { ok: false, error: 'Spieler nicht gefunden.' };

    let snake = this.room.world.snakes.find((s) => s.id === player.id);
    if (!snake) {
      snake = spawnSnake(this.room.world, {
        id: player.id,
        name: player.name,
        isBot: false,
        colorId: player.colorId,
        bestScore: player.bestScore,
        totalKills: player.kills,
      });
      this.room.world.snakes.push(snake);
    } else if (!snake.alive) {
      snake.colorId = player.colorId;
      respawnExistingSnake(this.room.world, snake);
    }

    this.broadcast();
    return { ok: true };
  }

  private evaluateAutoStart(): void {
    if (this.room.phase !== 'lobby') return;

    const allReady =
      this.room.players.length >= 1 &&
      this.room.players.every((p) => p.isReady && p.connected);

    if (!allReady) {
      this.clearCountdown();
      return;
    }
    if (this.room.countdownTimer) return;

    this.room.countdownSeconds = 2;
    this.room.countdownTimer = setInterval(() => {
      const stillReady =
        this.room.players.length >= 1 &&
        this.room.players.every((p) => p.isReady && p.connected);
      if (!stillReady) {
        this.clearCountdown();
        this.broadcast();
        return;
      }
      if (this.room.countdownSeconds !== null && this.room.countdownSeconds > 1) {
        this.room.countdownSeconds -= 1;
        this.broadcast();
      } else {
        this.clearCountdown();
        this.startNewMatch();
      }
    }, 1000);
  }

  public startNewMatch(): void {
    this.clearCountdown();
    this.stopLoops();

    this.room.phase = 'playing';
    this.room.world = createWorld(
      this.room.config,
      this.room.players.map((p) => ({
        id: p.id,
        name: p.name,
        colorId: p.colorId,
        bestScore: p.bestScore,
        totalKills: p.kills,
      }))
    );
    this.room.lastStepAt = Date.now();
    this.room.simSubTick = 0;

    // Unified 60 Hz authoritative physics loop (no beat-frequency timer drift)
    this.room.simTimer = setInterval(() => {
      if (this.room.phase !== 'playing' || !this.room.world) return;
      const now = Date.now();
      const dt = Math.max(8, Math.min(45, now - this.room.lastStepAt));
      this.room.lastStepAt = now;
      stepWorld(this.room.world, dt);

      // Sync persistent stats back to lobby players
      for (const p of this.room.players) {
        const s = this.room.world.snakes.find((sn) => sn.id === p.id);
        if (s) {
          p.bestScore = Math.max(p.bestScore, s.bestScore);
          p.kills = s.totalKills;
        }
      }

      this.room.simSubTick += 1;
      const hasRemoteGuests = this.room.players.some(
        (p) => p.socketId && p.socketId !== 'HOST_LOCAL' && p.connected
      );
      const sendToGuests = hasRemoteGuests && this.room.simSubTick % 2 === 0;
      const snap = serializeWorld(this.room.world);
      this.broadcast(snap, { localOnly: !sendToGuests });
    }, 16);

    this.broadcast();
  }
}

