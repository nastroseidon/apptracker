// Scene control, board rendering and menus.
import { ARCHETYPES, NAMES, COLORS, other } from './units.js';
import { N, WELLS, TIDE, newGame, terrain, lumAt, shieldFrac, isWell, unitAt, reachable, moveUnit, resolveDuel } from './board.js';
import { chooseMove } from './ai.js';
import { Duel, AW, AH } from './duel.js';
import { drawGlyph } from './art.js';
import { Input } from './input.js';
import { sfx, unlockAudio, setMuted, muted } from './audio.js';

const SAVE_KEY = 'lumenclash.save.v1';
const PREFS_KEY = 'lumenclash.prefs.v1';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const menu = document.getElementById('menu');
const input = new Input(canvas);

let W = 0, H = 0, safe = { top: 0, bottom: 0 };
let scene = 'title';         // title | board | duel
let state = null;
let selected = null;         // unit being moved
let inspect = null;          // unit shown in the info panel
let moves = [];
let anim = null;             // board move animation
let duel = null;
let aiTimer = 0;
let lastMove = null;
let banner = null;           // {text, t}
let prefs = load(PREFS_KEY) || { side: 'dawn', difficulty: 1, muted: false };
setMuted(prefs.muted);

function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function store(key, v) { try { v === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } }

function resize() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  W = canvas.clientWidth; H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const probe = getComputedStyle(document.documentElement);
  safe.top = parseFloat(probe.getPropertyValue('--sat')) || 0;
  safe.bottom = parseFloat(probe.getPropertyValue('--sab')) || 0;
}
addEventListener('resize', resize);
resize();

// ---------- Board layout ----------
function layout() {
  const top = safe.top + 58;
  const panel = 128;
  const size = Math.floor(Math.min(W - 20, H - top - panel - safe.bottom - 16, 640) / N) * N;
  return { x: Math.floor((W - size) / 2), y: top, size, cell: size / N, panelY: top + size + 10 };
}
const flip = () => state.playerSide === 'dusk';
function cellToScreen(r, c, L) {
  const vr = flip() ? N - 1 - r : r, vc = flip() ? N - 1 - c : c;
  return { x: L.x + (vc + 0.5) * L.cell, y: L.y + (vr + 0.5) * L.cell };
}
function screenToCell(x, y, L) {
  const vc = Math.floor((x - L.x) / L.cell), vr = Math.floor((y - L.y) / L.cell);
  if (vc < 0 || vr < 0 || vc >= N || vr >= N) return null;
  return flip() ? [N - 1 - vr, N - 1 - vc] : [vr, vc];
}

function lumColor(lum, tidal) {
  // -3 deep violet .. 0 slate .. +3 warm gold
  const k = (lum + 3) / 6;
  const a = [28, 22, 62], m = [52, 54, 72], b = [196, 150, 72];
  const mix = k < 0.5 ? a.map((v, i) => v + (m[i] - v) * k * 2) : m.map((v, i) => v + (b[i] - v) * (k - 0.5) * 2);
  return `rgb(${mix.map((v) => Math.round(v + (tidal ? 6 : 0))).join(',')})`;
}

