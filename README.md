# SLITHER Online Multiplayer (Arena + Browser-Host WebRTC)

Minimalistische Online-Slither.io-Arena komplett in React & HTML5 Canvas (schwarzer Hintergrund, weißer Text, neon-dezente Schlangen-Akzente) — **ohne externen Spielserver**.

Der Spieler, der einen Room erstellt (**Host**), ist direkt im Browser der autoritative Echtzeit-Spielserver. Bis zu **8 menschliche Spieler** verbinden sich per **WebRTC DataChannel (PeerJS)** über den Room-Code oder Invite-Link — ergänzt durch bis zu **30 automatische KI-Bots**.

## Features

- **Echtzeit-Multiplayer (bis zu 8 Spieler)**: Host-autoritative Physik- und Kollisions-Engine mit flüssiger Client-Interpolation.
- **Automatische KI-Bots (0–30 Bots)**: Intelligente Bots weichen Wänden und gegnerischen Körpern aus, jagen leuchtende Orbs und respawnen automatisch.
- **Klassische Slither-Mechaniken**: Sanfte Kurvensteuerung (Maus, Tastatur & Touch), Boost auf Kosten eigener Masse inkl. leuchtender Boost-Spur, Orb-Magnetfeld, Todesspur-Loot, Top-10-Leaderboard, Kill-Feed und Radar-Minimap.
- **Live-Konfiguration & Mid-Game-Join**: Bot-Anzahl und Schlangenfarbe wählbar; Freunde können auch laufenden Arenen direkt über den Room-Code beitreten.

## Lokal starten

```bash
npm install
npm run dev
```

Öffne `http://localhost:5173`.

## Tests & Typecheck

```bash
npm test
npm run typecheck
npm run build
```

