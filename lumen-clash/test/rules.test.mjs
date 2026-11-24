// Plays full AI-vs-AI games with duels auto-resolved by the odds model,
// checking the rules always reach a result and never corrupt the board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, unitAt, resolveDuel, moveUnit, reachable, N } from '../web/src/board.js';
import { chooseMove, winOdds } from '../web/src/ai.js';
import { lumAt } from '../web/src/board.js';

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

test('starting position is legal and symmetric', () => {
  const s = newGame();
  assert.equal(s.units.filter((u) => u.side === 'dawn').length, 16);
  assert.equal(s.units.filter((u) => u.side === 'dusk').length, 16);
  const cells = new Set(s.units.map((u) => `${u.r},${u.c}`));
  assert.equal(cells.size, s.units.length);
});

test('walkers cannot pass through pieces; flyers can', () => {
  const s = newGame();
  const bow = unitAt(s, 8, 3); // boxed in by its own side at the start
  assert.deepEqual(reachable(s, bow), []);
  const kite = unitAt(s, 8, 1);
  assert.ok(reachable(s, kite).some(([r]) => r === 4));
});

test('AI vs AI games always finish', () => {
  const stats = [];
  for (let g = 0; g < 40; g++) {
    const rand = rng(g + 1);
    const s = newGame('dawn', g % 3);
    let turns = 0;
    while (!s.winner && turns < 600) {
      const m = chooseMove(s, s.turn, rand);
      assert.ok(m, 'side to move has a move');
      const target = unitAt(s, m.r, m.c);
      if (target) {
        assert.notEqual(target.side, m.unit.side);
        const p = winOdds(m.unit, target, lumAt(s, m.r, m.c));
        const aWins = rand() < p;
        resolveDuel(s, m.unit, target, aWins ? m.unit.hp * (0.3 + rand() * 0.6) : 0, aWins ? 0 : target.hp * (0.3 + rand() * 0.6));
      } else moveUnit(s, m.unit, m.r, m.c);
      turns++;
      const cells = new Set(s.units.map((u) => `${u.r},${u.c}`));
      assert.equal(cells.size, s.units.length, 'no two pieces share a square');
      for (const u of s.units) assert.ok(u.r >= 0 && u.r < N && u.c >= 0 && u.c < N && u.hp > 0);
    }
    assert.ok(s.winner, `game ${g} finished (turns ${turns})`);
    stats.push([s.winner, turns]);
  }
  const w = (x) => stats.filter(([v]) => v === x).length;
  console.log(`dawn ${w('dawn')} dusk ${w('dusk')} draw ${w('draw')} avg turns ${Math.round(stats.reduce((a, [, t]) => a + t, 0) / stats.length)} max ${Math.max(...stats.map(([, t]) => t))}`);
});