// ---------- Turn flow ----------
function startGame(fresh) {
  state = fresh ? newGame(prefs.side, prefs.difficulty) : load(SAVE_KEY);
  if (!state) state = newGame(prefs.side, prefs.difficulty);
  selected = inspect = anim = duel = lastMove = null; moves = [];
  scene = 'board'; aiTimer = 0.8;
  input.mode = 'board';
  hideMenu();
  showBanner(state.turn === state.playerSide ? 'Your move' : `${cap(state.turn)} moves first`);
  save();
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
function showBanner(text) { banner = { text, t: 1.6 }; }
function save() { if (state && !state.winner) store(SAVE_KEY, state); }
const isPlayerTurn = () => state && state.turn === state.playerSide && !anim && !duel && !state.winner;

function commitMove(unit, r, c) {
  const target = unitAt(state, r, c);
  selected = null; moves = [];
  lastMove = { from: [unit.r, unit.c], to: [r, c] };
  sfx.move();
  anim = {
    unit, fr: unit.r, fc: unit.c, tr: r, tc: c, t: 0,
    T: ARCHETYPES[unit.type].mode === 'blink' ? 0.3 : 0.22 + 0.06 * Math.max(Math.abs(r - unit.r), Math.abs(c - unit.c)),
    then: () => {
      if (target) startDuel(unit, target);
      else { moveUnit(state, unit, r, c); afterTurn(); }
    },
  };
}

function startDuel(attacker, defender) {
  sfx.clash();
  const lum = lumAt(state, defender.r, defender.c);
  duel = new Duel({
    attacker, defender, lum, playerSide: state.playerSide, difficulty: state.difficulty,
    onEnd: ({ attackerHp, defenderHp }) => {
      resolveDuel(state, attacker, defender, attackerHp, defenderHp);
      duel = null; scene = 'board'; input.mode = 'board'; input.reset();
      afterTurn();
    },
  });
  scene = 'duel'; input.mode = 'duel'; input.reset();
}

function afterTurn() {
  inspect = null;
  if (state.winner) { store(SAVE_KEY, null); setTimeout(showGameOver, 700); return; }
  aiTimer = 0.7;
  if (state.turn === state.playerSide) showBanner('Your move');
  save();
}

function aiStep(dt) {
  if (state.winner || anim || duel || state.turn === state.playerSide) return;
  aiTimer -= dt;
  if (aiTimer > 0) return;
  const m = chooseMove(state, state.turn);
  if (m) commitMove(m.unit, m.r, m.c);
}

input.onTap = (x, y) => {
  unlockAudio();
  if (scene !== 'board' || !state) return;
  const L = layout();
  if (x > W - 56 && y < safe.top + 52) { showPause(); return; }
  const cell = screenToCell(x, y, L);
  if (!cell) { selected = null; moves = []; return; }
  const [r, c] = cell;
  const u = unitAt(state, r, c);
  if (!isPlayerTurn()) { inspect = u; return; }
  if (selected && moves.some(([mr, mc]) => mr === r && mc === c)) { commitMove(selected, r, c); return; }
  if (u && u.side === state.playerSide) {
    if (selected === u) { selected = null; moves = []; return; }
    selected = u; inspect = u; moves = reachable(state, u); sfx.select();
    return;
  }
  selected = null; moves = []; inspect = u;
};

// ---------- Drawing ----------
function drawBoard(now) {
  const L = layout();
  ctx.fillStyle = '#0d0c18'; ctx.fillRect(0, 0, W, H);

  // Header
  const pc = COLORS[state.playerSide], ec = COLORS[other(state.playerSide)];
  ctx.textAlign = 'left'; ctx.font = 'bold 17px system-ui, sans-serif';
  const mineTurn = state.turn === state.playerSide;
  ctx.fillStyle = mineTurn ? pc.ui : ec.ui;
  ctx.fillText(state.winner ? 'Game over' : mineTurn ? 'Your move' : `${cap(state.turn)} is thinking…`, 14, safe.top + 26);
  // Tide gauge: where the central diamond sits between Dawn and Dusk.
  const lum = TIDE[state.tide % TIDE.length], gx = 14, gy = safe.top + 38, gw = Math.min(170, W - 110);
  const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
  grad.addColorStop(0, COLORS.dusk.main); grad.addColorStop(0.5, '#556'); grad.addColorStop(1, COLORS.dawn.main);
  ctx.fillStyle = grad; ctx.fillRect(gx, gy, gw, 6);
  const next = TIDE[(state.tide + 1) % TIDE.length];
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(gx + ((lum + 3) / 6) * gw, gy + 3, 6, 0, Math.PI * 2); ctx.fill();
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#99a';
  ctx.fillText(`Tide ${next > lum ? '→ Dawn' : '→ Dusk'}`, gx + gw + 8, gy + 7);
  // Pause button
  ctx.fillStyle = '#aab';
  for (let i = 0; i < 3; i++) ctx.fillRect(W - 38, safe.top + 16 + i * 8, 22, 3);

  // Squares
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const { x, y } = cellToScreen(r, c, L), h = L.cell / 2, t = terrain(r, c) === 'tidal';
    ctx.fillStyle = lumColor(lumAt(state, r, c), t);
    ctx.fillRect(x - h + 1, y - h + 1, L.cell - 2, L.cell - 2);
    if (t) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
      ctx.strokeRect(x - h + 4, y - h + 4, L.cell - 8, L.cell - 8);
    }
  }
  // Wells
  for (const [r, c] of WELLS) {
    const { x, y } = cellToScreen(r, c, L), occ = unitAt(state, r, c);
    const col = occ ? COLORS[occ.side].main : '#9fe8ff';
    ctx.save(); ctx.translate(x, y); ctx.rotate(now * 0.6);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
    ctx.setLineDash([L.cell * 0.12, L.cell * 0.08]);
    ctx.beginPath(); ctx.arc(0, 0, L.cell * 0.42, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  // Last move trace
  if (lastMove && !anim) {
    for (const [r, c] of [lastMove.from, lastMove.to]) {
      const { x, y } = cellToScreen(r, c, L);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
      ctx.strokeRect(x - L.cell / 2 + 2, y - L.cell / 2 + 2, L.cell - 4, L.cell - 4);
    }
  }
  // Move targets
  for (const [r, c] of moves) {
    const { x, y } = cellToScreen(r, c, L), foe = unitAt(state, r, c);
    if (foe) {
      ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, L.cell * 0.44, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(x, y, L.cell * 0.12, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Units
  for (const u of state.units) {
    let { x, y } = cellToScreen(u.r, u.c, L), alpha = 1;
    if (anim?.unit === u) {
      const k = Math.min(1, anim.t / anim.T), e = k * k * (3 - 2 * k);
      const a = cellToScreen(anim.fr, anim.fc, L), b = cellToScreen(anim.tr, anim.tc, L);
      if (ARCHETYPES[u.type].mode === 'blink') { ({ x, y } = k < 0.5 ? a : b); alpha = Math.abs(1 - k * 2); }
      else { x = a.x + (b.x - a.x) * e; y = a.y + (b.y - a.y) * e - Math.sin(k * Math.PI) * (ARCHETYPES[u.type].mode === 'fly' ? L.cell * 0.3 : 0); }
    }
    if (u === selected) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, L.cell * (0.42 + 0.03 * Math.sin(now * 6)), 0, Math.PI * 2); ctx.stroke();
    }
    const facing = u.side === state.playerSide ? -Math.PI / 2 : Math.PI / 2;
    drawGlyph(ctx, u.type, u.side, x, y, L.cell * 0.3, { ang: facing, alpha, time: now });
    if (u.hp < u.maxHp) {
      const bw = L.cell * 0.7, bx = x - bw / 2, by = y + L.cell * 0.34;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, by, bw, 4);
      ctx.fillStyle = u.hp / u.maxHp > 0.5 ? '#7dff9a' : u.hp / u.maxHp > 0.25 ? '#ffd166' : '#ff6b6b';
      ctx.fillRect(bx, by, bw * (u.hp / u.maxHp), 4);
    }
  }

  drawPanel(L);
  if (banner) {
    ctx.globalAlpha = Math.min(1, banner.t * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, L.y + L.size / 2 - 30, W, 60);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(banner.text, W / 2, L.y + L.size / 2 + 8);
    ctx.globalAlpha = 1;
  }
}

function drawPanel(L) {
  const x = L.x, y = L.panelY, w = L.size;
  ctx.textAlign = 'left';
  const u = inspect && state.units.includes(inspect) ? inspect : null;
  if (!u) {
    ctx.fillStyle = '#8a8aa3'; ctx.font = '14px system-ui, sans-serif';
    const mine = state.units.filter((v) => v.side === state.playerSide).length;
    const theirs = state.units.length - mine;
    const held = WELLS.filter(([r, c]) => unitAt(state, r, c)?.side === state.playerSide).length;
    ctx.fillText('Tap a piece to see its moves. Landing on an enemy starts a duel.', x, y + 18, w);
    ctx.fillText('Win: hold all 5 wells (spinning rings), or destroy every enemy.', x, y + 40, w);
    ctx.fillStyle = '#cfd0e6';
    ctx.fillText(`Your army ${mine} · Enemy ${theirs} · Wells held ${held}/5`, x, y + 66, w);
    return;
  }
  const a = ARCHETYPES[u.type], col = COLORS[u.side];
  drawGlyph(ctx, u.type, u.side, x + 24, y + 30, 18, { ang: -Math.PI / 2 });
  ctx.fillStyle = col.ui; ctx.font = 'bold 17px system-ui, sans-serif';
  ctx.fillText(NAMES[u.side][u.type], x + 56, y + 24);
  ctx.fillStyle = '#cfd0e6'; ctx.font = '13px system-ui, sans-serif';
  const how = a.mode === 'ground' ? 'Walks' : a.mode === 'fly' ? 'Flies' : 'Teleports';
  ctx.fillText(`HP ${u.hp}/${u.maxHp} · ${how} ${a.move}`, x + 56, y + 44);
  ctx.fillStyle = '#9a9ab5';
  ctx.fillText(a.blurb, x + 56, y + 63, w - 56);
  const lum = lumAt(state, u.r, u.c), sh = Math.round(shieldFrac(u.side, lum) * 100);
  ctx.fillText(sh ? `Its square gives a +${sh}% shield in a duel.` : 'Its square gives no shield right now.', x + 56, y + 82, w - 56);
  if (isWell(u.r, u.c)) ctx.fillText('On a well: heals 4 per turn.', x + 56, y + 101, w - 56);
}

// ---------- Menus (HTML overlay) ----------
function hideMenu() { menu.hidden = true; menu.innerHTML = ''; }
function showMenu(html, bind) {
  menu.innerHTML = html; menu.hidden = false;
  menu.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => { unlockAudio(); bind[b.dataset.act]?.(b); }));
}
const seg = (name, opts, val) => `<div class="seg">${opts.map(([v, l]) =>
  `<button data-act="${name}" data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${l}</button>`).join('')}</div>`;

