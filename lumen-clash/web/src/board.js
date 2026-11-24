// Board rules: terrain, the light tide, movement, wells and victory.
import { ARCHETYPES, makeArmy, other } from './units.js';

export const N = 9;
export const WELLS = [[4, 4], [2, 2], [2, 6], [6, 2], [6, 6]];
// The tide swings the central diamond from full Dawn light to full Dusk shadow and back.
export const TIDE = [0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1];
const SHIELD_PER_LUM = 0.12;
const REGEN = 1;
const WELL_REGEN = 4;

export const isWell = (r, c) => WELLS.some(([wr, wc]) => wr === r && wc === c);

export function terrain(r, c) {
  if (Math.abs(r - 4) + Math.abs(c - 4) <= 3) return 'tidal';
  return (r + c) % 2 === 0 ? 'light' : 'dark';
}

export function newGame(playerSide = 'dawn', difficulty = 1) {
  return {
    units: [...makeArmy('dawn'), ...makeArmy('dusk')],
    turn: 'dawn',
    tide: 0,
    turnCount: 0,
    playerSide,
    difficulty,
    winner: null,
    log: [],
  };
}

// Luminance: positive favours Dawn, negative favours Dusk.
export function lumAt(state, r, c) {
  const t = terrain(r, c);
  if (t === 'light') return 2;
  if (t === 'dark') return -2;
  return TIDE[state.tide % TIDE.length];
}

export function shieldFrac(side, lum) {
  const aligned = side === 'dawn' ? lum : -lum;
  return Math.max(0, aligned) * SHIELD_PER_LUM;
}

export const unitAt = (state, r, c) => state.units.find((u) => u.r === r && u.c === c) || null;
const inside = (r, c) => r >= 0 && c >= 0 && r < N && c < N;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Every square this unit could end its move on. Ending on an enemy starts a duel.
export function reachable(state, unit) {
  const a = ARCHETYPES[unit.type];
  const out = [];
  if (a.mode === 'ground') {
    // Walks step by step (8 directions) and cannot pass through anyone.
    const seen = new Set([`${unit.r},${unit.c}`]);
    let frontier = [[unit.r, unit.c]];
    for (let step = 0; step < a.move; step++) {
      const next = [];
      for (const [r, c] of frontier) {
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc, key = `${nr},${nc}`;
          if (!inside(nr, nc) || seen.has(key)) continue;
          seen.add(key);
          const occ = unitAt(state, nr, nc);
          if (!occ) { out.push([nr, nc]); next.push([nr, nc]); }
          else if (occ.side !== unit.side) out.push([nr, nc]);
        }
      }
      frontier = next;
    }
  } else {
    // Flyers and the blinking Regent ignore anything in between.
    for (let r = unit.r - a.move; r <= unit.r + a.move; r++) {
      for (let c = unit.c - a.move; c <= unit.c + a.move; c++) {
        if (!inside(r, c) || (r === unit.r && c === unit.c)) continue;
        const occ = unitAt(state, r, c);
        if (!occ || occ.side !== unit.side) out.push([r, c]);
      }
    }
  }
  return out;
}

export function canReach(state, unit, r, c) {
  return reachable(state, unit).some(([rr, cc]) => rr === r && cc === c);
}

// Moves a unit to an empty square. Duels are resolved by the caller via resolveDuel.
export function moveUnit(state, unit, r, c) {
  unit.r = r; unit.c = c;
  endTurn(state);
}

// Applies a duel outcome. hp <= 0 means that fighter died.
export function resolveDuel(state, attacker, defender, attackerHp, defenderHp) {
  const r = defender.r, c = defender.c;
  attacker.hp = Math.min(attacker.maxHp, Math.max(0, Math.ceil(attackerHp)));
  defender.hp = Math.min(defender.maxHp, Math.max(0, Math.ceil(defenderHp)));
  state.units = state.units.filter((u) => u.hp > 0);
  if (attacker.hp > 0 && defender.hp <= 0) { attacker.r = r; attacker.c = c; }
  endTurn(state);
}

function endTurn(state) {
  state.turnCount++;
  state.tide = (state.tide + 1) % TIDE.length;
  state.winner = checkWinner(state);
  if (state.winner) return;
  state.turn = other(state.turn);
  // Units of the side about to move recover a little; more on a well.
  for (const u of state.units) {
    if (u.side !== state.turn) continue;
    u.hp = Math.min(u.maxHp, u.hp + (isWell(u.r, u.c) ? WELL_REGEN : REGEN));
  }
  // A side with no legal move forfeits its turn rather than locking the game.
  if (!state.units.some((u) => u.side === state.turn && reachable(state, u).length)) {
    state.turn = other(state.turn);
  }
}

export function checkWinner(state) {
  if (!state.units.length) return 'draw';
  for (const side of ['dawn', 'dusk']) {
    const foe = other(side);
    if (!state.units.some((u) => u.side === foe)) return side;
    if (WELLS.every(([r, c]) => unitAt(state, r, c)?.side === side)) return side;
  }
  return null;
}
