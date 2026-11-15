import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  Bot,
  Check,
  Copy,
  Eye,
  HelpCircle,
  LogOut,
  Minus,
  Plus,
  RotateCcw,
  Skull,
  Trophy,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import {
  BASE_SPEED,
  BOOST_SPEED,
  MIN_BOOST_SCORE,
  clampBotCount,
  getOrbRadius,
  normalizeAngle,
  stepClientSnakeKinematics,
} from '../../shared/gameEngine.ts';
import {
  MAX_BOT_COUNT,
  SNAKE_COLORS,
  SNAKE_COLOR_LIST,
  type ClientRoomState,
  type CompactSnakeSnapshot,
  type RoomActionResponse,
  type SnakeColorId,
  type WorldSnapshot,
} from '../../shared/types.ts';

interface WorldStreamPacket {
  snapshot: WorldSnapshot;
  receivedAt: number;
}

interface SlitherArenaProps {
  room: ClientRoomState;
  worldStreamRef?: RefObject<WorldStreamPacket | null>;
  connected: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onSendInput: (angle: number, boosting: boolean) => void;
  onRespawn: () => Promise<RoomActionResponse>;
  onSetBotCount: (botCount: number) => void;
  onSetPlayerColor: (colorId: SnakeColorId) => void;
  onReturnToLobby: () => void;
  onLeave: () => void;
  onPlayOrbSound: (deltaScore: number) => void;
  onPlayBoostSound: () => void;
  onPlayKillSound: () => void;
  onPlayDeathSound: () => void;
  onPlayStartSound: () => void;
}

interface SmoothSnakeState {
  id: string;
  angle: number;
  radius: number;
  score: number;
  boosting: boolean;
  pts: Array<{ x: number; y: number }>;
}