function showTitle() {
  scene = 'title'; input.mode = 'board';
  const saved = load(SAVE_KEY);
  showMenu(`
    <h1>Lumen<span>Clash</span></h1>
    <p class="tag">Strategy board. Real-time duels. The light decides.</p>
    ${saved ? '<button class="primary" data-act="cont">Continue</button>' : ''}
    <label>Play as</label>${seg('side', [['dawn', 'Dawn'], ['dusk', 'Dusk']], prefs.side)}
    <label>Difficulty</label>${seg('diff', [[0, 'Easy'], [1, 'Normal'], [2, 'Hard']], prefs.difficulty)}
    <button class="${saved ? '' : 'primary'}" data-act="new">New game</button>
    <button data-act="how">How to play</button>
    <button class="ghost" data-act="mute">Sound: ${prefs.muted ? 'off' : 'on'}</button>`, {
    cont: () => startGame(false),
    new: () => startGame(true),
    how: showHow,
    side: (b) => { prefs.side = b.dataset.v; store(PREFS_KEY, prefs); showTitle(); },
    diff: (b) => { prefs.difficulty = +b.dataset.v; store(PREFS_KEY, prefs); showTitle(); },
    mute: () => { prefs.muted = !prefs.muted; setMuted(prefs.muted); store(PREFS_KEY, prefs); showTitle(); },
  });
}

