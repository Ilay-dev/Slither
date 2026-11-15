import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserHostManager } from '../src/p2p/hostManager.ts';
import type { ClientRoomState } from '../shared/types.ts';

describe('Slither BrowserHostManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('supports up to 8 human players and rejects a 9th player', () => {
    const manager = new BrowserHostManager(
      'ROOM88',
      'Host',
      'white',
      20,
      () => {},
      () => {}
    );

    for (let i = 2; i <= 8; i++) {
      const res = manager.joinGuest(`peer-${i}`, `Player${i}`);
      expect(res.ok).toBe(true);
    }
    expect(manager.room.players.length).toBe(8);

    const ninth = manager.joinGuest('peer-9', 'Player9');
    expect(ninth.ok).toBe(false);
    expect(ninth.error).toContain('8');

    manager.destroy();
  });

  it('configures up to 30 bots, auto-starts when ready, and allows live bot changes + mid-game joins', () => {
    vi.useFakeTimers();
    const captured: { host: ClientRoomState | null } = { host: null };
    const guestStates = new Map<string, ClientRoomState>();

    const manager = new BrowserHostManager(
      'SLTH42',
      'Ilay',
      'emerald',
      25,
      (peerId, state) => {
        if (peerId === 'HOST_LOCAL') captured.host = state;
        else guestStates.set(peerId, state);
      },
      () => {}
    );

    manager.broadcast();
    expect(captured.host?.config.botCount).toBe(25);

    // Clamp bot count up to max 30
    const cfgRes = manager.handleAction('HOST_LOCAL', 'room:set_config', { botCount: 45 });
    expect(cfgRes.ok).toBe(true);
    expect(captured.host?.config.botCount).toBe(30);

    // Non-host cannot change bot count
    manager.joinGuest('peer-g1', 'Freund1', 'electric');
    const guestCfg = manager.handleAction('peer-g1', 'room:set_config', { botCount: 5 });
    expect(guestCfg.ok).toBe(false);

    // Both ready -> countdown -> playing
    manager.handleAction('HOST_LOCAL', 'room:toggle_ready');
    manager.handleAction('peer-g1', 'room:toggle_ready');
    expect(captured.host?.countdownSeconds).toBe(2);

    vi.advanceTimersByTime(2200);
    expect(captured.host?.phase).toBe('playing');
    expect(captured.host?.world?.snakes.length).toBe(32); // 2 humans + 30 bots

    // Mid-game join by a 3rd human player
    const midJoin = manager.joinGuest('peer-g2', 'LateFriend', 'rose');
    expect(midJoin.ok).toBe(true);
    expect(captured.host?.players.length).toBe(3);
    expect(captured.host?.world?.snakes.length).toBe(33);

    // Live bot count adjustment while playing
    manager.handleAction('HOST_LOCAL', 'room:set_config', { botCount: 15 });
    expect(captured.host?.world?.snakes.length).toBe(18); // 3 humans + 15 bots

    // Player input & respawn flow
    manager.handlePlayerInput('HOST_LOCAL', 1.25, true);
    const hostSnake = manager.room.world!.snakes.find(
      (s) => s.id === manager.getHostPlayerId()
    )!;
    expect(hostSnake.targetAngle).toBeCloseTo(1.25, 2);
    expect(hostSnake.wantBoost).toBe(true);

    // Simulate death and respawn
    hostSnake.alive = false;
    const respawnRes = manager.handleAction('HOST_LOCAL', 'game:respawn');
    expect(respawnRes.ok).toBe(true);
    expect(hostSnake.alive).toBe(true);

    // Host returns everyone to lobby
    const backRes = manager.handleAction('HOST_LOCAL', 'room:return_to_lobby');
    expect(backRes.ok).toBe(true);
    expect(captured.host?.phase).toBe('lobby');
    expect(captured.host?.world).toBeNull();

    manager.destroy();
  });
});

