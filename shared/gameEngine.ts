import {
  ARENA_RADIUS,
  DEFAULT_BOT_COUNT,
  MAX_BOT_COUNT,
  MIN_BOT_COUNT,
  SNAKE_COLOR_LIST,
  type CompactOrb,
  type CompactSnakeSnapshot,
  type KillEvent,
  type LeaderboardEntry,
  type RoomConfig,
  type SnakeColorId,
  type WorldSnapshot,
} from './types.ts';

export const INITIAL_SNAKE_SCORE = 50;
export const MIN_BOOST_SCORE = 65;
export const BASE_SPEED = 210;
export const BOOST_SPEED = 365;
export const BOOST_COST_PER_SEC = 14;
export const BASE_TURN_RATE = 5.8;
export const SEGMENT_SPACING = 11;
export const MIN_SEGMENTS = 12;
export const MAX_SEGMENTS = 140;
export const INITIAL_ORB_COUNT = 340;
export const TARGET_AMBIENT_ORBS = 340;
export const MAX_TOTAL_ORBS = 950;
export const MAGNET_RANGE = 38;
export const SPAWN_PROTECTION_MS = 1500;
export const BOT_RESPAWN_DELAY_MS = 2000;

export const BOT_NAME_POOL = [
  'Nova',
  'Kairo',
  'Vega',
  'Echo',
  'Atlas',
  'Lyra',
  'Orion',
  'Nyx',
  'Zephyr',
  'Helios',
  'Draco',
  'Cygnus',
  'Sirius',
  'Astra',
  'Vortex',
  'Pulse',
  'Nexus',
  'Chronos',
  'Apex',
  'Titan',
  'Spectra',
  'Flux',
  'Cosmo',
  'Hyperion',
  'Sol',
  'Luna',
  'Phantom',
  'Blaze',
  'Frost',
  'Onyx',
];

export interface Vec2 {
  x: number;
  y: number;
}

export interface InternalOrb {
  id: number;
  x: number;
  y: number;
  value: number;
  colorIdx: number;
  isLoot: boolean;
}

export interface InternalSnake {
  id: string;
  name: string;
  isBot: boolean;
  colorId: SnakeColorId;
  alive: boolean;
  score: number;
  kills: number;
  bestScore: number;
  totalKills: number;
  lastRunScore: number;
  lastRunKills: number;
  eliminatedBy: string | null;
  angle: number;
  targetAngle: number;
  speed: number;
  radius: number;
  wantBoost: boolean;
  boosting: boolean;
  boostDropBuffer: number;
  spawnProtectionMs: number;
  respawnAt: number | null;
  segments: Vec2[];
  aiWanderAngle: number;
  aiWanderTimer: number;
  aiBoostTimer: number;
}

export interface InternalWorld {
  tick: number;
  nowMs: number;
  arenaRadius: number;
  nextOrbId: number;
  nextKillId: number;
  snakes: InternalSnake[];
  orbs: InternalOrb[];
  killFeed: KillEvent[];
  targetBotCount: number;
}

export interface HumanParticipantSpec {
  id: string;
  name: string;
  colorId: SnakeColorId;
  bestScore?: number;
  totalKills?: number;
}

export function clampBotCount(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_BOT_COUNT;
  return Math.max(MIN_BOT_COUNT, Math.min(MAX_BOT_COUNT, Math.round(raw)));
}

export function createRoomConfig(botCount: number = DEFAULT_BOT_COUNT): RoomConfig {
  return {
    botCount: clampBotCount(botCount),
    arenaRadius: ARENA_RADIUS,
  };
}

export function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function getSnakeRadius(score: number): number {
  return 11 + Math.min(16, Math.sqrt(Math.max(0, score - INITIAL_SNAKE_SCORE)) * 0.48);
}

export function getTurnRate(radius: number): number {
  const turnScale = Math.max(0.74, 1 - (radius - 11) * 0.015);
  return BASE_TURN_RATE * turnScale;
}

