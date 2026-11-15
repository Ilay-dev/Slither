import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  BOOST_SPEED,
  BOT_RESPAWN_DELAY_MS,
  INITIAL_ORB_COUNT,
  INITIAL_SNAKE_SCORE,
  MIN_BOOST_SCORE,
  SEGMENT_SPACING,
  createRoomConfig,
  createWorld,
  getTargetSegmentCount,
  killSnake,
  serializeWorld,
  setSnakeInput,
  stepClientSnakeKinematics,
  stepWorld,
  syncBotCount,
} from '../shared/gameEngine.ts';
import { ARENA_RADIUS, MAX_BOT_COUNT } from '../shared/types.ts';

describe('Slither gameEngine', () => {
  it('initializes world with up to 8 human players, 30 bots, and ambient orbs', () => {
    const humans = Array.from({ length: 8 }, (_, idx) => ({
      id: `human-${idx + 1}`,
      name: `Spieler ${idx + 1}`,
      colorId: 'emerald' as const,
    }));
    const config = createRoomConfig(MAX_BOT_COUNT);
    const world = createWorld(config, humans);

    expect(world.snakes.length).toBe(38);
    expect(world.snakes.filter((s) => !s.isBot).length).toBe(8);
    expect(world.snakes.filter((s) => s.isBot).length).toBe(30);
    expect(world.orbs.length).toBe(INITIAL_ORB_COUNT);

    for (const s of world.snakes) {
      expect(s.alive).toBe(true);
      expect(s.score).toBe(INITIAL_SNAKE_SCORE);
      expect(s.segments.length).toBe(getTargetSegmentCount(INITIAL_SNAKE_SCORE));
      const head = s.segments[0];
      expect(Math.hypot(head.x, head.y)).toBeLessThan(ARENA_RADIUS);
    }
  });

  it('steers smoothly and keeps exact segment chain spacing during movement', () => {
    const world = createWorld(createRoomConfig(0), [
      { id: 'p1', name: 'Alex', colorId: 'white' },
    ]);
    const snake = world.snakes[0];
    snake.segments = Array.from({ length: 12 }, (_, i) => ({
      x: -i * SEGMENT_SPACING,
      y: 0,
    }));
    snake.angle = 0;
    snake.targetAngle = 0;
    snake.spawnProtectionMs = 0;

    setSnakeInput(world, 'p1', Math.PI / 2, false);
    for (let i = 0; i < 15; i++) {
      stepWorld(world, 33);
    }

    expect(snake.alive).toBe(true);
    expect(snake.angle).toBeGreaterThan(0.5);
    expect(snake.speed).toBe(BASE_SPEED);

    for (let i = 1; i < snake.segments.length; i++) {
      const prev = snake.segments[i - 1];
      const curr = snake.segments[i];
      const d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      expect(d).toBeCloseTo(SEGMENT_SPACING, 1);
    }
  });

  it('consumes nearby orbs, grows score and segments, and drops boost orbs when boosting', () => {
    const world = createWorld(createRoomConfig(0), [
      { id: 'p1', name: 'Boosty', colorId: 'cyan' },
    ]);
    const snake = world.snakes[0];
    snake.segments = Array.from({ length: 12 }, (_, i) => ({
      x: -i * SEGMENT_SPACING,
      y: 0,
    }));
    snake.angle = 0;
    snake.targetAngle = 0;
    snake.spawnProtectionMs = 0;

    // Place high-value orbs directly ahead
    world.orbs.push({ id: 9991, x: 12, y: 0, value: 40, colorIdx: 0, isLoot: true });
    world.orbs.push({ id: 9992, x: 25, y: 0, value: 40, colorIdx: 0, isLoot: true });

    stepWorld(world, 33);
    stepWorld(world, 33);
    expect(snake.score).toBeGreaterThanOrEqual(INITIAL_SNAKE_SCORE + 80);
    expect(snake.segments.length).toBeGreaterThan(12);

    const orbsBeforeBoost = world.orbs.length;
    const scoreBeforeBoost = snake.score;
    setSnakeInput(world, 'p1', 0, true);

    for (let i = 0; i < 18; i++) {
      stepWorld(world, 33);
    }

    expect(snake.boosting).toBe(true);
    expect(snake.speed).toBe(BOOST_SPEED);
    expect(snake.score).toBeLessThan(scoreBeforeBoost);
    expect(snake.score).toBeGreaterThanOrEqual(MIN_BOOST_SCORE);
    expect(world.orbs.length).toBeGreaterThan(orbsBeforeBoost);
  });

  it('blocks snake at arena wall without dealing damage', () => {
    const world = createWorld(createRoomConfig(0), [
      { id: 'p1', name: 'EdgeRunner', colorId: 'crimson' },
    ]);
    const snake = world.snakes[0];
    snake.score = 120;
    snake.segments = Array.from({ length: 20 }, (_, i) => ({
      x: ARENA_RADIUS - 15 - i * SEGMENT_SPACING,
      y: 0,
    }));
    snake.angle = 0;
    snake.targetAngle = 0;
    snake.spawnProtectionMs = 0;

    for (let i = 0; i < 10; i++) {
      stepWorld(world, 50);
    }

    expect(snake.alive).toBe(true);
    expect(snake.eliminatedBy).toBeNull();
    expect(Math.hypot(snake.segments[0].x, snake.segments[0].y)).toBeLessThanOrEqual(
      ARENA_RADIUS - snake.radius + 1e-4
    );
    expect(world.killFeed).toHaveLength(0);
  });

  it('credits kill when one snake runs head-first into another snake body', () => {
    const world = createWorld(createRoomConfig(0), [
      { id: 'attacker', name: 'Victim', colorId: 'rose' },
      { id: 'defender', name: 'Defender', colorId: 'emerald' },
    ]);
    const victim = world.snakes[0];
    const defender = world.snakes[1];

    victim.spawnProtectionMs = 0;
    defender.spawnProtectionMs = 0;

    // Defender lies horizontally across x = 0..220 at y = 0
    defender.segments = Array.from({ length: 20 }, (_, i) => ({
      x: 200 - i * SEGMENT_SPACING,
      y: 0,
    }));
    defender.angle = 0;
    defender.targetAngle = 0;

    // Victim heads straight up into defender's mid-body around (80, 0)
    victim.segments = Array.from({ length: 12 }, (_, i) => ({
      x: 80,
      y: 22 + i * SEGMENT_SPACING,
    }));
    victim.angle = -Math.PI / 2;
    victim.targetAngle = -Math.PI / 2;

    stepWorld(world, 33);

    expect(victim.alive).toBe(false);
    expect(victim.eliminatedBy).toBe('Defender');
    expect(defender.alive).toBe(true);
    expect(defender.kills).toBe(1);
    expect(defender.score).toBeGreaterThan(INITIAL_SNAKE_SCORE);
  });

  it('auto-respawns dead bots after BOT_RESPAWN_DELAY_MS and supports dynamic bot count changes', () => {
    const world = createWorld(createRoomConfig(5), [
      { id: 'p1', name: 'Host', colorId: 'white' },
    ]);
    const bot = world.snakes.find((s) => s.isBot)!;
    bot.spawnProtectionMs = 0;
    killSnake(world, bot, null, 'Test');
    expect(bot.alive).toBe(false);

    // Advance past respawn delay
    for (let elapsed = 0; elapsed < BOT_RESPAWN_DELAY_MS + 120; elapsed += 60) {
      stepWorld(world, 60);
    }
    expect(bot.alive).toBe(true);

    // Dynamically scale up to 30 bots, then down to 10
    syncBotCount(world, 30);
    expect(world.snakes.filter((s) => s.isBot).length).toBe(30);
    syncBotCount(world, 10);
    expect(world.snakes.filter((s) => s.isBot).length).toBe(10);

    const snap = serializeWorld(world);
    expect(snap.snakes.length).toBe(11);
    expect(snap.leaderboard.length).toBeLessThanOrEqual(10);
  });

  it('bot AI steers inward when close to the arena boundary', () => {
    const world = createWorld(createRoomConfig(1), []);
    const bot = world.snakes[0];
    bot.segments = Array.from({ length: 12 }, (_, i) => ({
      x: ARENA_RADIUS - 140 - i * SEGMENT_SPACING,
      y: 0,
    }));
    bot.angle = 0; // Facing outward toward wall
    bot.targetAngle = 0;

    stepWorld(world, 33);
    // Target angle should point back toward center (around +-PI)
    expect(Math.abs(bot.targetAngle)).toBeGreaterThan(Math.PI / 2);
  });

  it('client kinematic prediction matches sub-pixel host steering and maintains segment spacing', () => {
    const world = createWorld(createRoomConfig(0), [
      { id: 'p1', name: 'Responsive', colorId: 'emerald' },
    ]);
    const snake = world.snakes[0];
    snake.segments = Array.from({ length: 12 }, (_, i) => ({
      x: -i * SEGMENT_SPACING,
      y: 0,
    }));
    snake.angle = 0;
    snake.targetAngle = 0;
    setSnakeInput(world, 'p1', 0.85, false);

    const pts = snake.segments.map((p) => ({ x: p.x, y: p.y }));
    const predAngle = stepClientSnakeKinematics(
      pts,
      0,
      0.85,
      BASE_SPEED,
      snake.radius,
      0.016
    );
    stepWorld(world, 16);

    expect(predAngle).toBeCloseTo(snake.angle, 3);
    expect(pts[0].x).toBeCloseTo(snake.segments[0].x, 1);
    expect(pts[0].y).toBeCloseTo(snake.segments[0].y, 1);

    const snap = serializeWorld(world);
    expect(snap.snakes[0].targetAngle).toBeCloseTo(0.85, 3);
  });
});