function showHow() {
  showMenu(`
    <h2>How to play</h2>
    <ul>
      <li><b>Take turns</b> moving one piece. Walkers are blocked by other pieces; flyers and the Regent go over them.</li>
      <li><b>Move onto an enemy</b> to fight it in the arena. Left thumb moves, right thumb drags to aim and fire. A quick tap on the right fires straight at the enemy.</li>
      <li><b>Light matters.</b> Gold squares shield Dawn, violet squares shield Dusk. The central diamond swings between the two every turn — watch the tide gauge.</li>
      <li><b>Damage sticks</b> after a duel. Pieces heal 1 per turn, 4 on a well.</li>
      <li><b>Win</b> by holding all five wells at once, or by destroying the whole enemy army.</li>
    </ul>
    <button class="primary" data-act="back">Got it</button>`, { back: () => (state && scene === 'board' ? showPause() : showTitle()) });
}

function showPause() {
  showMenu(`
    <h2>Paused</h2>
    <button class="primary" data-act="resume">Resume</button>
    <button data-act="how">How to play</button>
    <button data-act="mute">Sound: ${prefs.muted ? 'off' : 'on'}</button>
    <button class="ghost" data-act="quit">Save &amp; quit to title</button>`, {
    resume: hideMenu, how: showHow, quit: () => { save(); showTitle(); },
    mute: () => { prefs.muted = !prefs.muted; setMuted(prefs.muted); store(PREFS_KEY, prefs); showPause(); },
  });
}

