import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowRight, BookOpen, Bot, Plus, Wifi, WifiOff } from 'lucide-react';
import { clampBotCount } from '../../shared/gameEngine.ts';
import {
  DEFAULT_BOT_COUNT,
  MAX_BOT_COUNT,
  MAX_HUMAN_PLAYERS,
  MIN_BOT_COUNT,
  SNAKE_COLORS,
  SNAKE_COLOR_LIST,
  type SnakeColorId,
} from '../../shared/types.ts';

interface HomeScreenProps {
  connected: boolean;
  initialRoomCode: string;
  errorMessage: string | null;
  onCreateRoom: (playerName: string, colorId: SnakeColorId, botCount: number) => Promise<void>;
  onJoinRoom: (roomCode: string, playerName: string, colorId: SnakeColorId) => Promise<void>;
  onClearInvite: () => void;
  onClearError: () => void;
}

const NAME_STORAGE_KEY = 'slither_player_name';
const COLOR_STORAGE_KEY = 'slither_color_id';
const BOTS_STORAGE_KEY = 'slither_bot_count';
const BOT_PRESETS = [0, 10, 20, 30];

export function HomeScreen({
  connected,
  initialRoomCode,
  errorMessage,
  onCreateRoom,
  onJoinRoom,
  onClearInvite,
  onClearError,
}: HomeScreenProps) {
  const [playerName, setPlayerName] = useState<string>(() => {
    try {
      return localStorage.getItem(NAME_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });

  const [colorId, setColorId] = useState<SnakeColorId>(() => {
    try {
      const saved = localStorage.getItem(COLOR_STORAGE_KEY) as SnakeColorId | null;
      return saved && saved in SNAKE_COLORS ? saved : 'emerald';
    } catch {
      return 'emerald';
    }
  });

  const [botCount, setBotCount] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(BOTS_STORAGE_KEY);
      if (saved !== null) {
        const parsed = Number.parseInt(saved, 10);
        if (Number.isFinite(parsed)) return clampBotCount(parsed);
      }
      return DEFAULT_BOT_COUNT;
    } catch {
      return DEFAULT_BOT_COUNT;
    }
  });

  const [roomCode, setRoomCode] = useState<string>(initialRoomCode);
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const [submitting, setSubmitting] = useState<'create' | 'join' | null>(null);
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    if (initialRoomCode) {
      setRoomCode(initialRoomCode);
      setInviteDismissed(false);
    }
  }, [initialRoomCode]);

  const persistPrefs = (name: string, color: SnakeColorId, bots: number) => {
    try {
      localStorage.setItem(NAME_STORAGE_KEY, name);
      localStorage.setItem(COLOR_STORAGE_KEY, color);
      localStorage.setItem(BOTS_STORAGE_KEY, String(bots));
    } catch {
      // ignore storage issues
    }
  };

  const dismissInvite = () => {
    setInviteDismissed(true);
    setRoomCode('');
    onClearError();
    onClearInvite();
  };

  const handleCreate = async () => {
    const cleanName = playerName.trim();
    if (!cleanName || submitting) return;
    const cleanBots = clampBotCount(botCount);
    onClearError();
    onClearInvite();
    setInviteDismissed(true);
    persistPrefs(cleanName, colorId, cleanBots);
    setSubmitting('create');
    try {
      await onCreateRoom(cleanName, colorId, cleanBots);
    } finally {
      setSubmitting(null);
    }
  };

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();
    const cleanName = playerName.trim();
    const cleanCode = roomCode.trim().toUpperCase();
    if (!cleanName || cleanCode.length < 4 || submitting) return;
    onClearError();
    persistPrefs(cleanName, colorId, botCount);
    setSubmitting('join');
    try {
      await onJoinRoom(cleanCode, cleanName, colorId);
    } finally {
      setSubmitting(null);
    }
  };

  const hasName = playerName.trim().length > 0;
  const hasInviteCode = initialRoomCode.length > 0 && !inviteDismissed;
  const botPct = ((botCount - MIN_BOT_COUNT) / (MAX_BOT_COUNT - MIN_BOT_COUNT)) * 100;
  const selectedColorMeta = SNAKE_COLORS[colorId];

  return (
    <div className="min-h-screen bg-black text-white flex flex-col justify-between px-4 py-8 sm:px-6">
      {/* Top status bar */}
      <header className="max-w-xl w-full mx-auto flex items-center justify-between text-xs text-zinc-500">
        <div className="inline-flex items-center gap-1.5">
          {connected ? (
            <Wifi className="w-3.5 h-3.5 text-zinc-400" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-zinc-600" />
          )}
          <span>{connected ? 'P2P Host-Modus bereit' : 'Verbinde…'}</span>
        </div>

        <button
          type="button"
          onClick={() => setShowRules((v) => !v)}
          className="inline-flex items-center gap-1.5 text-zinc-500 hover:text-white transition-colors cursor-pointer"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>{showRules ? 'Regeln ausblenden' : 'Spielregeln'}</span>
        </button>
      </header>

      {/* Main content */}
      <main className="max-w-md w-full mx-auto my-auto py-8">
        {/* Minimalist Wordmark */}
        <div className="mb-9">
          <div className="flex items-center gap-3.5 mb-3">
            <h1 className="text-5xl font-bold tracking-[-0.04em] text-white">SLITHER</h1>
            <div className="flex items-center gap-1 pt-1" aria-hidden="true">
              <span
                className="w-3.5 h-3.5 rounded-full transition-colors"
                style={{
                  backgroundColor: selectedColorMeta.primary,
                  boxShadow: `0 0 12px ${selectedColorMeta.glow}`,
                }}
              />
              <span
                className="w-2.5 h-2.5 rounded-full opacity-85 transition-colors"
                style={{ backgroundColor: selectedColorMeta.primary }}
              />
              <span
                className="w-2 h-2 rounded-full opacity-65 transition-colors"
                style={{ backgroundColor: selectedColorMeta.primary }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full opacity-45 transition-colors"
                style={{ backgroundColor: selectedColorMeta.primary }}
              />
            </div>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Minimalistische Online-Slither-Arena für bis zu {MAX_HUMAN_PLAYERS} Spieler &amp; bis zu{' '}
            {MAX_BOT_COUNT} automatische KI-Bots — direkt im Browser über WebRTC P2P.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-6 rounded-xl border border-white/25 bg-white/[0.06] px-4 py-3 text-sm text-white flex items-center justify-between gap-3">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={onClearError}
              className="text-xs text-zinc-400 hover:text-white shrink-0 cursor-pointer"
            >
              OK
            </button>
          </div>
        )}

        {showRules && (
          <div className="mb-6 rounded-2xl border border-white/[0.08] bg-[#08080A] p-4 text-xs text-zinc-300 space-y-2 leading-relaxed animate-pop-in">
            <div className="font-semibold text-white">Arena-Regeln &amp; Steuerung</div>
            <ul className="space-y-1 text-zinc-400 list-disc pl-4">
              <li>
                Multiplayer für 1–{MAX_HUMAN_PLAYERS} Spieler plus bis zu {MAX_BOT_COUNT} intelligente
                KI-Bots.
              </li>
              <li>Steuerung per Mauszeiger, Pfeiltasten / A &amp; D oder Touch-Drag.</li>
              <li>
                Linksklick, Leertaste oder W aktiviert den Boost (kostet Masse &amp; hinterlässt
                Orbs).
              </li>
              <li>
                Sammle leuchtende Orbs ein, um zu wachsen — schneide Gegnern den Weg ab, damit sie an
                deinem Körper explodieren.
              </li>
              <li>Berührst du den Körper eines Gegners, bist du raus (sofortiger Respawn). Die Arena-Wand begrenzt nur das Spielfeld.</li>
            </ul>
          </div>
        )}

        <div className="space-y-5">
          {/* Player Name */}
          <div>
            <label
              htmlFor="player-name"
              className="block text-xs font-medium uppercase tracking-wider text-zinc-400 mb-2"
            >
              Dein Name
            </label>
            <input
              id="player-name"
              type="text"
              maxLength={18}
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="z. B. Alex"
              autoFocus
              className="w-full rounded-xl border border-white/15 bg-[#0A0A0B] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white transition-colors"
            />
          </div>

          {/* Snake Color Picker */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#08080A] p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium uppercase tracking-wider text-zinc-400">
                Schlangenfarbe
              </span>
              <span className="font-mono-code text-[11px] text-zinc-300">
                {selectedColorMeta.labelDe}
              </span>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {SNAKE_COLOR_LIST.map((c) => {
                const active = c.id === colorId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setColorId(c.id)}
                    aria-label={c.labelDe}
                    title={c.labelDe}
                    className={`w-8 h-8 rounded-full transition-all cursor-pointer flex items-center justify-center ${
                      active
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-[#08080A] scale-110'
                        : 'opacity-70 hover:opacity-100 hover:scale-105'
                    }`}
                    style={{
                      backgroundColor: c.primary,
                      boxShadow: active ? `0 0 14px ${c.glow}` : undefined,
                    }}
                  />
                );
              })}
            </div>
          </div>

          {!hasInviteCode ? (
            <>
              {/* Bot Count Picker */}
              <div className="rounded-2xl border border-white/[0.08] bg-[#08080A] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="bot-count-slider"
                    className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-400"
                  >
                    <Bot className="w-3.5 h-3.5 text-zinc-300" />
                    <span>Automatische Bots</span>
                  </label>
                  <span className="font-mono-code text-xs font-semibold text-white">
                    {botCount} / {MAX_BOT_COUNT}
                  </span>
                </div>

                <input
                  id="bot-count-slider"
                  type="range"
                  min={MIN_BOT_COUNT}
                  max={MAX_BOT_COUNT}
                  step={1}
                  value={botCount}
                  onChange={(e) => setBotCount(clampBotCount(Number.parseInt(e.target.value, 10)))}
                  style={{ '--slider-pct': `${botPct}%` } as CSSProperties}
                  className="slither-slider"
                />

                <div className="flex items-center justify-between gap-1.5">
                  {BOT_PRESETS.map((preset) => {
                    const active = botCount === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setBotCount(preset)}
                        className={`flex-1 rounded-lg py-1 text-[11px] font-mono-code transition-all cursor-pointer ${
                          active
                            ? 'bg-white text-black font-semibold'
                            : 'bg-white/[0.04] text-zinc-400 hover:text-white hover:bg-white/[0.09]'
                        }`}
                      >
                        {preset} Bots
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                disabled={!hasName || submitting !== null}
                onClick={() => void handleCreate()}
                className="w-full rounded-xl bg-white text-black font-semibold text-sm py-3.5 px-4 flex items-center justify-center gap-2 hover:bg-zinc-200 disabled:opacity-35 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{submitting === 'create' ? 'Starte Host…' : 'Neuen Room erstellen (Host)'}</span>
              </button>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-white/10" />
                <span className="mx-3 text-[11px] uppercase tracking-widest text-zinc-600">oder</span>
                <div className="flex-grow border-t border-white/10" />
              </div>

              <form onSubmit={(e) => void handleJoin(e)} className="space-y-2.5">
                <label
                  htmlFor="room-code"
                  className="block text-xs font-medium uppercase tracking-wider text-zinc-400"
                >
                  Einem Room beitreten
                </label>
                <div className="flex gap-2">
                  <input
                    id="room-code"
                    type="text"
                    maxLength={6}
                    value={roomCode}
                    onChange={(e) =>
                      setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    placeholder="ROOM-CODE"
                    className="flex-1 rounded-xl border border-white/15 bg-[#0A0A0B] px-4 py-3 text-sm font-mono-code tracking-[0.2em] uppercase text-white placeholder:text-zinc-600 placeholder:tracking-normal focus:outline-none focus:border-white transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={!hasName || roomCode.trim().length < 4 || submitting !== null}
                    className="rounded-xl border border-white/20 bg-white/[0.06] text-white font-medium text-sm px-5 flex items-center gap-1.5 hover:bg-white hover:text-black disabled:opacity-35 disabled:cursor-not-allowed transition-all cursor-pointer"
                  >
                    <span>{submitting === 'join' ? '…' : 'Join'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="space-y-4">
              <form onSubmit={(e) => void handleJoin(e)} className="space-y-3">
                <div className="rounded-xl border border-white/15 bg-[#0A0A0B] p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-zinc-500">
                      Einladung zu Room
                    </div>
                    <div className="font-mono-code text-xl font-bold tracking-[0.2em] text-white mt-0.5">
                      {roomCode || initialRoomCode}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={dismissInvite}
                    className="text-xs text-zinc-500 hover:text-white cursor-pointer"
                  >
                    Code ändern
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={!hasName || submitting !== null}
                  className="w-full rounded-xl bg-white text-black font-semibold text-sm py-3.5 px-4 flex items-center justify-center gap-2 hover:bg-zinc-200 disabled:opacity-35 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <span>{submitting === 'join' ? 'Verbinde mit Host…' : 'Room beitreten'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="relative flex items-center py-0.5">
                <div className="flex-grow border-t border-white/[0.08]" />
                <span className="mx-3 text-[11px] uppercase tracking-widest text-zinc-600">oder</span>
                <div className="flex-grow border-t border-white/[0.08]" />
              </div>

              <button
                type="button"
                disabled={!hasName || submitting !== null}
                onClick={() => void handleCreate()}
                className="w-full rounded-xl border border-white/20 bg-white/[0.06] text-white font-semibold text-sm py-3 px-4 flex items-center justify-center gap-2 hover:bg-white hover:text-black disabled:opacity-35 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Neuen Room erstellen ({botCount} Bots)</span>
              </button>
            </div>
          )}
        </div>
      </main>

      <footer className="max-w-xl w-full mx-auto flex items-center justify-between text-[11px] text-zinc-600">
        <span>
          Bis zu {MAX_HUMAN_PLAYERS} Spieler • Bis zu {MAX_BOT_COUNT} KI-Bots
        </span>
        <span className="font-mono-code">P2P WebRTC</span>
      </footer>
    </div>
  );
}

