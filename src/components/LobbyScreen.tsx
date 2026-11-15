import { useState, type CSSProperties } from 'react';
import { Bot, Check, Copy, Link2, LogOut, Play, UserMinus, Users, Wifi } from 'lucide-react';
import { clampBotCount } from '../../shared/gameEngine.ts';
import {
  MAX_BOT_COUNT,
  MAX_HUMAN_PLAYERS,
  MIN_BOT_COUNT,
  SNAKE_COLORS,
  SNAKE_COLOR_LIST,
  type ClientRoomState,
  type SnakeColorId,
} from '../../shared/types.ts';

interface LobbyScreenProps {
  room: ClientRoomState;
  connected: boolean;
  onToggleReady: () => void;
  onSetBotCount: (botCount: number) => void;
  onSetPlayerColor: (colorId: SnakeColorId) => void;
  onStartNow: () => void;
  onRemovePlayer: (targetPlayerId: string) => void;
  onLeave: () => void;
}

const BOT_PRESETS = [0, 10, 20, 30];

export function LobbyScreen({
  room,
  connected,
  onToggleReady,
  onSetBotCount,
  onSetPlayerColor,
  onStartNow,
  onRemovePlayer,
  onLeave,
}: LobbyScreenProps) {
  const [copiedType, setCopiedType] = useState<'code' | 'link' | null>(null);

  const me = room.players.find((p) => p.id === room.myPlayerId);
  const isHost = room.hostId === room.myPlayerId;
  const totalCount = room.players.length;
  const readyCount = room.players.filter((p) => p.isReady).length;

  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?room=${room.roomCode}`
      : room.roomCode;

  const copyText = async (text: string, type: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const botPct = ((room.config.botCount - MIN_BOT_COUNT) / (MAX_BOT_COUNT - MIN_BOT_COUNT)) * 100;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col px-4 py-6 sm:px-6">
      {/* Header */}
      <header className="max-w-2xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-lg font-bold tracking-[-0.03em]">SLITHER</span>
          <span className="text-zinc-700">/</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
            <Wifi className={`w-3.5 h-3.5 ${connected ? 'text-white' : 'text-zinc-600'}`} />
            {connected ? 'Verbunden' : 'Verbinde…'}
          </span>
        </div>

        <button
          type="button"
          onClick={onLeave}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white rounded-lg px-2.5 py-1.5 hover:bg-white/[0.05] transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Verlassen</span>
        </button>
      </header>

      {/* Main Lobby Card */}
      <main className="max-w-2xl w-full mx-auto my-auto py-8 space-y-5">
        {/* Room Code & Share Panel */}
        <section className="rounded-2xl border border-white/[0.08] bg-[#08080A] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-1">
              Room-Code
            </div>
            <div className="font-mono-code text-3xl sm:text-4xl font-bold tracking-[0.22em] text-white">
              {room.roomCode}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyText(room.roomCode, 'code')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-white hover:bg-white/[0.1] transition-colors cursor-pointer"
            >
              {copiedType === 'code' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedType === 'code' ? 'Code kopiert' : 'Code kopieren'}</span>
            </button>

            <button
              type="button"
              onClick={() => void copyText(inviteUrl, 'link')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white text-black px-3.5 py-2 text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              {copiedType === 'link' ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
              <span>{copiedType === 'link' ? 'Link kopiert' : 'Invite-Link kopieren'}</span>
            </button>
          </div>
        </section>

        {/* Arena & Bot Configuration Panel */}
        <section className="rounded-2xl border border-white/[0.08] bg-[#08080A] p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <Bot className="w-3.5 h-3.5 text-zinc-300" />
                <span>Arena &amp; Automatische Bots</span>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Bis zu {MAX_HUMAN_PLAYERS} menschliche Spieler +{' '}
                <span className="font-mono-code font-semibold text-white">
                  {room.config.botCount}
                </span>{' '}
                automatische KI-Bots (max. {MAX_BOT_COUNT}).
              </p>
            </div>

            <div className="font-mono-code text-xs font-semibold text-white bg-white/[0.06] border border-white/10 rounded-lg px-2.5 py-1 self-start sm:self-center">
              {room.config.botCount} / {MAX_BOT_COUNT} Bots
            </div>
          </div>

          {isHost && (
            <div className="space-y-2.5 pt-2 border-t border-white/[0.05]">
              <input
                type="range"
                min={MIN_BOT_COUNT}
                max={MAX_BOT_COUNT}
                step={1}
                value={room.config.botCount}
                onChange={(e) =>
                  onSetBotCount(clampBotCount(Number.parseInt(e.target.value, 10)))
                }
                aria-label="Anzahl KI-Bots"
                style={{ '--slider-pct': `${botPct}%` } as CSSProperties}
                className="slither-slider"
              />

              <div className="flex flex-wrap gap-1.5">
                {BOT_PRESETS.map((preset) => {
                  const active = room.config.botCount === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => onSetBotCount(preset)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-mono-code transition-all cursor-pointer ${
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
          )}

          {/* Player color quick switcher */}
          <div className="pt-3 border-t border-white/[0.05] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Deine Farbe
            </span>
            <div className="flex flex-wrap gap-2">
              {SNAKE_COLOR_LIST.map((c) => {
                const active = me?.colorId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSetPlayerColor(c.id)}
                    aria-label={c.labelDe}
                    title={c.labelDe}
                    className={`w-6 h-6 rounded-full transition-all cursor-pointer ${
                      active
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-[#08080A] scale-110'
                        : 'opacity-65 hover:opacity-100 hover:scale-105'
                    }`}
                    style={{
                      backgroundColor: c.primary,
                      boxShadow: active ? `0 0 10px ${c.glow}` : undefined,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </section>

        {/* Players List (1-8 humans) */}
        <section className="rounded-2xl border border-white/[0.08] bg-[#08080A] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Users className="w-4 h-4 text-zinc-400" />
              <span>
                Spieler ({totalCount}/{MAX_HUMAN_PLAYERS})
              </span>
            </div>

            <span className="text-xs text-zinc-500 font-mono-code">
              + {room.config.botCount} Bots
            </span>
          </div>

          <ul className="divide-y divide-white/[0.06]">
            {room.players.map((player) => {
              const isMe = player.id === room.myPlayerId;
              const colorMeta = SNAKE_COLORS[player.colorId] ?? SNAKE_COLORS.white;
              return (
                <li
                  key={player.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold shrink-0"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.04)',
                        borderColor: colorMeta.primary,
                        boxShadow: `0 0 12px ${colorMeta.glow}`,
                        color: colorMeta.primary,
                      }}
                    >
                      {player.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white truncate">
                          {player.name}
                        </span>
                        {isMe && (
                          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                            (Du)
                          </span>
                        )}
                        {player.isHost && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider border border-white/25 text-white px-1.5 py-0.5 rounded">
                            Host
                          </span>
                        )}
                        {!player.connected && (
                          <span className="text-[10px] uppercase tracking-wider text-zinc-500 border border-white/10 px-1.5 py-0.5 rounded">
                            Getrennt
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: colorMeta.primary }}
                        />
                        <span>{colorMeta.labelDe}</span>
                        {player.bestScore > 50 && (
                          <span className="font-mono-code text-zinc-400">
                            · Bestwert {player.bestScore} · {player.kills} Kills
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        player.isReady
                          ? 'bg-white text-black'
                          : 'border border-white/15 text-zinc-400'
                      }`}
                    >
                      {player.isReady && <Check className="w-3 h-3" />}
                      <span>{player.isReady ? 'Bereit' : 'Wartet'}</span>
                    </span>

                    {isHost && !isMe && (
                      <button
                        type="button"
                        onClick={() => onRemovePlayer(player.id)}
                        title="Aus dem Room entfernen"
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Ready Bar & Status */}
        <section className="space-y-3">
          {room.countdownSeconds !== null ? (
            <div className="rounded-2xl border border-white/40 bg-white text-black px-5 py-4 flex items-center justify-between animate-pop-in">
              <div>
                <div className="text-sm font-bold">Alle Spieler sind bereit!</div>
                <div className="text-xs text-zinc-700">
                  Arena startet in {room.countdownSeconds}…
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleReady}
                className="text-xs font-semibold border border-black/25 rounded-lg px-3 py-1.5 hover:bg-black/10 transition-colors cursor-pointer"
              >
                Abbrechen
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={onToggleReady}
                className={`flex-1 rounded-2xl py-4 px-5 text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  me?.isReady
                    ? 'border border-white/30 bg-white/[0.08] text-white hover:bg-white/[0.14]'
                    : 'bg-white text-black hover:bg-zinc-200'
                }`}
              >
                {me?.isReady ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Du bist bereit ({readyCount}/{totalCount})</span>
                  </>
                ) : (
                  <span>Bereit machen</span>
                )}
              </button>

              {isHost && (
                <button
                  type="button"
                  onClick={onStartNow}
                  className="rounded-2xl border border-white/20 bg-[#111114] hover:bg-white hover:text-black text-white py-4 px-5 text-sm font-semibold transition-all cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4" />
                  <span>Sofort starten</span>
                </button>
              )}
            </div>
          )}

          <p className="text-center text-xs text-zinc-500">
            {totalCount === 1
              ? `Alleine mit ${room.config.botCount} Bots oder lade bis zu ${MAX_HUMAN_PLAYERS} Freunde ein (Beitritt auch während der Runde möglich).`
              : `${readyCount} von ${totalCount} Spielern bereit — startet automatisch, sobald alle bereit sind.`}
          </p>
        </section>
      </main>
    </div>
  );
}