interface BoostParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export function SlitherArena({
  room,
  worldStreamRef,
  connected,
  soundEnabled,
  onToggleSound,
  onSendInput,
  onRespawn,
  onSetBotCount,
  onSetPlayerColor,
  onReturnToLobby,
  onLeave,
  onPlayOrbSound,
  onPlayBoostSound,
  onPlayKillSound,
  onPlayDeathSound,
  onPlayStartSound,
}: SlitherArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackPacketRef = useRef<WorldStreamPacket | null>(
    room.world ? { snapshot: room.world, receivedAt: typeof performance !== 'undefined' ? performance.now() : 0 } : null
  );
  const myPlayerIdRef = useRef<string>(room.myPlayerId);
  const onSendInputRef = useRef(onSendInput);

  const smoothSnakesRef = useRef<Map<string, SmoothSnakeState>>(new Map());
  const cameraRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  const particlesRef = useRef<BoostParticle[]>([]);

  // Control state refs for zero-lag input capture
  const steerAngleRef = useRef<number>(0);
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const inputModeRef = useRef<'mouse' | 'keyboard' | 'touch'>('mouse');
  const mouseBoostRef = useRef<boolean>(false);
  const touchBoostRef = useRef<boolean>(false);
  const keysDownRef = useRef<Set<string>>(new Set());
  const touchOriginRef = useRef<{ id: number; x: number; y: number } | null>(null);

  const [showControls, setShowControls] = useState(false);
  const [spectating, setSpectating] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [respawning, setRespawning] = useState(false);

  if (room.world) {
    const curSnap = fallbackPacketRef.current?.snapshot;
    if (!curSnap || curSnap.tick !== room.world.tick) {
      fallbackPacketRef.current = {
        snapshot: room.world,
        receivedAt: typeof performance !== 'undefined' ? performance.now() : 0,
      };
    }
  } else {
    fallbackPacketRef.current = null;
  }
  myPlayerIdRef.current = room.myPlayerId;
  onSendInputRef.current = onSendInput;

  const isHost = room.hostId === room.myPlayerId;
  const world = room.world;

  const meLobby = useMemo(
    () => room.players.find((p) => p.id === room.myPlayerId) ?? null,
    [room.players, room.myPlayerId]
  );

  const mySnake = useMemo(
    () => world?.snakes.find((s) => s.id === room.myPlayerId) ?? null,
    [world, room.myPlayerId]
  );

  const isAlive = mySnake?.alive ?? false;

  // Reset spectating automatically whenever player respawns
  useEffect(() => {
    if (isAlive) {
      setSpectating(false);
    }
  }, [isAlive]);

  // Audio cue transitions
  const prevAliveRef = useRef<boolean | null>(null);
  const prevScoreRef = useRef<number>(50);
  const prevKillsRef = useRef<number>(0);
  const prevBoostingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!mySnake) return;
    if (prevAliveRef.current === null) {
      if (mySnake.alive) onPlayStartSound();
    } else if (!prevAliveRef.current && mySnake.alive) {
      onPlayStartSound();
    } else if (prevAliveRef.current && !mySnake.alive) {
      onPlayDeathSound();
    }

    if (mySnake.alive) {
      const delta = mySnake.score - prevScoreRef.current;
      if (prevAliveRef.current && delta >= 1 && !mySnake.boosting) {
        onPlayOrbSound(delta);
      }
      if (mySnake.kills > prevKillsRef.current) {
        onPlayKillSound();
      }
      if (mySnake.boosting && !prevBoostingRef.current) {
        onPlayBoostSound();
      }
    }

    prevAliveRef.current = mySnake.alive;
    prevScoreRef.current = mySnake.score;
    prevKillsRef.current = mySnake.kills;
    prevBoostingRef.current = mySnake.boosting;
  }, [
    mySnake,
    onPlayBoostSound,
    onPlayDeathSound,
    onPlayKillSound,
    onPlayOrbSound,
    onPlayStartSound,
  ]);

  const isBoostActive = useCallback(() => {
    const keys = keysDownRef.current;
    return (
      mouseBoostRef.current ||
      touchBoostRef.current ||
      keys.has('Space') ||
      keys.has('KeyW') ||
      keys.has('ArrowUp')
    );
  }, []);

  const handleRespawnClick = useCallback(async () => {
    if (respawning) return;
    setRespawning(true);
    try {
      await onRespawn();
    } finally {
      setRespawning(false);
    }
  }, [onRespawn, respawning]);

  // Keyboard steering & Space/Enter respawn shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (!isAlive && !spectating && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault();
        void handleRespawnClick();
        return;
      }

      if (
        e.code === 'Space' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight'
      ) {
        e.preventDefault();
      }

      keysDownRef.current.add(e.code);
      onSendInputRef.current(steerAngleRef.current, isBoostActive());
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysDownRef.current.delete(e.code);
      onSendInputRef.current(steerAngleRef.current, isBoostActive());
    };

    const onBlur = () => {
      keysDownRef.current.clear();
      mouseBoostRef.current = false;
      touchBoostRef.current = false;
      onSendInputRef.current(steerAngleRef.current, false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [handleRespawnClick, isAlive, isBoostActive, spectating]);

  // Main 60 FPS Canvas render & interpolation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastFrameAt = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const drawGrid = (
      camX: number,
      camY: number,
      zoom: number,
      viewW: number,
      viewH: number,
      arenaR: number
    ) => {
      const halfW = viewW / (2 * zoom) + 120;
      const halfH = viewH / (2 * zoom) + 120;
      const step = 95;
      const startX = Math.floor((camX - halfW) / step) * step;
      const endX = Math.ceil((camX + halfW) / step) * step;
      const startY = Math.floor((camY - halfH) / step) * step;
      const endY = Math.ceil((camY + halfH) / step) * step;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.032)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = startX; x <= endX; x += step) {
        if (Math.abs(x) > arenaR) continue;
        const maxY = Math.sqrt(Math.max(0, arenaR * arenaR - x * x));
        const y0 = Math.max(startY, -maxY);
        const y1 = Math.min(endY, maxY);
        if (y1 > y0) {
          ctx.moveTo(x, y0);
          ctx.lineTo(x, y1);
        }
      }
      for (let y = startY; y <= endY; y += step) {
        if (Math.abs(y) > arenaR) continue;
        const maxX = Math.sqrt(Math.max(0, arenaR * arenaR - y * y));
        const x0 = Math.max(startX, -maxX);
        const x1 = Math.min(endX, maxX);
        if (x1 > x0) {
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
        }
      }
      ctx.stroke();
    };

    const frame = (now: number) => {
      const dtSec = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
      lastFrameAt = now;

      const viewW = window.innerWidth;
      const viewH = window.innerHeight;

      // Handle continuous mouse cursor tracking & keyboard turning
      const keys = keysDownRef.current;
      const turnLeft = keys.has('ArrowLeft') || keys.has('KeyA');
      const turnRight = keys.has('ArrowRight') || keys.has('KeyD');
      if (turnLeft || turnRight) {
        inputModeRef.current = 'keyboard';
        const turnDir = (turnRight ? 1 : 0) - (turnLeft ? 1 : 0);
        if (turnDir !== 0) {
          steerAngleRef.current = normalizeAngle(steerAngleRef.current + turnDir * 4.2 * dtSec);
          onSendInputRef.current(steerAngleRef.current, isBoostActive());
        }
      } else if (inputModeRef.current === 'mouse' && mousePosRef.current !== null) {
        const dx = mousePosRef.current.x - viewW / 2;
        const dy = mousePosRef.current.y - viewH / 2;
        if (Math.hypot(dx, dy) > 4) {
          const nextAngle = Math.atan2(dy, dx);
          if (Math.abs(normalizeAngle(nextAngle - steerAngleRef.current)) > 0.002) {
            steerAngleRef.current = nextAngle;
            onSendInputRef.current(steerAngleRef.current, isBoostActive());
          }
        }
      }

      const packet = worldStreamRef?.current ?? fallbackPacketRef.current;
      const snap = packet?.snapshot ?? null;
      const snapAgeSec = packet
        ? Math.min(0.08, Math.max(0, (now - packet.receivedAt) / 1000))
        : 0;
      const smoothMap = smoothSnakesRef.current;

      // Clear background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, viewW, viewH);

      if (snap) {
        const aliveIds = new Set<string>();
        const headReconcileRate = 1 - Math.exp(-16 * dtSec);
        const bodyReconcileRate = 1 - Math.exp(-9 * dtSec);
        const radiusRate = 1 - Math.exp(-14 * dtSec);

        for (const s of snap.snakes) {
          if (!s.alive || s.pts.length < 2) continue;
          aliveIds.add(s.id);

          const isMe = s.id === myPlayerIdRef.current;
          const segCount = Math.floor(s.pts.length / 2);
          let smooth = smoothMap.get(s.id);

          const teleported =
            smooth &&
            smooth.pts.length > 0 &&
            Math.hypot(s.pts[0] - smooth.pts[0].x, s.pts[1] - smooth.pts[0].y) > 220;

          if (!smooth || teleported) {
            const pts: Array<{ x: number; y: number }> = [];
            for (let i = 0; i < segCount; i++) {
              pts.push({ x: s.pts[i * 2], y: s.pts[i * 2 + 1] });
            }
            smooth = {
              id: s.id,
              angle: s.angle,
              radius: s.radius,
              score: s.score,
              boosting: s.boosting,
              pts,
            };
            if (snapAgeSec > 0.001) {
              smooth.angle = stepClientSnakeKinematics(
                smooth.pts,
                smooth.angle,
                isMe ? steerAngleRef.current : s.targetAngle,
                s.speed,
                s.radius,
                snapAgeSec
              );
            }
            smoothMap.set(s.id, smooth);
          } else {
            // Adjust segment array length dynamically as snake grows/shrinks
            while (smooth.pts.length < segCount) {
              const tail = smooth.pts[smooth.pts.length - 1];
              smooth.pts.push({ x: tail.x, y: tail.y });
            }
            while (smooth.pts.length > segCount && smooth.pts.length > 1) {
              smooth.pts.pop();
            }

            // 1. Continuous 60/120/144 FPS kinematic prediction every frame
            const predictedTarget = isMe ? steerAngleRef.current : s.targetAngle;
            const predictedSpeed = isMe
              ? isBoostActive() && s.score > MIN_BOOST_SCORE
                ? BOOST_SPEED
                : BASE_SPEED
              : s.speed;

            smooth.angle = stepClientSnakeKinematics(
              smooth.pts,
              smooth.angle,
              predictedTarget,
              predictedSpeed,
              s.radius,
              dtSec
            );

            // 2. Softly reconcile toward extrapolated authoritative snapshot
            const extHeadX = s.pts[0] + Math.cos(s.angle) * s.speed * snapAgeSec;
            const extHeadY = s.pts[1] + Math.sin(s.angle) * s.speed * snapAgeSec;
            smooth.pts[0].x += (extHeadX - smooth.pts[0].x) * headReconcileRate;
            smooth.pts[0].y += (extHeadY - smooth.pts[0].y) * headReconcileRate;

            for (let i = 1; i < segCount; i++) {
              const sx = s.pts[i * 2];
              const sy = s.pts[i * 2 + 1];
              const prevSx = s.pts[(i - 1) * 2];
              const prevSy = s.pts[(i - 1) * 2 + 1];
              const dx = prevSx - sx;
              const dy = prevSy - sy;
              const segDist = Math.hypot(dx, dy);
              const shift = segDist > 0.001 ? (s.speed * snapAgeSec) / segDist : 0;
              const targetX = sx + dx * Math.min(1, shift);
              const targetY = sy + dy * Math.min(1, shift);
              smooth.pts[i].x += (targetX - smooth.pts[i].x) * bodyReconcileRate;
              smooth.pts[i].y += (targetY - smooth.pts[i].y) * bodyReconcileRate;
            }

            if (!isMe) {
              const angleDiff = normalizeAngle(s.angle - smooth.angle);
              smooth.angle = normalizeAngle(smooth.angle + angleDiff * (1 - Math.exp(-12 * dtSec)));
            }
            smooth.radius += (s.radius - smooth.radius) * radiusRate;
            smooth.score = s.score;
            smooth.boosting = isMe ? isBoostActive() && s.score > MIN_BOOST_SCORE : s.boosting;
          }

          // Emit subtle boost particles from tail
          if (s.boosting && Math.random() < 0.45) {
            const tail = smooth.pts[smooth.pts.length - 1];
            const colorMeta = SNAKE_COLORS[s.colorId] ?? SNAKE_COLORS.white;
            particlesRef.current.push({
              x: tail.x + (Math.random() - 0.5) * smooth.radius,
              y: tail.y + (Math.random() - 0.5) * smooth.radius,
              vx: (Math.random() - 0.5) * 42,
              vy: (Math.random() - 0.5) * 42,
              life: 0.35,
              maxLife: 0.35,
              color: colorMeta.primary,
              size: 2.2 + Math.random() * 2,
            });
          }
        }

        for (const id of smoothMap.keys()) {
          if (!aliveIds.has(id)) {
            smoothMap.delete(id);
          }
        }

        // Camera target: own snake head (tight lock), or #1 leader when dead/spectating
        let targetCamX = cameraRef.current.x;
        let targetCamY = cameraRef.current.y;
        let targetZoom = 1;
        let trackingSelf = false;

        const mySmooth = smoothMap.get(myPlayerIdRef.current);
        if (mySmooth && mySmooth.pts.length > 0) {
          targetCamX = mySmooth.pts[0].x;
          targetCamY = mySmooth.pts[0].y;
          targetZoom = Math.max(0.62, 1.0 - (mySmooth.radius - 11) * 0.018);
          trackingSelf = true;
        } else {
          const leaderId = snap.leaderboard[0]?.id;
          const leaderSmooth = leaderId ? smoothMap.get(leaderId) : undefined;
          if (leaderSmooth && leaderSmooth.pts.length > 0) {
            targetCamX = leaderSmooth.pts[0].x;
            targetCamY = leaderSmooth.pts[0].y;
            targetZoom = 0.78;
          }
        }

        const camLerp = trackingSelf ? 1 - Math.exp(-42 * dtSec) : 1 - Math.exp(-12 * dtSec);
        cameraRef.current.x += (targetCamX - cameraRef.current.x) * camLerp;
        cameraRef.current.y += (targetCamY - cameraRef.current.y) * camLerp;
        cameraRef.current.zoom += (targetZoom - cameraRef.current.zoom) * (1 - Math.exp(-5 * dtSec));

        const camX = cameraRef.current.x;
        const camY = cameraRef.current.y;
        const zoom = cameraRef.current.zoom;
        const viewHalfW = viewW / (2 * zoom) + 120;
        const viewHalfH = viewH / (2 * zoom) + 120;

        ctx.save();
        ctx.translate(viewW / 2, viewH / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-camX, -camY);

        // Arena Interior Fill
        ctx.beginPath();
        ctx.arc(0, 0, snap.arenaRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#040407';
        ctx.fill();

        // Subtle Grid
        drawGrid(camX, camY, zoom, viewW, viewH, snap.arenaRadius);

        // Arena Warning Inner Ring & Crimson Danger Boundary
        ctx.beginPath();
        ctx.arc(0, 0, snap.arenaRadius - 60, 0, Math.PI * 2);
        ctx.setLineDash([12, 18]);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.18)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, snap.arenaRadius, 0, Math.PI * 2);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 5;
        ctx.shadowColor = 'rgba(239, 68, 68, 0.65)';
        ctx.shadowBlur = 24;
        ctx.stroke();
        ctx.restore();

        // Draw Orbs (culled to viewport)
        for (let i = 0; i < snap.orbs.length; i++) {
          const [orbId, ox, oy, oVal, colorIdx] = snap.orbs[i];
          if (Math.abs(ox - camX) > viewHalfW || Math.abs(oy - camY) > viewHalfH) {
            continue;
          }
          const colorMeta = SNAKE_COLOR_LIST[colorIdx % SNAKE_COLOR_LIST.length] ?? SNAKE_COLORS.white;
          const baseR = getOrbRadius(oVal);
          const pulse = 1 + Math.sin(now * 0.0055 + orbId * 0.7) * 0.14;
          const r = baseR * pulse;

          // Soft halo
          ctx.beginPath();
          ctx.arc(ox, oy, r * 2.1, 0, Math.PI * 2);
          ctx.fillStyle = colorMeta.glow.replace('0.45', oVal >= 6 ? '0.24' : '0.13');
          ctx.fill();

          // Crisp core
          ctx.beginPath();
          ctx.arc(ox, oy, r, 0, Math.PI * 2);
          ctx.fillStyle = colorMeta.primary;
          ctx.fill();

          if (oVal >= 5) {
            ctx.beginPath();
            ctx.arc(ox, oy, r * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
          }
        }

        // Update & Draw Boost Particles
        const nextParticles: BoostParticle[] = [];
        for (let i = 0; i < particlesRef.current.length; i++) {
          const pt = particlesRef.current[i];
          pt.life -= dtSec;
          if (pt.life <= 0) continue;
          pt.x += pt.vx * dtSec;
          pt.y += pt.vy * dtSec;
          nextParticles.push(pt);

          if (Math.abs(pt.x - camX) > viewHalfW || Math.abs(pt.y - camY) > viewHalfH) continue;
          const alpha = Math.max(0, pt.life / pt.maxLife) * 0.7;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        particlesRef.current = nextParticles;

        // Draw Snakes (other snakes first, local snake last on top)
        const orderedSnakes = [...snap.snakes].sort((a, b) => {
          if (a.id === myPlayerIdRef.current) return 1;
          if (b.id === myPlayerIdRef.current) return -1;
          return a.score - b.score;
        });

        for (const sSnap of orderedSnakes) {
          if (!sSnap.alive) continue;
          const smooth = smoothMap.get(sSnap.id);
          if (!smooth || smooth.pts.length === 0) continue;

          // Coarse viewport cull using head & bounding margin
          let anyVisible = false;
          const pad = smooth.radius + 140;
          for (let i = 0; i < smooth.pts.length; i += 3) {
            const p = smooth.pts[i];
            if (
              Math.abs(p.x - camX) <= viewHalfW + pad &&
              Math.abs(p.y - camY) <= viewHalfH + pad
            ) {
              anyVisible = true;
              break;
            }
          }
          if (!anyVisible) continue;

          const colorMeta = SNAKE_COLORS[sSnap.colorId] ?? SNAKE_COLORS.white;
          const isMe = sSnap.id === myPlayerIdRef.current;

          ctx.save();
          if (sSnap.spawnProtected) {
            ctx.globalAlpha = 0.55 + Math.sin(now * 0.015) * 0.2;
          }

          // Boost aura spine
          if (smooth.boosting) {
            ctx.save();
            ctx.strokeStyle = colorMeta.glow;
            ctx.lineWidth = smooth.radius * 2.55;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(smooth.pts[0].x, smooth.pts[0].y);
            for (let i = 1; i < smooth.pts.length; i++) {
              ctx.lineTo(smooth.pts[i].x, smooth.pts[i].y);
            }
            ctx.stroke();
            ctx.restore();
          }

          // Draw body segments from tail to head
          for (let i = smooth.pts.length - 1; i >= 0; i--) {
            const pt = smooth.pts[i];
            const t = i / Math.max(1, smooth.pts.length - 1);
            const taper = t > 0.65 ? 1 - ((t - 0.65) / 0.35) * 0.42 : 1;
            const segR = smooth.radius * taper;

            const isStripe = i > 0 && i % 3 === 0;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, segR, 0, Math.PI * 2);
            ctx.fillStyle = isStripe ? colorMeta.secondary : colorMeta.primary;
            ctx.fill();

            if (i === 0) {
              // Subtle crisp border around head
              ctx.lineWidth = isMe ? 2 : 1.25;
              ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
              ctx.stroke();
            }
          }

          // Directional Eyes on Head
          const head = smooth.pts[0];
          const eyeForward = smooth.radius * 0.42;
          const eyeSide = smooth.radius * 0.44;
          const eyeR = Math.max(2.6, smooth.radius * 0.27);
          const pupilR = eyeR * 0.54;
          const cosA = Math.cos(smooth.angle);
          const sinA = Math.sin(smooth.angle);
          const perpX = -sinA;
          const perpY = cosA;

          for (const side of [-1, 1]) {
            const ex = head.x + cosA * eyeForward + perpX * eyeSide * side;
            const ey = head.y + sinA * eyeForward + perpY * eyeSide * side;
            ctx.beginPath();
            ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();

            ctx.beginPath();
            ctx.arc(ex + cosA * (eyeR * 0.28), ey + sinA * (eyeR * 0.28), pupilR, 0, Math.PI * 2);
            ctx.fillStyle = '#09090b';
            ctx.fill();
          }

          ctx.restore();

          // Nameplate & Mass above head
          ctx.save();
          ctx.font = '600 12px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const labelY = head.y - smooth.radius - 10;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
          ctx.fillText(sSnap.name, head.x + 1, labelY + 1);
          ctx.fillStyle = isMe ? '#ffffff' : 'rgba(255, 255, 255, 0.85)';
          ctx.fillText(sSnap.name, head.x, labelY);
          ctx.restore();
        }

        ctx.restore();
      }

      rafId = window.requestAnimationFrame(frame);
    };

    rafId = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [isBoostActive, worldStreamRef]);

  // Pointer & Touch Handlers on Canvas
  const updateAngleFromScreenPoint = (clientX: number, clientY: number) => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    if (Math.hypot(dx, dy) > 4) {
      steerAngleRef.current = Math.atan2(dy, dx);
      onSendInput(steerAngleRef.current, isBoostActive());
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    inputModeRef.current = 'mouse';
    mousePosRef.current = { x: e.clientX, y: e.clientY };
    updateAngleFromScreenPoint(e.clientX, e.clientY);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0) {
      inputModeRef.current = 'mouse';
      mousePosRef.current = { x: e.clientX, y: e.clientY };
      mouseBoostRef.current = true;
      updateAngleFromScreenPoint(e.clientX, e.clientY);
      onSendInput(steerAngleRef.current, true);
    }
  };

  const handleMouseUp = () => {
    mouseBoostRef.current = false;
    onSendInput(steerAngleRef.current, isBoostActive());
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    inputModeRef.current = 'touch';
    touchOriginRef.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    updateAngleFromScreenPoint(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const origin = touchOriginRef.current;
    inputModeRef.current = 'touch';
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (origin && t.identifier === origin.id) {
        const dx = t.clientX - origin.x;
        const dy = t.clientY - origin.y;
        if (Math.hypot(dx, dy) > 10) {
          steerAngleRef.current = Math.atan2(dy, dx);
          onSendInput(steerAngleRef.current, isBoostActive());
        }
        return;
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const origin = touchOriginRef.current;
    if (!origin) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === origin.id) {
        touchOriginRef.current = null;
        break;
      }
    }
  };

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(room.roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  const aliveHumanAndBotCounts = useMemo(() => {
    if (!world) return { totalAlive: 0, botAlive: 0 };
    let totalAlive = 0;
    let botAlive = 0;
    for (const s of world.snakes) {
      if (s.alive) {
        totalAlive += 1;
        if (s.isBot) botAlive += 1;
      }
    }
    return { totalAlive, botAlive };
  }, [world]);

  const myRank = useMemo(() => {
    if (!world || !mySnake || !mySnake.alive) return null;
    const sorted = world.snakes.filter((s) => s.alive).sort((a, b) => b.score - a.score);
    const idx = sorted.findIndex((s) => s.id === room.myPlayerId);
    return idx >= 0 ? idx + 1 : null;
  }, [world, mySnake, room.myPlayerId]);

  const canBoost = (mySnake?.score ?? 0) > MIN_BOOST_SCORE;
  const boostFuelPct = mySnake
    ? Math.min(100, Math.max(0, Math.round(((mySnake.score - MIN_BOOST_SCORE) / 140) * 100)))
    : 0;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black text-white select-none">
      {/* 60 FPS Arena Canvas */}
      <canvas
        ref={canvasRef}
        aria-label="Slither Arena Spielfeld"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="block w-full h-full cursor-crosshair touch-none"
      />

      {/* Top-Left HUD: Room Info & Controls */}
      <div className="fixed top-3 left-3 z-20 flex flex-col gap-2 pointer-events-none">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-[#08080A]/90 backdrop-blur-md px-3 py-2 shadow-2xl">
          <span className="text-xs font-bold tracking-[-0.03em] text-white">SLITHER</span>

          <button
            type="button"
            onClick={() => void copyRoomCode()}
            title="Room-Code kopieren"
            className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] px-2 py-0.5 font-mono-code text-[11px] font-semibold tracking-wider text-zinc-200 hover:bg-white/[0.12] transition-colors cursor-pointer"
          >
            <span>{room.roomCode}</span>
            {copiedCode ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3 text-zinc-400" />
            )}
          </button>

          <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400 font-mono-code">
            {connected ? (
              <Wifi className="w-3 h-3 text-emerald-400" />
            ) : (
              <WifiOff className="w-3 h-3 text-red-400" />
            )}
            <span>
              {aliveHumanAndBotCounts.totalAlive} Aktiv
            </span>
          </span>

          <div className="h-3.5 w-px bg-white/10" />

          <button
            type="button"
            onClick={onToggleSound}
            title={soundEnabled ? 'Ton aus' : 'Ton an'}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => setShowControls((v) => !v)}
            title="Steuerung"
            className={`p-1 rounded-lg transition-colors cursor-pointer ${
              showControls
                ? 'bg-white text-black'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>

          {isHost && (
            <button
              type="button"
              onClick={onReturnToLobby}
              title="Zurück in die Lobby"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">Lobby</span>
            </button>
          )}

          <button
            type="button"
            onClick={onLeave}
            title="Room verlassen"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <LogOut className="w-3 h-3" />
            <span className="hidden sm:inline">Verlassen</span>
          </button>
        </div>

        {/* Host Live Bot Control Pill */}
        {isHost && (
          <div className="pointer-events-auto inline-flex items-center gap-2 self-start rounded-xl border border-white/[0.08] bg-[#08080A]/85 backdrop-blur-md px-2.5 py-1.5 text-[11px]">
            <Bot className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-zinc-400">Bots:</span>
            <button
              type="button"
              onClick={() => onSetBotCount(clampBotCount(room.config.botCount - 5))}
              disabled={room.config.botCount <= 0}
              aria-label="Bots verringern"
              className="w-5 h-5 rounded-md bg-white/[0.06] hover:bg-white/[0.15] disabled:opacity-30 flex items-center justify-center cursor-pointer"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="font-mono-code font-semibold text-white min-w-[2.5rem] text-center">
              {room.config.botCount}/{MAX_BOT_COUNT}
            </span>
            <button
              type="button"
              onClick={() => onSetBotCount(clampBotCount(room.config.botCount + 5))}
              disabled={room.config.botCount >= MAX_BOT_COUNT}
              aria-label="Bots erhöhen"
              className="w-5 h-5 rounded-md bg-white/[0.06] hover:bg-white/[0.15] disabled:opacity-30 flex items-center justify-center cursor-pointer"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        )}

        {showControls && (
          <div className="pointer-events-auto max-w-xs rounded-2xl border border-white/[0.1] bg-[#08080A]/95 backdrop-blur-md p-3.5 text-xs text-zinc-300 space-y-1.5 shadow-2xl animate-pop-in">
            <div className="font-semibold text-white">Steuerung</div>
            <p className="text-zinc-400">• Mauszeiger oder A/D bzw. Pfeiltasten zum Lenken</p>
            <p className="text-zinc-400">• Linksklick, Leertaste oder W zum Boosten (ab Länge 65)</p>
            <p className="text-zinc-400">• Touch: Ziehen zum Lenken + Boost-Button</p>
          </div>
        )}
      </div>

      {/* Top-Center: Kill Feed */}
      {world && world.killFeed.length > 0 && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-10 hidden md:flex flex-col items-center gap-1 pointer-events-none">
          {world.killFeed.slice(0, 3).map((ev) => (
            <div
              key={ev.id}
              className="rounded-full border border-white/[0.08] bg-[#08080A]/85 backdrop-blur-md px-3 py-1 text-[11px] text-zinc-300 flex items-center gap-1.5 shadow-lg"
            >
              <span className="font-semibold text-white">{ev.killerName}</span>
              <Skull className="w-3 h-3 text-red-400" />
              <span className="text-zinc-400">{ev.victimName}</span>
              <span className="font-mono-code text-[10px] text-zinc-500">({ev.victimMass})</span>
            </div>
          ))}
        </div>
      )}

      {/* Top-Right: Top 10 Leaderboard */}
      {world && (
        <aside className="fixed top-3 right-3 z-20 w-52 sm:w-60 rounded-2xl border border-white/[0.08] bg-[#08080A]/90 backdrop-blur-md p-3 shadow-2xl pointer-events-none">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2 px-1">
            <span className="inline-flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-zinc-300" />
              <span>Leaderboard</span>
            </span>
            <span className="font-mono-code text-[10px] text-zinc-500">LÄNGE</span>
          </div>

          <ul className="space-y-1">
            {world.leaderboard.map((entry, idx) => {
              const isMe = entry.id === room.myPlayerId;
              const colorMeta = SNAKE_COLORS[entry.colorId] ?? SNAKE_COLORS.white;
              return (
                <li
                  key={entry.id}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs ${
                    isMe ? 'bg-white text-black font-semibold' : 'text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`font-mono-code text-[10px] w-4 shrink-0 ${
                        isMe ? 'text-zinc-600' : 'text-zinc-500'
                      }`}
                    >
                      {idx + 1}.
                    </span>
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: colorMeta.primary }}
                    />
                    <span className="truncate">{entry.name}</span>
                    {entry.isBot && (
                      <span
                        className={`text-[9px] font-mono-code uppercase px-1 rounded ${
                          isMe ? 'bg-black/15 text-black' : 'bg-white/[0.07] text-zinc-500'
                        }`}
                      >
                        BOT
                      </span>
                    )}
                  </div>
                  <span className="font-mono-code text-[11px] shrink-0">{entry.length}</span>
                </li>
              );
            })}
          </ul>
        </aside>
      )}

      {/* Bottom-Left: Personal Stats & Boost Indicator */}
      <div className="fixed bottom-3 left-3 z-20 rounded-2xl border border-white/[0.08] bg-[#08080A]/90 backdrop-blur-md px-4 py-3 shadow-2xl pointer-events-none min-w-[205px]">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Länge</div>
            <div className="font-mono-code text-base font-bold text-white">
              {mySnake && mySnake.alive ? mySnake.score : mySnake?.lastRunScore ?? 0}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Kills</div>
            <div className="font-mono-code text-base font-bold text-white">
              {mySnake && mySnake.alive ? mySnake.kills : meLobby?.kills ?? 0}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Rang</div>
            <div className="font-mono-code text-base font-bold text-white">
              {myRank ? `#${myRank}` : '—'}
            </div>
          </div>
        </div>

        <div className="mt-2.5 pt-2 border-t border-white/[0.06] space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="inline-flex items-center gap-1 text-zinc-400 uppercase tracking-wider">
              <Zap className={`w-3 h-3 ${mySnake?.boosting ? 'text-white' : 'text-zinc-500'}`} />
              <span>{canBoost ? (mySnake?.boosting ? 'Boost aktiv!' : 'Boost bereit') : 'Min. 65'}</span>
            </span>
            <span className="font-mono-code text-zinc-500">
              Best: {meLobby?.bestScore ?? mySnake?.score ?? 50}
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-white/[0.08] overflow-hidden">
            <div
              className="h-full rounded-full bg-white transition-all duration-150"
              style={{ width: `${canBoost ? Math.max(12, boostFuelPct) : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Mobile Touch Boost Button (shown when alive) */}
      {isAlive && (
        <button
          type="button"
          onTouchStart={(e) => {
            e.preventDefault();
            touchBoostRef.current = true;
            onSendInput(steerAngleRef.current, true);
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            touchBoostRef.current = false;
            onSendInput(steerAngleRef.current, isBoostActive());
          }}
          className="fixed bottom-5 right-36 z-20 sm:hidden rounded-full border border-white/25 bg-white/10 backdrop-blur-md px-5 py-3 text-xs font-bold uppercase tracking-wider text-white active:bg-white active:text-black touch-none"
        >
          Boost
        </button>
      )}

      {/* Bottom-Right: Circular Radar Minimap */}
      {world && (
        <div className="fixed bottom-3 right-3 z-20 rounded-2xl border border-white/[0.08] bg-[#08080A]/90 backdrop-blur-md p-2 shadow-2xl pointer-events-none">
          <svg
            width="108"
            height="108"
            viewBox="-60 -60 120 120"
            aria-label="Arena Radar Minimap"
            className="block"
          >
            <circle cx="0" cy="0" r="54" fill="#030305" stroke="rgba(239,68,68,0.45)" strokeWidth="1.5" />
            <line x1="-54" y1="0" x2="54" y2="0" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <line x1="0" y1="-54" x2="0" y2="54" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            {world.snakes.map((s: CompactSnakeSnapshot) => {
              if (!s.alive || s.pts.length < 2) return null;
              const rx = (s.pts[0] / world.arenaRadius) * 52;
              const ry = (s.pts[1] / world.arenaRadius) * 52;
              const isMe = s.id === room.myPlayerId;
              const isLeader = world.leaderboard[0]?.id === s.id;
              const colorMeta = SNAKE_COLORS[s.colorId] ?? SNAKE_COLORS.white;

              if (isMe) {
                return (
                  <g key={s.id}>
                    <circle cx={rx} cy={ry} r="4.8" fill="rgba(255,255,255,0.28)" />
                    <circle cx={rx} cy={ry} r="2.6" fill="#ffffff" />
                  </g>
                );
              }

              return (
                <circle
                  key={s.id}
                  cx={rx}
                  cy={ry}
                  r={isLeader ? 2.6 : s.isBot ? 1.4 : 2.1}
                  fill={isLeader ? '#f59e0b' : colorMeta.primary}
                  opacity={s.isBot ? 0.65 : 0.95}
                />
              );
            })}
          </svg>
        </div>
      )}

      {/* Spectator Floating Re-entry Bar */}
      {!isAlive && spectating && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-2xl border border-white/20 bg-[#08080A]/95 backdrop-blur-md px-4 py-2.5 shadow-2xl animate-pop-in">
          <span className="text-xs text-zinc-400">Zuschauermodus</span>
          <button
            type="button"
            onClick={() => void handleRespawnClick()}
            disabled={respawning}
            className="rounded-xl bg-white text-black px-4 py-1.5 text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
          >
            {respawning ? 'Spawne…' : 'Wieder einsteigen'}
          </button>
        </div>
      )}

      {/* Death & Respawn Modal Overlay */}
      {mySnake && !mySnake.alive && !spectating && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#08080A] p-6 space-y-5 shadow-2xl animate-pop-in">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono-code uppercase tracking-widest text-red-400 mb-1">
                  Ausgeschaltet
                </div>
                <h2 className="text-2xl font-bold tracking-[-0.03em] text-white">
                  {mySnake.eliminatedBy === 'Arena-Wand'
                    ? 'Arena-Wand berührt'
                    : mySnake.eliminatedBy
                      ? `Besiegt von ${mySnake.eliminatedBy}`
                      : 'Runde beendet'}
                </h2>
              </div>
              <div className="w-10 h-10 rounded-full border border-red-500/30 bg-red-500/10 flex items-center justify-center shrink-0">
                <Skull className="w-5 h-5 text-red-400" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="rounded-xl border border-white/[0.08] bg-black p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Länge</div>
                <div className="font-mono-code text-lg font-bold text-white mt-0.5">
                  {mySnake.lastRunScore}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-black p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Kills</div>
                <div className="font-mono-code text-lg font-bold text-white mt-0.5">
                  {mySnake.lastRunKills}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-black p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Bestwert</div>
                <div className="font-mono-code text-lg font-bold text-white mt-0.5">
                  {meLobby?.bestScore ?? mySnake.lastRunScore}
                </div>
              </div>
            </div>

            {/* Color switch before respawn */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-xs text-zinc-400">Farbe wechseln:</span>
              <div className="flex flex-wrap gap-1.5">
                {SNAKE_COLOR_LIST.map((c) => {
                  const active = (meLobby?.colorId ?? mySnake.colorId) === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onSetPlayerColor(c.id)}
                      aria-label={c.labelDe}
                      className={`w-5 h-5 rounded-full transition-all cursor-pointer ${
                        active
                          ? 'ring-2 ring-white ring-offset-2 ring-offset-[#08080A] scale-110'
                          : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c.primary }}
                    />
                  );
                })}
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                disabled={respawning}
                onClick={() => void handleRespawnClick()}
                className="w-full rounded-xl bg-white text-black font-semibold text-sm py-3.5 px-4 hover:bg-zinc-200 disabled:opacity-50 transition-all cursor-pointer"
              >
                {respawning ? 'Spawne…' : 'Sofort respawnen (Space / Enter)'}
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSpectating(true)}
                  className="flex-1 rounded-xl border border-white/15 bg-white/[0.04] text-zinc-300 text-xs font-medium py-2.5 px-3 hover:text-white hover:bg-white/[0.09] transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Zuschauen</span>
                </button>

                {isHost && (
                  <button
                    type="button"
                    onClick={onReturnToLobby}
                    className="flex-1 rounded-xl border border-white/15 bg-white/[0.04] text-zinc-300 text-xs font-medium py-2.5 px-3 hover:text-white hover:bg-white/[0.09] transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Lobby</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onLeave}
                  className="rounded-xl border border-white/15 bg-white/[0.04] text-zinc-400 text-xs font-medium py-2.5 px-3 hover:text-white hover:bg-white/[0.09] transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Verlassen</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

