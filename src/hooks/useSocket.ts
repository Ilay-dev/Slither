import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import { normalizeAngle } from '../../shared/gameEngine.ts';
import type {
  ClientRoomState,
  RoomActionResponse,
  SessionCredentials,
  SnakeColorId,
  WorldSnapshot,
} from '../../shared/types.ts';
import { BrowserHostManager, generateBrowserRoomCode } from '../p2p/hostManager.ts';

const SESSION_KEY = 'slither_p2p_session';

const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
    iceCandidatePoolSize: 10,
  },
};

type PeerReqPayload =
  | { type: 'join'; playerName: string; colorId?: SnakeColorId }
  | { type: 'rejoin'; credentials: SessionCredentials }
  | {
      type: 'action';
      action: string;
      payload?: Record<string, unknown>;
    };

type PeerMsgToHost =
  | { type: 'ping' }
  | { type: 'input'; angle: number; boosting: boolean }
  | (PeerReqPayload & { requestId: string });

type PeerMsgToGuest =
  | { type: 'res'; requestId: string; response: RoomActionResponse }
  | { type: 'state'; state: ClientRoomState }
  | { type: 'kicked'; reason: string };

interface StoredGuestSession {
  role: 'guest';
  credentials: SessionCredentials;
}

function saveGuestSession(creds: SessionCredentials | null): void {
  try {
    if (creds) {
      const payload: StoredGuestSession = { role: 'guest', credentials: creds };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function loadGuestSession(): StoredGuestSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredGuestSession;
    if (
      parsed?.role === 'guest' &&
      parsed.credentials?.roomCode &&
      parsed.credentials?.playerId &&
      parsed.credentials?.reconnectToken
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function useSlitherSocket() {
  const peerRef = useRef<Peer | null>(null);
  const hostManagerRef = useRef<BrowserHostManager | null>(null);
  const guestConnectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const guestConnRef = useRef<DataConnection | null>(null);
  const pendingRequestsRef = useRef<
    Map<string, { resolve: (res: RoomActionResponse) => void; timer: ReturnType<typeof setTimeout> }>
  >(new Map());
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastInputSentAtRef = useRef<number>(0);
  const lastAngleSentRef = useRef<number>(0);
  const lastBoostSentRef = useRef<boolean>(false);

  const worldStreamRef = useRef<{ snapshot: WorldSnapshot; receivedAt: number } | null>(null);
  const lastHudCommitAtRef = useRef<number>(0);
  const prevStateMetaRef = useRef<{
    phase: string;
    playersLen: number;
    botCount: number;
    myAlive: boolean | null;
  }>({ phase: '', playersLen: 0, botCount: -1, myAlive: null });

  const [connected, setConnected] = useState(true);
  const [roomState, setRoomState] = useState<ClientRoomState | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const applyIncomingState = useCallback((state: ClientRoomState | null) => {
    if (!state) {
      worldStreamRef.current = null;
      prevStateMetaRef.current = { phase: '', playersLen: 0, botCount: -1, myAlive: null };
      setRoomState(null);
      return;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (state.world) {
      worldStreamRef.current = { snapshot: state.world, receivedAt: now };
    } else if (state.phase !== 'playing') {
      worldStreamRef.current = null;
    }

    const mySnake = state.world?.snakes.find((s) => s.id === state.myPlayerId);
    const myAlive = mySnake ? mySnake.alive : null;
    const prev = prevStateMetaRef.current;

    const structuralChange =
      state.phase !== 'playing' ||
      state.world === null ||
      prev.phase !== state.phase ||
      prev.playersLen !== state.players.length ||
      prev.botCount !== state.config.botCount ||
      prev.myAlive !== myAlive;

    if (structuralChange || now - lastHudCommitAtRef.current >= 66) {
      lastHudCommitAtRef.current = now;
      prevStateMetaRef.current = {
        phase: state.phase,
        playersLen: state.players.length,
        botCount: state.config.botCount,
        myAlive,
      };
      setRoomState(state);
    }
  }, []);

  const showError = useCallback((msg: string) => {
    setErrorBanner(msg);
  }, []);

  const clearError = useCallback(() => {
    setErrorBanner(null);
  }, []);

  const cleanupPeerResources = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    for (const pending of pendingRequestsRef.current.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: 'Verbindung geschlossen.' });
    }
    pendingRequestsRef.current.clear();

    if (hostManagerRef.current) {
      hostManagerRef.current.destroy();
      hostManagerRef.current = null;
    }
    for (const conn of guestConnectionsRef.current.values()) {
      try {
        conn.close();
      } catch {
        // ignore
      }
    }
    guestConnectionsRef.current.clear();

    if (guestConnRef.current) {
      try {
        guestConnRef.current.close();
      } catch {
        // ignore
      }
      guestConnRef.current = null;
    }
    if (peerRef.current) {
      try {
        peerRef.current.destroy();
      } catch {
        // ignore
      }
      peerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupPeerResources();
    };
  }, [cleanupPeerResources]);

  const sendRequestToHost = useCallback(
    (msg: PeerReqPayload): Promise<RoomActionResponse> => {
      return new Promise((resolve) => {
        const conn = guestConnRef.current;
        if (!conn || !conn.open) {
          resolve({ ok: false, error: 'Keine Verbindung zum Host.' });
          return;
        }
        const requestId = globalThis.crypto.randomUUID();
        const timer = setTimeout(() => {
          pendingRequestsRef.current.delete(requestId);
          resolve({ ok: false, error: 'Zeitüberschreitung beim Host.' });
        }, 10_000);

        pendingRequestsRef.current.set(requestId, { resolve, timer });
        conn.send({ ...msg, requestId });
      });
    },
    []
  );

  const connectAsGuest = useCallback(
    (
      roomCode: string,
      onOpened: (conn: DataConnection) => Promise<RoomActionResponse>
    ): Promise<RoomActionResponse> => {
      cleanupPeerResources();
      saveGuestSession(null);

      const cleanCode = roomCode.trim().toUpperCase();
      const targetHostPeerId = `slither-room-${cleanCode}`;

      return new Promise((resolve) => {
        const peer = new Peer(PEER_OPTIONS);
        peerRef.current = peer;
        let settled = false;

        const fail = (message: string) => {
          if (settled) return;
          settled = true;
          setConnected(true);
          setErrorBanner(message);
          cleanupPeerResources();
          resolve({ ok: false, error: message });
        };

        const overallTimer = setTimeout(() => {
          fail('Host nicht erreichbar oder Room existiert nicht.');
        }, 14_000);

        peer.on('open', () => {
          const conn = peer.connect(targetHostPeerId, { reliable: true });
          guestConnRef.current = conn;

          conn.on('data', (raw) => {
            const data = raw as PeerMsgToGuest;
            if (!data || typeof data !== 'object') return;
            if (data.type === 'res') {
              const pending = pendingRequestsRef.current.get(data.requestId);
              if (pending) {
                clearTimeout(pending.timer);
                pendingRequestsRef.current.delete(data.requestId);
                pending.resolve(data.response);
              }
            } else if (data.type === 'state') {
              applyIncomingState(data.state);
            } else if (data.type === 'kicked') {
              saveGuestSession(null);
              cleanupPeerResources();
              applyIncomingState(null);
              setErrorBanner(data.reason);
            }
          });

          conn.on('open', async () => {
            setConnected(true);
            heartbeatRef.current = setInterval(() => {
              if (conn.open) {
                conn.send({ type: 'ping' } satisfies PeerMsgToHost);
              }
            }, 15_000);

            const res = await onOpened(conn);
            clearTimeout(overallTimer);
            if (!settled) {
              settled = true;
              if (!res.ok) {
                if (res.error) setErrorBanner(res.error);
                cleanupPeerResources();
              } else if (res.credentials) {
                saveGuestSession(res.credentials);
                setErrorBanner(null);
              }
              resolve(res);
            }
          });

          conn.on('close', () => {
            clearTimeout(overallTimer);
            if (!settled) {
              fail('Verbindung zum Host fehlgeschlagen.');
            } else {
              setConnected(false);
              setErrorBanner('Der Host hat die Verbindung beendet.');
              saveGuestSession(null);
              cleanupPeerResources();
              applyIncomingState(null);
            }
          });

          conn.on('error', () => {
            clearTimeout(overallTimer);
            fail('WebRTC-Verbindungsfehler zum Host.');
          });
        });

        peer.on('error', (err) => {
          clearTimeout(overallTimer);
          const msg =
            err.type === 'peer-unavailable'
              ? 'Room nicht gefunden. Prüfe den Room-Code oder ob der Host noch online ist.'
              : 'Verbindung zum Signaling-Dienst fehlgeschlagen.';
          fail(msg);
        });
      });
    },
    [applyIncomingState, cleanupPeerResources]
  );

  // Auto-rejoin guest session on page reload
  useEffect(() => {
    const saved = loadGuestSession();
    if (!saved) return;
    void connectAsGuest(saved.credentials.roomCode, () =>
      sendRequestToHost({ type: 'rejoin', credentials: saved.credentials })
    );
  }, [connectAsGuest, sendRequestToHost]);

  const createRoom = useCallback(
    (
      playerName: string,
      colorId: SnakeColorId,
      botCount: number
    ): Promise<RoomActionResponse> => {
      cleanupPeerResources();
      saveGuestSession(null);

      return new Promise((resolve) => {
        let attempts = 0;

        const tryCreate = () => {
          attempts += 1;
          const roomCode = generateBrowserRoomCode();
          const hostPeerId = `slither-room-${roomCode}`;
          const peer = new Peer(hostPeerId, PEER_OPTIONS);
          peerRef.current = peer;
          let opened = false;

          const timeout = setTimeout(() => {
            if (!opened) {
              cleanupPeerResources();
              const msg = 'Konnte P2P-Host nicht starten. Bitte erneut versuchen.';
              setErrorBanner(msg);
              resolve({ ok: false, error: msg });
            }
          }, 12_000);

          peer.on('open', () => {
            opened = true;
            clearTimeout(timeout);
            setConnected(true);
            setErrorBanner(null);

            const manager = new BrowserHostManager(
              roomCode,
              playerName,
              colorId,
              botCount,
              (targetPeerId, state) => {
                if (targetPeerId === 'HOST_LOCAL') {
                  applyIncomingState(state);
                  return;
                }
                const conn = guestConnectionsRef.current.get(targetPeerId);
                if (conn?.open) {
                  conn.send({ type: 'state', state } satisfies PeerMsgToGuest);
                }
              },
              (targetPeerId, reason) => {
                const conn = guestConnectionsRef.current.get(targetPeerId);
                if (conn?.open) {
                  conn.send({ type: 'kicked', reason } satisfies PeerMsgToGuest);
                  setTimeout(() => conn.close(), 100);
                }
                guestConnectionsRef.current.delete(targetPeerId);
              }
            );
            hostManagerRef.current = manager;
            manager.broadcast();

            resolve({
              ok: true,
              credentials: {
                roomCode,
                playerId: manager.getHostPlayerId(),
                reconnectToken: 'host',
              },
            });
          });

          peer.on('connection', (conn) => {
            guestConnectionsRef.current.set(conn.peer, conn);

            conn.on('data', (raw) => {
              const msg = raw as PeerMsgToHost;
              const manager = hostManagerRef.current;
              if (!manager || !msg || typeof msg !== 'object') return;
              if (msg.type === 'ping') return;

              if (msg.type === 'input') {
                manager.handlePlayerInput(conn.peer, msg.angle, msg.boosting);
                return;
              }

              let response: RoomActionResponse = { ok: false, error: 'Ungültige Anfrage.' };
              if (msg.type === 'join') {
                response = manager.joinGuest(conn.peer, msg.playerName, msg.colorId);
              } else if (msg.type === 'rejoin') {
                response = manager.rejoinGuest(conn.peer, msg.credentials);
              } else if (msg.type === 'action') {
                response = manager.handleAction(conn.peer, msg.action, msg.payload);
              }

              if (conn.open && 'requestId' in msg) {
                conn.send({
                  type: 'res',
                  requestId: msg.requestId,
                  response,
                } satisfies PeerMsgToGuest);
              }
            });

            conn.on('close', () => {
              guestConnectionsRef.current.delete(conn.peer);
              hostManagerRef.current?.handlePeerDisconnect(conn.peer);
            });

            conn.on('error', () => {
              guestConnectionsRef.current.delete(conn.peer);
              hostManagerRef.current?.handlePeerDisconnect(conn.peer);
            });
          });

          peer.on('disconnected', () => {
            try {
              if (!peer.destroyed) peer.reconnect();
            } catch {
              // ignore
            }
          });

          peer.on('error', (err) => {
            clearTimeout(timeout);
            if (!opened && err.type === 'unavailable-id' && attempts < 3) {
              peer.destroy();
              tryCreate();
              return;
            }
            if (!opened) {
              cleanupPeerResources();
              const msg = 'Verbindung zum P2P-Signaling fehlgeschlagen.';
              setErrorBanner(msg);
              resolve({ ok: false, error: msg });
            }
          });
        };

        tryCreate();
      });
    },
    [applyIncomingState, cleanupPeerResources]
  );

  const joinRoom = useCallback(
    (
      roomCode: string,
      playerName: string,
      colorId: SnakeColorId
    ): Promise<RoomActionResponse> => {
      return connectAsGuest(roomCode, () =>
        sendRequestToHost({ type: 'join', playerName, colorId })
      );
    },
    [connectAsGuest, sendRequestToHost]
  );

  const leaveRoom = useCallback(async (): Promise<void> => {
    saveGuestSession(null);
    if (guestConnRef.current?.open) {
      await sendRequestToHost({ type: 'action', action: 'room:leave' });
    }
    cleanupPeerResources();
    applyIncomingState(null);
    setErrorBanner(null);
    setConnected(true);
  }, [applyIncomingState, cleanupPeerResources, sendRequestToHost]);

  const dispatchAction = useCallback(
    async (
      action: string,
      payload?: Record<string, unknown>,
      options?: { silentError?: boolean }
    ): Promise<RoomActionResponse> => {
      if (hostManagerRef.current) {
        const res = hostManagerRef.current.handleAction('HOST_LOCAL', action, payload);
        if (!res.ok && res.error && !options?.silentError) {
          setErrorBanner(res.error);
        }
        return res;
      }

      if (guestConnRef.current?.open) {
        const res = await sendRequestToHost({ type: 'action', action, payload });
        if (!res.ok && res.error && !options?.silentError) {
          setErrorBanner(res.error);
        }
        return res;
      }

      const msg = 'Keine aktive Verbindung zum Host.';
      if (!options?.silentError) setErrorBanner(msg);
      return { ok: false, error: msg };
    },
    [sendRequestToHost]
  );

  const sendInput = useCallback((angle: number, boosting: boolean) => {
    if (hostManagerRef.current) {
      hostManagerRef.current.handlePlayerInput('HOST_LOCAL', angle, boosting);
      return;
    }

    const conn = guestConnRef.current;
    if (!conn || !conn.open) return;

    const now = performance.now();
    const boostChanged = boosting !== lastBoostSentRef.current;
    const angleDelta = Math.abs(normalizeAngle(angle - lastAngleSentRef.current));
    if (!boostChanged && angleDelta <= 0.015 && now - lastInputSentAtRef.current < 16) {
      return;
    }
    if (!boostChanged && angleDelta < 0.002 && now - lastInputSentAtRef.current < 50) {
      return;
    }
    lastInputSentAtRef.current = now;
    lastAngleSentRef.current = angle;
    lastBoostSentRef.current = boosting;
    conn.send({
      type: 'input',
      angle: Number(angle.toFixed(3)),
      boosting,
    } satisfies PeerMsgToHost);
  }, []);

  const toggleReady = useCallback(() => {
    void dispatchAction('room:toggle_ready');
  }, [dispatchAction]);

  const setBotCount = useCallback(
    (botCount: number) => {
      void dispatchAction('room:set_config', { botCount });
    },
    [dispatchAction]
  );

  const setPlayerColor = useCallback(
    (colorId: SnakeColorId) => {
      void dispatchAction('room:set_color', { colorId });
    },
    [dispatchAction]
  );

  const startNow = useCallback(() => {
    void dispatchAction('room:start_now');
  }, [dispatchAction]);

  const removePlayer = useCallback(
    (targetPlayerId: string) => {
      void dispatchAction('room:remove_player', { targetPlayerId });
    },
    [dispatchAction]
  );

  const returnToLobby = useCallback(() => {
    void dispatchAction('room:return_to_lobby');
  }, [dispatchAction]);

  const respawn = useCallback((): Promise<RoomActionResponse> => {
    return dispatchAction('game:respawn', undefined, { silentError: true });
  }, [dispatchAction]);

  return {
    connected,
    roomState,
    worldStreamRef,
    errorBanner,
    showError,
    clearError,
    createRoom,
    joinRoom,
    leaveRoom,
    toggleReady,
    setBotCount,
    setPlayerColor,
    startNow,
    removePlayer,
    returnToLobby,
    respawn,
    sendInput,
  };
}

