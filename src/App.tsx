import { useCallback, useEffect, useRef, useState } from 'react';
import { HomeScreen } from './components/HomeScreen.tsx';
import { LobbyScreen } from './components/LobbyScreen.tsx';
import { SlitherArena } from './components/SlitherArena.tsx';
import { useSlitherSocket } from './hooks/useSocket.ts';
import { useSound } from './hooks/useSound.ts';

function readRoomParam(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const code = params.get('room') ?? '';
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export default function App() {
  const [initialRoomCode, setInitialRoomCode] = useState<string>(() => readRoomParam());
  const wasInRoomRef = useRef(false);

  const {
    connected,
    roomState,
    errorBanner,
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
  } = useSlitherSocket();

  const {
    soundEnabled,
    toggleSound,
    playOrbSound,
    playBoostSound,
    playKillSound,
    playDeathSound,
    playStartSound,
  } = useSound();

  // Auto-dismiss transient error toast after 4.5s
  useEffect(() => {
    if (!errorBanner) return;
    const timer = setTimeout(() => clearError(), 4500);
    return () => clearTimeout(timer);
  }, [errorBanner, clearError]);

  const clearInviteParam = useCallback(() => {
    setInitialRoomCode('');
    if (typeof window !== 'undefined' && window.location.search) {
      const url = new URL(window.location.href);
      if (url.searchParams.has('room')) {
        url.searchParams.delete('room');
        window.history.replaceState({}, '', `${url.pathname}${url.search}`);
      }
    }
  }, []);

  // Keep URL cleanly updated with ?room=CODE
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (roomState?.roomCode) {
      wasInRoomRef.current = true;
      const url = new URL(window.location.href);
      if (url.searchParams.get('room') !== roomState.roomCode) {
        url.searchParams.set('room', roomState.roomCode);
        window.history.replaceState({}, '', `${url.pathname}${url.search}`);
      }
    } else if (wasInRoomRef.current) {
      wasInRoomRef.current = false;
      clearInviteParam();
    }
  }, [roomState?.roomCode, clearInviteParam]);

  const handleLeaveRoom = async () => {
    await leaveRoom();
    clearInviteParam();
  };

  if (!roomState) {
    return (
      <HomeScreen
        connected={connected}
        initialRoomCode={initialRoomCode}
        errorMessage={errorBanner}
        onCreateRoom={async (name, colorId, botCount) => {
          await createRoom(name, colorId, botCount);
        }}
        onJoinRoom={async (code, name, colorId) => {
          await joinRoom(code, name, colorId);
        }}
        onClearInvite={clearInviteParam}
        onClearError={clearError}
      />
    );
  }

  return (
    <>
      {errorBanner && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-white/25 bg-[#111113] px-4 py-2.5 text-xs text-white shadow-2xl flex items-center gap-3">
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={clearError}
            className="text-zinc-400 hover:text-white cursor-pointer"
          >
            OK
          </button>
        </div>
      )}

      {roomState.phase === 'lobby' ? (
        <LobbyScreen
          room={roomState}
          connected={connected}
          onToggleReady={toggleReady}
          onSetBotCount={setBotCount}
          onSetPlayerColor={setPlayerColor}
          onStartNow={startNow}
          onRemovePlayer={removePlayer}
          onLeave={() => void handleLeaveRoom()}
        />
      ) : (
        <SlitherArena
          room={roomState}
          connected={connected}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          onSendInput={sendInput}
          onRespawn={respawn}
          onSetBotCount={setBotCount}
          onSetPlayerColor={setPlayerColor}
          onReturnToLobby={returnToLobby}
          onLeave={() => void handleLeaveRoom()}
          onPlayOrbSound={playOrbSound}
          onPlayBoostSound={playBoostSound}
          onPlayKillSound={playKillSound}
          onPlayDeathSound={playDeathSound}
          onPlayStartSound={playStartSound}
        />
      )}
    </>
  );
}

