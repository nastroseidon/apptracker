// Board AI: scores every legal move with a quick duel-odds estimate plus positional terms.
import { ARCHETYPES, other } from './units.js';
import { reachable, unitAt, lumAt, shieldFrac, isWell, WELLS } from './board.js';

const DPS = { scout: 3.0, bulwark: 4.2, bow: 3.2, kite: 3.6, drake: 3.2, regent: 3.0 };

function strength(unit, lum) {
  const hp = unit.hp * (1 + shieldFrac(unit.side, lum));
  return hp * DPS[unit.type];
}

export function winOdds(attacker, defender, lum) {
  const a = strength(attacker, lum) ** 1.4;
  const d = strength(defender, lum) ** 1.4;
  return a / (a + d);
}

const value = (u) => ARCHETYPES[u.type].value * (0.4 + 0.6 * (u.hp / u.maxHp));

export function chooseMove(state, side, rng = Math.random) {
  const mine = state.units.filter((u) => u.side === side);
  const foes = state.units.filter((u) => u.side === other(side));
  const foeReach = new Map();
  for (const f of foes) {
    for (const [r, c] of reachable(state, f)) {
      const k = `${r},${c}`;
      if (!foeReach.has(k)) foeReach.set(k, []);
      foeReach.get(k).push(f);
    }
  }
  const wellsHeld = WELLS.filter(([r, c]) => unitAt(state, r, c)?.side === side).length;
  const noise = [0.2, 1.2, 2.5][2 - Math.min(2, state.difficulty ?? 1)];
  let best = null;

  for (const u of mine) {
    const fromWell = isWell(u.r, u.c);
    for (const [r, c] of reachable(state, u)) {
      const lum = lumAt(state, r, c);
      const target = unitAt(state, r, c);
      let score = 0;
      if (target) {
        const p = winOdds(u, target, lum);
        score += p * (value(target) * 1.6 + (isWell(r, c) ? 6 : 0)) - (1 - p) * value(u) * 1.1;
        if (target.type === 'regent') score += p * 6;
      } else {
        // Prefer squares lit in our favour and moving toward the action.
        score += (shieldFrac(side, lum) - shieldFrac(other(side), lum)) * 4;
        const nearestWell = Math.min(...WELLS.map(([wr, wc]) => Math.max(Math.abs(wr - r), Math.abs(wc - c))));
        const curWell = Math.min(...WELLS.map(([wr, wc]) => Math.max(Math.abs(wr - u.r), Math.abs(wc - u.c))));
        score += (curWell - nearestWell) * 0.6;
      }
      if (isWell(r, c)) score += 5 + wellsHeld * 2.5;
      if (fromWell) score -= 4;
      if (u.type === 'regent') score -= 1.5; // keep the leader home unless it is worth it
      // Danger at the destination from enemies that could strike next turn.
      const threats = foeReach.get(`${r},${c}`) || [];
      let worst = 0;
      for (const f of threats) {
        if (f === target) continue;
        const defending = { ...u, hp: target ? u.hp * 0.6 : u.hp };
        worst = Math.max(worst, winOdds(f, defending, lum) * value(u));
      }
      score -= worst * 0.7;
      score += (rng() - 0.5) * noise;
      if (!best || score > best.score) best = { unit: u, r, c, score };
    }
  }
  return best;
}
