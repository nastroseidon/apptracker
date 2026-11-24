# Lumen Clash

A mobile strategy game for iOS and Android: a turn-based board where every capture is settled in a
short **real-time arena duel**, and the board's light shifts every turn to favour one side or the other.

Two factions, **Dawn** and **Dusk**, each field 16 pieces built from six archetypes:

| Archetype | Dawn | Dusk | Board move | In the arena |
|---|---|---|---|---|
| Scout | Ember Scout | Wisp | Walks 3 | Fast, rapid light shots |
| Bulwark | Bastion | Gravemaw | Walks 2 | Slow, heavy melee cleave with knockback |
| Bow | Sunbow | Hexbow | Walks 3 | Long-range piercing lance |
| Kite | Glimmerkite | Nightwing | Flies 4 | Three-way spread shot |
| Drake | Flarewyrm | Ashdrake | Flies 3 | Lobbed bombs that arc over pillars |
| Regent | Solarch | Umbrarch | Teleports 3 | Seeking orbs; the leader |

**Rules in brief**
- Move one piece per turn. Walkers are blocked by other pieces; flyers and the Regent are not.
- Ending a move on an enemy starts a duel. The loser is removed; the survivor keeps its damage.
- Gold squares shield Dawn and violet squares shield Dusk in a duel (up to +36% as a shield bar).
  The central diamond follows the **tide**, which swings from full Dawn to full Dusk and back.
- Pieces heal 1 HP a turn, or 4 on a **well**. Hold all five wells, or destroy the enemy army, to win.
- Duels that drag past 40 seconds start draining both fighters.

## Play it now (browser)

```bash
cd lumen-clash
npm start            # serves ./web, then open the printed URL (phone on the same Wi-Fi works too)
```

Controls: **left thumb** moves, **right thumb** drags to aim and fire; a quick tap on the right
fires straight at the enemy. On desktop: WASD to move, mouse to aim, click or Space to fire.

## Build the apps

The game is plain HTML5 canvas + ES modules with no runtime dependencies. [Capacitor](https://capacitorjs.com)
wraps it in a native shell for each store.

```bash
cd lumen-clash
npm install
npx cap add ios        # needs a Mac with Xcode + CocoaPods
npx cap add android    # needs Android Studio
npm run ios            # syncs web/ into the iOS project and opens Xcode
npm run android        # same for Android Studio
```

Before shipping, change `appId` in `capacitor.config.json` (it is `com.example.lumenclash`) to a
reverse-domain ID you own, then generate icons and splash screens (for example with `@capacitor/assets`).
In the app, hits use native haptics through `@capacitor/haptics`.

## Layout

```
web/index.html, style.css   shell and menus
web/src/units.js            roster, stats, faction names and colours
web/src/board.js            terrain, tide, movement, wells, healing, victory
web/src/ai.js               board AI (duel-odds estimate + positional scoring)
web/src/duel.js             real-time arena: physics, attacks, pillars, enemy fighter AI
web/src/art.js              procedural vector glyphs for every unit
web/src/input.js            twin-stick touch, mouse and keyboard
web/src/audio.js            synthesized sound effects and haptics
test/rules.test.mjs         rules tests + 40 full AI-vs-AI games
test/smoke.mjs              Playwright run on an iPhone-sized viewport
```

`npm test` runs the rules suite. `npm run smoke` drives the real game in headless Chromium.

## Roadmap ideas

- Art and audio pass: animated sprites, music, particles, screen shake
- Pass-and-play and online multiplayer (Game Center / Play Games, or a small relay server)
- One special ability per Regent (heal an ally, swap two pieces, freeze the tide for a turn)
- Board AI lookahead and per-difficulty personalities
- Landscape and tablet layouts; options for left-handed sticks
- Campaign of handcrafted boards with different well layouts and terrain
