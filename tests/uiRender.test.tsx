import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ClientRoomState } from '../shared/types.ts';
import { HomeScreen } from '../src/components/HomeScreen.tsx';
import { LobbyScreen } from '../src/components/LobbyScreen.tsx';
import { SlitherArena } from '../src/components/SlitherArena.tsx';
import { BrowserHostManager } from '../src/p2p/hostManager.ts';

const noopAsync = async () => ({ ok: true });
const stripSsr = (html: string) => html.replace(/<!-- -->/g, '');

describe('SLITHER UI components smoke render', () => {
  it('renders HomeScreen in normal and invite modes', () => {
    const htmlNormal = renderToString(
      <HomeScreen
        connected
        initialRoomCode=""
        errorMessage={null}
        onCreateRoom={async () => {}}
        onJoinRoom={async () => {}}
        onClearInvite={() => {}}
        onClearError={() => {}}
      />
    );
    expect(htmlNormal).toContain('SLITHER');
    expect(htmlNormal).toContain('Neuen Room erstellen (Host)');
    expect(htmlNormal).toContain('Einem Room beitreten');
    expect(htmlNormal).toContain('href="https://gundigame.vercel.app"');
    expect(htmlNormal).toContain('Zurück zum Dashboard');

    const htmlInvite = renderToString(
      <HomeScreen
        connected
        initialRoomCode="SLT999"
        errorMessage={null}
        onCreateRoom={async () => {}}
        onJoinRoom={async () => {}}
        onClearInvite={() => {}}
        onClearError={() => {}}
      />
    );
    expect(htmlInvite).toContain('SLT999');
    expect(htmlInvite).toContain('Room beitreten');
    expect(htmlInvite).toContain('Neuen Room erstellen');
    expect(htmlInvite).toContain('href="https://gundigame.vercel.app"');
    expect(htmlInvite).toContain('Zurück zum Dashboard');
  });

  it('renders LobbyScreen and SlitherArena HUD + Death Modal cleanly', () => {
    let latestState: ClientRoomState | null = null;
    const manager = new BrowserHostManager(
      'ARENA8',
      'Ilay',
      'emerald',
      20,
      (peerId, state) => {
        if (peerId === 'HOST_LOCAL') latestState = state;
      },
      () => {}
    );

    manager.joinGuest('peer-2', 'Noah', 'electric');
    manager.broadcast();
    expect(latestState).not.toBeNull();

    const lobbyHtml = stripSsr(
      renderToString(
        <LobbyScreen
          room={latestState!}
          connected
          onToggleReady={() => {}}
          onSetBotCount={() => {}}
          onSetPlayerColor={() => {}}
          onStartNow={() => {}}
          onRemovePlayer={() => {}}
          onLeave={() => {}}
        />
      )
    );
    expect(lobbyHtml).toContain('ARENA8');
    expect(lobbyHtml).toContain('Ilay');
    expect(lobbyHtml).toContain('Noah');
    expect(lobbyHtml).toContain('20 / 30 Bots');

    manager.startNewMatch();
    expect(latestState!.phase).toBe('playing');

    const arenaHtml = stripSsr(
      renderToString(
        <SlitherArena
          room={latestState!}
          connected
          soundEnabled
          onToggleSound={() => {}}
          onSendInput={() => {}}
          onRespawn={noopAsync}
          onSetBotCount={() => {}}
          onSetPlayerColor={() => {}}
          onReturnToLobby={() => {}}
          onLeave={() => {}}
          onPlayOrbSound={() => {}}
          onPlayBoostSound={() => {}}
          onPlayKillSound={() => {}}
          onPlayDeathSound={() => {}}
          onPlayStartSound={() => {}}
        />
      )
    );
    expect(arenaHtml).toContain('Leaderboard');
    expect(arenaHtml).toContain('Arena Radar Minimap');
    expect(arenaHtml).toContain('ARENA8');

    // Render Death Modal state cleanly
    const deadSnakeState: ClientRoomState = {
      ...latestState!,
      world: {
        ...latestState!.world!,
        snakes: latestState!.world!.snakes.map((s) =>
          s.id === latestState!.myPlayerId
            ? { ...s, alive: false, lastRunScore: 145, lastRunKills: 2, eliminatedBy: 'Vega' }
            : s
        ),
      },
    };
    const deathHtml = stripSsr(
      renderToString(
        <SlitherArena
          room={deadSnakeState}
          connected
          soundEnabled
          onToggleSound={() => {}}
          onSendInput={() => {}}
          onRespawn={noopAsync}
          onSetBotCount={() => {}}
          onSetPlayerColor={() => {}}
          onReturnToLobby={() => {}}
          onLeave={() => {}}
          onPlayOrbSound={() => {}}
          onPlayBoostSound={() => {}}
          onPlayKillSound={() => {}}
          onPlayDeathSound={() => {}}
          onPlayStartSound={() => {}}
        />
      )
    );
    expect(deathHtml).toContain('Ausgeschaltet');
    expect(deathHtml).toContain('Besiegt von Vega');
    expect(deathHtml).toContain('Sofort respawnen');

    manager.destroy();
  });
});