export function stepClientSnakeKinematics(
  pts: Vec2[],
  angle: number,
  targetAngle: number,
  speed: number,
  radius: number,
  dtSec: number
): number {
  if (pts.length === 0 || dtSec <= 0) return angle;

  const maxTurn = getTurnRate(radius) * dtSec;
  const diff = normalizeAngle(targetAngle - angle);
  const nextAngle =
    Math.abs(diff) <= maxTurn ? targetAngle : normalizeAngle(angle + Math.sign(diff) * maxTurn);

  const head = pts[0];
  head.x += Math.cos(nextAngle) * speed * dtSec;
  head.y += Math.sin(nextAngle) * speed * dtSec;

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.0001) {
      curr.x = prev.x + (dx / dist) * SEGMENT_SPACING;
      curr.y = prev.y + (dy / dist) * SEGMENT_SPACING;
    }
  }

  return nextAngle;
}

export function getTargetSegmentCount(score: number): number {
  const extra = Math.floor(Math.max(0, score - INITIAL_SNAKE_SCORE) / 8);
  return Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, MIN_SEGMENTS + extra));
}

export function getOrbRadius(value: number): number {
  return 4.5 + Math.min(7, Math.sqrt(Math.max(1, value)) * 1.35);
}

export function getColorIndex(colorId: SnakeColorId): number {
  const idx = SNAKE_COLOR_LIST.findIndex((c) => c.id === colorId);
  return idx >= 0 ? idx : 0;
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createAmbientOrb(world: InternalWorld): InternalOrb {
  const maxR = world.arenaRadius - 90;
  const r = Math.sqrt(Math.random()) * maxR;
  const theta = Math.random() * Math.PI * 2;
  const roll = Math.random();
  const value = roll > 0.94 ? 4 : roll > 0.72 ? 2 : 1;
  const colorIdx = Math.floor(Math.random() * SNAKE_COLOR_LIST.length);

  return {
    id: world.nextOrbId++,
    x: Math.cos(theta) * r,
    y: Math.sin(theta) * r,
    value,
    colorIdx,
    isLoot: false,
  };
}

export function findSafeSpawnPoint(
  world: InternalWorld
): { x: number; y: number; angle: number } {
  const maxSpawnR = world.arenaRadius * 0.74;
  let bestCandidate = { x: 0, y: 0, clearance: -1 };

  for (let attempt = 0; attempt < 18; attempt++) {
    const r = Math.sqrt(Math.random()) * maxSpawnR;
    const theta = Math.random() * Math.PI * 2;
    const cx = Math.cos(theta) * r;
    const cy = Math.sin(theta) * r;

    let minDist = world.arenaRadius;
    for (const s of world.snakes) {
      if (!s.alive) continue;
      for (let i = 0; i < s.segments.length; i += 2) {
        const seg = s.segments[i];
        const d = Math.hypot(cx - seg.x, cy - seg.y);
        if (d < minDist) minDist = d;
      }
    }

    if (minDist > bestCandidate.clearance) {
      bestCandidate = { x: cx, y: cy, clearance: minDist };
    }
    if (minDist >= 340) break;
  }

  // Face generally inward toward the arena center with slight organic variance
  const towardCenter = Math.atan2(-bestCandidate.y, -bestCandidate.x);
  const angle = normalizeAngle(towardCenter + randomInRange(-0.7, 0.7));

  return { x: bestCandidate.x, y: bestCandidate.y, angle };
}

function buildInitialSegments(x: number, y: number, angle: number, count: number): Vec2[] {
  const segs: Vec2[] = [];
  const backX = -Math.cos(angle);
  const backY = -Math.sin(angle);
  for (let i = 0; i < count; i++) {
    segs.push({
      x: x + backX * i * SEGMENT_SPACING,
      y: y + backY * i * SEGMENT_SPACING,
    });
  }
  return segs;
}

export function spawnSnake(
  world: InternalWorld,
  params: {
    id: string;
    name: string;
    isBot: boolean;
    colorId: SnakeColorId;
    bestScore?: number;
    totalKills?: number;
  }
): InternalSnake {
  const spawn = findSafeSpawnPoint(world);
  const score = INITIAL_SNAKE_SCORE;
  const segCount = getTargetSegmentCount(score);

  const snake: InternalSnake = {
    id: params.id,
    name: params.name,
    isBot: params.isBot,
    colorId: params.colorId,
    alive: true,
    score,
    kills: 0,
    bestScore: Math.max(score, params.bestScore ?? score),
    totalKills: params.totalKills ?? 0,
    lastRunScore: score,
    lastRunKills: 0,
    eliminatedBy: null,
    angle: spawn.angle,
    targetAngle: spawn.angle,
    speed: BASE_SPEED,
    radius: getSnakeRadius(score),
    wantBoost: false,
    boosting: false,
    boostDropBuffer: 0,
    spawnProtectionMs: SPAWN_PROTECTION_MS,
    respawnAt: null,
    segments: buildInitialSegments(spawn.x, spawn.y, spawn.angle, segCount),
    aiWanderAngle: spawn.angle,
    aiWanderTimer: randomInRange(0.5, 2.0),
    aiBoostTimer: 0,
  };

  return snake;
}

export function respawnExistingSnake(world: InternalWorld, snake: InternalSnake): void {
  const spawn = findSafeSpawnPoint(world);
  snake.alive = true;
  snake.score = INITIAL_SNAKE_SCORE;
  snake.kills = 0;
  snake.eliminatedBy = null;
  snake.angle = spawn.angle;
  snake.targetAngle = spawn.angle;
  snake.speed = BASE_SPEED;
  snake.radius = getSnakeRadius(INITIAL_SNAKE_SCORE);
  snake.wantBoost = false;
  snake.boosting = false;
  snake.boostDropBuffer = 0;
  snake.spawnProtectionMs = SPAWN_PROTECTION_MS;
  snake.respawnAt = null;
  snake.segments = buildInitialSegments(
    spawn.x,
    spawn.y,
    spawn.angle,
    getTargetSegmentCount(INITIAL_SNAKE_SCORE)
  );
  snake.aiWanderAngle = spawn.angle;
  snake.aiWanderTimer = randomInRange(0.6, 2.2);
  snake.aiBoostTimer = 0;
}

function nextUniqueBotIdentity(world: InternalWorld, indexOffset: number): {
  name: string;
  colorId: SnakeColorId;
} {
  const usedNames = new Set(world.snakes.map((s) => s.name));
  let name = BOT_NAME_POOL.find((n) => !usedNames.has(n));
  if (!name) {
    let idx = indexOffset + 1;
    while (usedNames.has(`Bot-${idx}`)) idx += 1;
    name = `Bot-${idx}`;
  }
  const colorMeta = SNAKE_COLOR_LIST[(world.snakes.length + indexOffset) % SNAKE_COLOR_LIST.length];
  return { name, colorId: colorMeta.id };
}

export function createWorld(
  config: RoomConfig,
  humanPlayers: HumanParticipantSpec[]
): InternalWorld {
  const botCount = clampBotCount(config.botCount);
  const world: InternalWorld = {
    tick: 0,
    nowMs: 0,
    arenaRadius: config.arenaRadius || ARENA_RADIUS,
    nextOrbId: 1,
    nextKillId: 1,
    snakes: [],
    orbs: [],
    killFeed: [],
    targetBotCount: botCount,
  };

  for (let i = 0; i < INITIAL_ORB_COUNT; i++) {
    world.orbs.push(createAmbientOrb(world));
  }

  for (const human of humanPlayers) {
    world.snakes.push(
      spawnSnake(world, {
        id: human.id,
        name: human.name,
        isBot: false,
        colorId: human.colorId,
        bestScore: human.bestScore,
        totalKills: human.totalKills,
      })
    );
  }

  for (let i = 0; i < botCount; i++) {
    const identity = nextUniqueBotIdentity(world, i);
    world.snakes.push(
      spawnSnake(world, {
        id: `bot-${i + 1}-${Math.random().toString(36).slice(2, 7)}`,
        name: identity.name,
        isBot: true,
        colorId: identity.colorId,
      })
    );
  }

  return world;
}

export function syncBotCount(world: InternalWorld, targetBotCount: number): void {
  const clamped = clampBotCount(targetBotCount);
  world.targetBotCount = clamped;

  const currentBots = world.snakes.filter((s) => s.isBot);
  if (currentBots.length < clamped) {
    const toAdd = clamped - currentBots.length;
    for (let i = 0; i < toAdd; i++) {
      const identity = nextUniqueBotIdentity(world, currentBots.length + i);
      world.snakes.push(
        spawnSnake(world, {
          id: `bot-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          name: identity.name,
          isBot: true,
          colorId: identity.colorId,
        })
      );
    }
  } else if (currentBots.length > clamped) {
    let toRemove = currentBots.length - clamped;
    // Prefer removing dead bots first, then lowest-score bots
    const removable = [...currentBots].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? 1 : -1;
      return a.score - b.score;
    });
    const removeIds = new Set<string>();
    for (const bot of removable) {
      if (toRemove <= 0) break;
      removeIds.add(bot.id);
      toRemove -= 1;
    }
    world.snakes = world.snakes.filter((s) => !removeIds.has(s.id));
  }
}

export function setSnakeInput(
  world: InternalWorld,
  snakeId: string,
  targetAngle: number,
  wantBoost: boolean
): void {
  const snake = world.snakes.find((s) => s.id === snakeId);
  if (!snake || !snake.alive) return;
  if (Number.isFinite(targetAngle)) {
    snake.targetAngle = normalizeAngle(targetAngle);
  }
  snake.wantBoost = Boolean(wantBoost);
}

export function updateBotAI(world: InternalWorld, bot: InternalSnake, dtSec: number): void {
  if (!bot.alive || bot.segments.length === 0) return;

  const head = bot.segments[0];
  let steerX = 0;
  let steerY = 0;
  let desiredBoost = false;

  // 1. Arena Wall Avoidance
  const distFromCenter = Math.hypot(head.x, head.y);
  const wallBuffer = 380;
  const distToWall = world.arenaRadius - distFromCenter;
  const nearWall = distToWall < wallBuffer;

  if (nearWall && distFromCenter > 1) {
    const urgency = Math.min(12, ((wallBuffer - distToWall) / wallBuffer) * 10 + 1.5);
    steerX += (-head.x / distFromCenter) * urgency;
    steerY += (-head.y / distFromCenter) * urgency;
  }

  // 2. Enemy Segment & Head Threat Avoidance
  let minThreatDist = Infinity;
  let threatAvoidX = 0;
  let threatAvoidY = 0;
  let opportunisticCutoffAngle: number | null = null;

  const fwdX = Math.cos(bot.angle);
  const fwdY = Math.sin(bot.angle);

  for (const other of world.snakes) {
    if (!other.alive || other.id === bot.id) continue;

    // Quick bounding check against other head before scanning all segments
    const oHead = other.segments[0];
    const headDist = Math.hypot(oHead.x - head.x, oHead.y - head.y);

    // Opportunistic cut-off if enemy head is nearby on our flank and not spawn-protected
    if (
      !nearWall &&
      bot.spawnProtectionMs <= 0 &&
      other.spawnProtectionMs <= 0 &&
      headDist < 230 &&
      headDist > 75 &&
      bot.score > 110
    ) {
      const toOtherX = (oHead.x - head.x) / headDist;
      const toOtherY = (oHead.y - head.y) / headDist;
      const align = fwdX * toOtherX + fwdY * toOtherY;
      const otherFwdX = Math.cos(other.angle);
      const otherFwdY = Math.sin(other.angle);
      const headingSameWay = fwdX * otherFwdX + fwdY * otherFwdY;
      if (align > 0.1 && align < 0.7 && headingSameWay > 0.3) {
        const interceptX = oHead.x + otherFwdX * 115;
        const interceptY = oHead.y + otherFwdY * 115;
        opportunisticCutoffAngle = Math.atan2(interceptY - head.y, interceptX - head.x);
      }
    }

    const stride = other.segments.length > 40 ? 2 : 1;
    for (let j = 0; j < other.segments.length; j += stride) {
      const seg = other.segments[j];
      const dx = head.x - seg.x;
      const dy = head.y - seg.y;
      const d = Math.hypot(dx, dy);
      if (d > 275 || d < 0.001) continue;

      const dotAhead = (-dx / d) * fwdX + (-dy / d) * fwdY;
      const dangerRadius = j === 0 ? 260 : 230;
      if (d < dangerRadius && (dotAhead > -0.25 || d < 120)) {
        if (d < minThreatDist) minThreatDist = d;
        const weight = ((dangerRadius - d) / dangerRadius) * (dotAhead > 0.2 ? 9.5 : 5.5);
        threatAvoidX += (dx / d) * weight;
        threatAvoidY += (dy / d) * weight;
      }
    }
  }

  if (minThreatDist < 240) {
    steerX += threatAvoidX;
    steerY += threatAvoidY;
  }

  // 3. Orb Cluster & Death-Trail Seeking (when not immediately dodging a crash)
  let bestOrbScore = -1;
  let bestOrb: InternalOrb | null = null;
  for (let i = 0; i < world.orbs.length; i++) {
    const orb = world.orbs[i];
    const dx = orb.x - head.x;
    const dy = orb.y - head.y;
    const d = Math.hypot(dx, dy);
    if (d > 480) continue;

    // Slightly avoid orbs right next to the deadly arena boundary
    if (Math.hypot(orb.x, orb.y) > world.arenaRadius - 130) continue;

    const orbWeight = (orb.value * 2.5) / (d + 40);
    if (orbWeight > bestOrbScore) {
      bestOrbScore = orbWeight;
      bestOrb = orb;
    }
  }

  if (bestOrb && minThreatDist > 135 && !nearWall) {
    const dx = bestOrb.x - head.x;
    const dy = bestOrb.y - head.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const pull = minThreatDist < 220 ? 1.4 : 3.2;
    steerX += (dx / d) * pull;
    steerY += (dy / d) * pull;

    if (bestOrb.value >= 7 && minThreatDist > 210 && bot.score > MIN_BOOST_SCORE + 20) {
      desiredBoost = true;
    }
  } else if (opportunisticCutoffAngle !== null && minThreatDist > 175 && bot.aiBoostTimer <= 0) {
    bot.aiBoostTimer = 0.55;
    steerX += Math.cos(opportunisticCutoffAngle) * 2.6;
    steerY += Math.sin(opportunisticCutoffAngle) * 2.6;
  }

  // 4. Organic Wander Fallback
  bot.aiWanderTimer -= dtSec;
  if (bot.aiWanderTimer <= 0) {
    bot.aiWanderTimer = randomInRange(0.9, 2.4);
    bot.aiWanderAngle = normalizeAngle(bot.angle + randomInRange(-1.1, 1.1));
  }

  if (Math.hypot(steerX, steerY) < 0.25) {
    steerX += Math.cos(bot.aiWanderAngle);
    steerY += Math.sin(bot.aiWanderAngle);
  } else {
    steerX += Math.cos(bot.aiWanderAngle) * 0.2;
    steerY += Math.sin(bot.aiWanderAngle) * 0.2;
  }

  if (bot.aiBoostTimer > 0) {
    bot.aiBoostTimer = Math.max(0, bot.aiBoostTimer - dtSec);
    if (minThreatDist > 175 && !nearWall && bot.score > MIN_BOOST_SCORE + 25) {
      desiredBoost = true;
    }
  }

  // Cancel boost when heading close to danger or wall
  if (minThreatDist < 145 || distToWall < 200) {
    desiredBoost = false;
  }

  bot.targetAngle = Math.atan2(steerY, steerX);
  bot.wantBoost = desiredBoost;
}

export function killSnake(
  world: InternalWorld,
  victim: InternalSnake,
  killer: InternalSnake | null,
  reasonLabel: string
): void {
  if (!victim.alive) return;

  victim.alive = false;
  victim.boosting = false;
  victim.wantBoost = false;
  victim.lastRunScore = Math.round(victim.score);
  victim.lastRunKills = victim.kills;
  victim.bestScore = Math.max(victim.bestScore, victim.lastRunScore);
  victim.eliminatedBy = reasonLabel;
  victim.respawnAt = victim.isBot ? world.nowMs + BOT_RESPAWN_DELAY_MS : null;

  if (killer && killer.id !== victim.id) {
    killer.kills += 1;
    killer.totalKills += 1;
    killer.score += 15;
    killer.bestScore = Math.max(killer.bestScore, Math.round(killer.score));
  }

  // Convert body segments into glowing loot orbs
  const numOrbs = Math.max(5, Math.min(victim.segments.length, Math.round(victim.score / 8)));
  const totalLootMass = Math.max(15, victim.score * 0.72);
  const perOrbValue = Math.max(3, Math.min(18, Math.round(totalLootMass / numOrbs)));
  const colorIdx = getColorIndex(victim.colorId);

  for (let i = 0; i < numOrbs; i++) {
    const segIdx = Math.min(
      victim.segments.length - 1,
      Math.floor((i / numOrbs) * victim.segments.length)
    );
    const seg = victim.segments[segIdx];
    const ox = seg.x + randomInRange(-12, 12);
    const oy = seg.y + randomInRange(-12, 12);

    // Clamp inside arena so loot doesn't spill outside the border
    const dist = Math.hypot(ox, oy);
    const maxR = world.arenaRadius - 25;
    const scale = dist > maxR && dist > 0 ? maxR / dist : 1;

    world.orbs.push({
      id: world.nextOrbId++,
      x: ox * scale,
      y: oy * scale,
      value: perOrbValue,
      colorIdx,
      isLoot: true,
    });
  }

  // Prune oldest ambient orbs if total exceeds cap
  if (world.orbs.length > MAX_TOTAL_ORBS) {
    let excess = world.orbs.length - MAX_TOTAL_ORBS;
    const kept: InternalOrb[] = [];
    for (let i = 0; i < world.orbs.length; i++) {
      const orb = world.orbs[i];
      if (excess > 0 && !orb.isLoot) {
        excess -= 1;
        continue;
      }
      kept.push(orb);
    }
    world.orbs = excess > 0 ? kept.slice(excess) : kept;
  }

  world.killFeed.unshift({
    id: `k-${world.nextKillId++}`,
    killerName: killer ? killer.name : reasonLabel,
    victimName: victim.name,
    victimMass: Math.round(victim.score),
    timestamp: world.nowMs,
  });
  if (world.killFeed.length > 6) {
    world.killFeed.length = 6;
  }
}

function advanceSnake(world: InternalWorld, snake: InternalSnake, dtSec: number, dtMs: number): void {
  if (!snake.alive || snake.segments.length === 0) return;

  if (snake.spawnProtectionMs > 0) {
    snake.spawnProtectionMs = Math.max(0, snake.spawnProtectionMs - dtMs);
  }

  snake.radius = getSnakeRadius(snake.score);

  // Scale turn rate smoothly down as snake gets larger
  const maxTurn = getTurnRate(snake.radius) * dtSec;
  const diff = normalizeAngle(snake.targetAngle - snake.angle);
  if (Math.abs(diff) <= maxTurn) {
    snake.angle = snake.targetAngle;
  } else {
    snake.angle = normalizeAngle(snake.angle + Math.sign(diff) * maxTurn);
  }

  // Boost check & mass drain
  if (snake.wantBoost && snake.score > MIN_BOOST_SCORE) {
    snake.boosting = true;
    snake.speed = BOOST_SPEED;
    const drained = Math.min(snake.score - MIN_BOOST_SCORE, BOOST_COST_PER_SEC * dtSec);
    snake.score -= drained;
    snake.boostDropBuffer += drained;

    while (snake.boostDropBuffer >= 3) {
      snake.boostDropBuffer -= 3;
      const tail = snake.segments[snake.segments.length - 1];
      world.orbs.push({
        id: world.nextOrbId++,
        x: tail.x + randomInRange(-5, 5),
        y: tail.y + randomInRange(-5, 5),
        value: 3,
        colorIdx: getColorIndex(snake.colorId),
        isLoot: false,
      });
    }
  } else {
    snake.boosting = false;
    snake.speed = BASE_SPEED;
  }

  // Move head
  const head = snake.segments[0];
  head.x += Math.cos(snake.angle) * snake.speed * dtSec;
  head.y += Math.sin(snake.angle) * snake.speed * dtSec;

  // Maintain segment chain following
  for (let i = 1; i < snake.segments.length; i++) {
    const prev = snake.segments[i - 1];
    const curr = snake.segments[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.0001) {
      curr.x = prev.x + (dx / dist) * SEGMENT_SPACING;
      curr.y = prev.y + (dy / dist) * SEGMENT_SPACING;
    }
  }

  // Adjust segment count to match score
  const targetCount = getTargetSegmentCount(snake.score);
  while (snake.segments.length < targetCount) {
    const tail = snake.segments[snake.segments.length - 1];
    snake.segments.push({ x: tail.x, y: tail.y });
  }
  while (snake.segments.length > targetCount && snake.segments.length > MIN_SEGMENTS) {
    snake.segments.pop();
  }

  snake.bestScore = Math.max(snake.bestScore, Math.round(snake.score));
}

function resolveOrbs(world: InternalWorld, dtSec: number): void {
  const remainingOrbs: InternalOrb[] = [];
  const pullSpeed = 265 * dtSec;

  for (let i = 0; i < world.orbs.length; i++) {
    const orb = world.orbs[i];
    const orbR = getOrbRadius(orb.value);
    let consumed = false;
    let closestSnake: InternalSnake | null = null;
    let closestDist = Infinity;

    for (let sIdx = 0; sIdx < world.snakes.length; sIdx++) {
      const snake = world.snakes[sIdx];
      if (!snake.alive || snake.segments.length === 0) continue;
      const head = snake.segments[0];
      const dx = head.x - orb.x;
      const dy = head.y - orb.y;
      const dist = Math.hypot(dx, dy);

      const consumeThresh = snake.radius + orbR + 10;
      if (dist <= consumeThresh) {
        snake.score += orb.value;
        snake.bestScore = Math.max(snake.bestScore, Math.round(snake.score));
        consumed = true;
        break;
      }

      const magnetThresh = snake.radius + orbR + MAGNET_RANGE;
      if (dist <= magnetThresh && dist < closestDist) {
        closestDist = dist;
        closestSnake = snake;
      }
    }

    if (consumed) continue;

    if (closestSnake && closestDist > 0.001) {
      const head = closestSnake.segments[0];
      const step = Math.min(closestDist, pullSpeed);
      orb.x += ((head.x - orb.x) / closestDist) * step;
      orb.y += ((head.y - orb.y) / closestDist) * step;
    }

    remainingOrbs.push(orb);
  }

  world.orbs = remainingOrbs;

  // Replenish ambient orbs up to target
  let ambientCount = 0;
  for (let i = 0; i < world.orbs.length; i++) {
    if (!world.orbs[i].isLoot) ambientCount += 1;
  }
  while (ambientCount < TARGET_AMBIENT_ORBS && world.orbs.length < MAX_TOTAL_ORBS) {
    world.orbs.push(createAmbientOrb(world));
    ambientCount += 1;
  }
}

interface PendingDeath {
  victim: InternalSnake;
  killer: InternalSnake | null;
  reason: string;
}

function resolveCollisions(world: InternalWorld): void {
  const deaths: Map<string, PendingDeath> = new Map();
  const markDeath = (victim: InternalSnake, killer: InternalSnake | null, reason: string) => {
    if (!deaths.has(victim.id)) {
      deaths.set(victim.id, { victim, killer, reason });
    }
  };

  // 1. Arena border check
  for (const snake of world.snakes) {
    if (!snake.alive || snake.segments.length === 0) continue;
    const head = snake.segments[0];
    if (Math.hypot(head.x, head.y) + snake.radius >= world.arenaRadius) {
      markDeath(snake, null, 'Arena-Wand');
    }
  }

  // 2. Snake vs Snake collisions
  for (let i = 0; i < world.snakes.length; i++) {
    const a = world.snakes[i];
    if (!a.alive || a.segments.length === 0 || a.spawnProtectionMs > 0) continue;
    const headA = a.segments[0];

    for (let j = 0; j < world.snakes.length; j++) {
      if (i === j) continue;
      const b = world.snakes[j];
      if (!b.alive || b.segments.length === 0 || b.spawnProtectionMs > 0) continue;

      const headB = b.segments[0];

      // Head-to-head check (only evaluate once per unordered pair i < j)
      if (i < j) {
        const hhThresh = (a.radius + b.radius) * 0.8;
        const hhDist = Math.hypot(headA.x - headB.x, headA.y - headB.y);
        if (hhDist < hhThresh && hhDist > 0.0001) {
          const dirX = (headB.x - headA.x) / hhDist;
          const dirY = (headB.y - headA.y) / hhDist;
          const alignA = Math.cos(a.angle) * dirX + Math.sin(a.angle) * dirY;
          const alignB = Math.cos(b.angle) * -dirX + Math.sin(b.angle) * -dirY;

          if (alignA > alignB + 0.35) {
            markDeath(a, b, b.name);
          } else if (alignB > alignA + 0.35) {
            markDeath(b, a, a.name);
          } else if (a.score > b.score * 1.5) {
            markDeath(b, a, a.name);
          } else if (b.score > a.score * 1.5) {
            markDeath(a, b, b.name);
          } else {
            markDeath(a, b, b.name);
            markDeath(b, a, a.name);
          }
          continue;
        }
      }

      // Head of A vs body segments of B (k >= 1)
      const bodyThresh = (a.radius + b.radius) * 0.84;
      for (let k = 1; k < b.segments.length; k++) {
        const seg = b.segments[k];
        const dx = headA.x - seg.x;
        const dy = headA.y - seg.y;
        if (Math.abs(dx) > bodyThresh || Math.abs(dy) > bodyThresh) continue;
        if (Math.hypot(dx, dy) < bodyThresh) {
          markDeath(a, b, b.name);
          break;
        }
      }
    }
  }

  for (const d of deaths.values()) {
    killSnake(world, d.victim, d.killer, d.reason);
  }
}

export function stepWorld(world: InternalWorld, rawDtMs: number): void {
  const dtMs = Math.max(1, Math.min(100, rawDtMs));
  const dtSec = dtMs / 1000;
  world.nowMs += dtMs;
  world.tick += 1;

  // Respawn dead bots when timer elapsed
  for (const snake of world.snakes) {
    if (!snake.alive && snake.isBot && snake.respawnAt !== null && world.nowMs >= snake.respawnAt) {
      respawnExistingSnake(world, snake);
    }
  }

  // Bot AI steering
  for (const snake of world.snakes) {
    if (snake.alive && snake.isBot) {
      updateBotAI(world, snake, dtSec);
    }
  }

  // Advance movement
  for (const snake of world.snakes) {
    if (snake.alive) {
      advanceSnake(world, snake, dtSec, dtMs);
    }
  }

  // Resolve orb magnet & eating
  resolveOrbs(world, dtSec);

  // Resolve wall & snake collisions
  resolveCollisions(world);

  // Expire old killFeed entries (> 7s)
  if (world.killFeed.length > 0) {
    world.killFeed = world.killFeed.filter((k) => world.nowMs - k.timestamp <= 7000);
  }
}

export function serializeWorld(world: InternalWorld): WorldSnapshot {
  const snakes: CompactSnakeSnapshot[] = world.snakes.map((s) => {
    const pts: number[] = [];
    if (s.alive) {
      for (let i = 0; i < s.segments.length; i++) {
        pts.push(
          Math.round(s.segments[i].x * 10) / 10,
          Math.round(s.segments[i].y * 10) / 10
        );
      }
    }
    return {
      id: s.id,
      name: s.name,
      isBot: s.isBot,
      colorId: s.colorId,
      alive: s.alive,
      score: Math.round(s.score),
      kills: s.kills,
      angle: Number(s.angle.toFixed(3)),
      targetAngle: Number(s.targetAngle.toFixed(3)),
      speed: Math.round(s.speed),
      radius: Number(s.radius.toFixed(1)),
      boosting: s.boosting,
      spawnProtected: s.spawnProtectionMs > 0,
      respawnInMs:
        !s.alive && s.respawnAt !== null ? Math.max(0, Math.round(s.respawnAt - world.nowMs)) : 0,
      lastRunScore: s.lastRunScore,
      lastRunKills: s.lastRunKills,
      eliminatedBy: s.eliminatedBy,
      pts,
    };
  });

  const orbs: CompactOrb[] = world.orbs.map((o) => [
    o.id,
    Math.round(o.x),
    Math.round(o.y),
    Math.round(o.value),
    o.colorIdx,
  ]);

  const leaderboard: LeaderboardEntry[] = [...world.snakes]
    .filter((s) => s.alive)
    .sort((a, b) => b.score - a.score || b.kills - a.kills)
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      name: s.name,
      isBot: s.isBot,
      colorId: s.colorId,
      length: Math.round(s.score),
      kills: s.kills,
      alive: s.alive,
    }));

  return {
    tick: world.tick,
    timestamp: world.nowMs,
    arenaRadius: world.arenaRadius,
    snakes,
    orbs,
    leaderboard,
    killFeed: [...world.killFeed],
  };
}