function showGameOver() {
  const w = state.winner, won = w === state.playerSide;
  showMenu(`
    <h2>${w === 'draw' ? 'Both armies fall' : won ? 'Victory' : 'Defeat'}</h2>
    <p class="tag">${w === 'draw' ? 'Nothing is left standing.' : `${cap(w)} prevails after ${Math.ceil(state.turnCount / 2)} rounds.`}</p>
    <button class="primary" data-act="again">Play again</button>
    <button class="ghost" data-act="title">Title</button>`, { again: () => startGame(true), title: showTitle });
}

// ---------- Loop ----------
let prev = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - prev) / 1000); prev = t;
  const now = t / 1000;
  if (menu.hidden || scene === 'duel') {
    if (anim) { anim.t += dt; if (anim.t >= anim.T) { const done = anim.then; anim = null; done(); } }
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    if (scene === 'board' && state) aiStep(dt);
  }
  ctx.clearRect(0, 0, W, H);
  if (scene === 'duel' && duel) {
    const s = Math.min(W / AW, (H - safe.top - safe.bottom) / AH), ox = (W - AW * s) / 2, oy = safe.top + (H - safe.top - safe.bottom - AH * s) / 2;
    const toArena = (x, y) => ({ x: (x - ox) / s, y: (y - oy) / s });
    duel.update(dt, input, toArena);
    ctx.fillStyle = '#07060e'; ctx.fillRect(0, 0, W, H);
    if (duel) {
      ctx.save(); ctx.translate(ox, oy); ctx.scale(s, s);
      duel.draw(ctx, now);
      ctx.restore();
    }
    input.drawSticks(ctx);
  } else if (state && scene !== 'title') {
    drawBoard(now);
  } else {
    drawTitleBackdrop(now);
  }
  requestAnimationFrame(frame);
}

function drawTitleBackdrop(now) {
  ctx.fillStyle = '#0d0c18'; ctx.fillRect(0, 0, W, H);
  const cell = Math.max(W, H) / 12;
  for (let r = 0; r < 14; r++) for (let c = 0; c < 14; c++) {
    const lum = Math.round(3 * Math.sin(now * 0.4 + (r + c) * 0.45));
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = lumColor(lum, false);
    ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
  }
  ctx.globalAlpha = 1;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { save(); input.reset(); if (scene === 'board' && menu.hidden && state) showPause(); }
});

// Hooks for automated tests.
window.__lc = {
  get state() { return state; }, get scene() { return scene; }, get duel() { return duel; },
  startGame, commitMove, layout, cellToScreen,
};

showTitle();
requestAnimationFrame(frame);
