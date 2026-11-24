// The real-time arena. A capture on the board becomes a short twin-stick fight.
import { ARCHETYPES, COLORS, NAMES } from './units.js';
import { shieldFrac } from './board.js';
import { drawGlyph } from './art.js';
import { sfx, buzz } from './audio.js';

export const AW = 400, AH = 640;
const COLLAPSE_AT = 40;      // seconds before the arena starts draining both fighters
const COLLAPSE_DPS = 1.5;
const AI_SKILL = [
  { lead: 0.3, err: 0.55, dodge: 0.25, speed: 0.82, react: 0.45 },
  { lead: 0.7, err: 0.28, dodge: 0.6, speed: 0.94, react: 0.25 },
  { lead: 1.0, err: 0.1, dodge: 0.95, speed: 1.0, react: 0.1 },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Duel {
  constructor({ attacker, defender, lum, playerSide, difficulty = 1, onEnd }) {
    this.attacker = attacker; this.defender = defender;
    this.lum = lum; this.onEnd = onEnd;
    this.skill = AI_SKILL[clamp(difficulty, 0, 2)];
    this.time = 0; this.intro = 1.4; this.over = false; this.endTimer = 0; this.ended = false;
    const mine = attacker.side === playerSide ? attacker : defender;
    const theirs = mine === attacker ? defender : attacker;
    this.player = this.makeFighter(mine, AW / 2, AH - 90, true);
    this.enemy = this.makeFighter(theirs, AW / 2, 90, false);
    this.fighters = [this.player, this.enemy];
    this.shots = []; this.fx = [];
    this.pillars = [
      { x: 200, y: 320, r: 34, off: 0 },
      { x: 92, y: 205, r: 24, off: 2.1 }, { x: 308, y: 205, r: 24, off: 4.2 },
      { x: 92, y: 435, r: 24, off: 4.2 }, { x: 308, y: 435, r: 24, off: 2.1 },
    ];
  }

  makeFighter(unit, x, y, isPlayer) {
    const arch = ARCHETYPES[unit.type];
    const shield = Math.round(unit.maxHp * shieldFrac(unit.side, this.lum) * 10) / 10;
    return {
      unit, side: unit.side, arch, x, y, vx: 0, vy: 0, r: arch.radius,
      hp: unit.hp, shield, maxShield: shield, cd: 0.4, flash: 0, isPlayer,
      face: isPlayer ? -Math.PI / 2 : Math.PI / 2,
      ai: { strafe: Math.random() < 0.5 ? -1 : 1, flipT: 1, react: 0.5 },
    };
  }

  foe(f) { return f === this.player ? this.enemy : this.player; }
  solid(p) { return Math.sin(this.time * 0.9 + p.off) > -0.35; }

  update(dt, input, toArena) {
    this.time += dt;
    for (const f of this.fighters) { f.flash = Math.max(0, f.flash - dt); }
    this.updateFx(dt);
    if (this.intro > 0) { this.intro -= dt; input.poll(toArena, this.player); return; }
    if (this.over) {
      this.endTimer -= dt;
      this.updateShots(dt * 0.3);
      if (this.endTimer <= 0 && !this.ended) {
        this.ended = true;
        const aF = this.attacker === this.player.unit ? this.player : this.enemy;
        const dF = aF === this.player ? this.enemy : this.player;
        this.onEnd({ attackerHp: aF.hp, defenderHp: dF.hp });
      }
      return;
    }

    // Player
    const p = this.player, inp = input.poll(toArena, p);
    const spd = p.arch.speed;
    p.vx += (inp.move.x * spd - p.vx) * Math.min(1, dt * 14);
    p.vy += (inp.move.y * spd - p.vy) * Math.min(1, dt * 14);
    if (inp.firing) {
      p.face = Math.atan2(inp.aim.y, inp.aim.x);
      const reach = inp.aim.dist ?? (inp.aim.mag ? p.arch.attack.range * inp.aim.mag : undefined);
      this.fire(p, inp.aim, reach);
    } else if (inp.auto) {
      const aim = this.leadAim(p, this.enemy, 1);
      this.fire(p, aim, aim.dist);
    } else if (Math.hypot(inp.move.x, inp.move.y) > 0.3) {
      p.face = Math.atan2(inp.move.y, inp.move.x);
    }

    this.think(this.enemy, dt);

    for (const f of this.fighters) {
      f.cd -= dt;
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.x = clamp(f.x, f.r + 6, AW - f.r - 6);
      f.y = clamp(f.y, f.r + 46, AH - f.r - 46);
      for (const pl of this.pillars) {
        if (!this.solid(pl)) continue;
        const dx = f.x - pl.x, dy = f.y - pl.y, d = Math.hypot(dx, dy) || 1, min = pl.r + f.r;
        if (d < min) { f.x = pl.x + (dx / d) * min; f.y = pl.y + (dy / d) * min; }
      }
    }
    // Fighters can't overlap.
    const e = this.enemy, dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1, min = p.r + e.r;
    if (d < min) {
      const push = (min - d) / 2;
      p.x -= (dx / d) * push; p.y -= (dy / d) * push;
      e.x += (dx / d) * push; e.y += (dy / d) * push;
    }

    this.updateShots(dt);
    if (this.time > COLLAPSE_AT) for (const f of this.fighters) this.damage(f, COLLAPSE_DPS * dt, true);
    if (p.hp <= 0 || e.hp <= 0) {
      this.over = true; this.endTimer = 1.4;
      (p.hp > 0 ? sfx.win : sfx.lose)();
    }
  }

  leadAim(f, target, lead) {
    const a = f.arch.attack;
    let tx = target.x, ty = target.y;
    if (a.speed) {
      const t = Math.hypot(tx - f.x, ty - f.y) / a.speed;
      tx += target.vx * t * lead; ty += target.vy * t * lead;
    }
    const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d, dist: d };
  }

  fire(f, dir, dist) {
    if (f.cd > 0) return;
    const a = f.arch.attack;
    f.cd = a.cd;
    f.face = Math.atan2(dir.y, dir.x);
    const sx = f.x + dir.x * f.r, sy = f.y + dir.y * f.r;
    const shot = (ang, extra = {}) => this.shots.push({
      kind: a.kind, owner: f, x: sx, y: sy, vx: Math.cos(ang) * a.speed, vy: Math.sin(ang) * a.speed,
      dmg: a.dmg, life: a.range / a.speed, r: a.kind === 'pierce' ? 5 : a.kind === 'homing' ? 7 : 4.5, hit: new Set(), ...extra,
    });
    switch (a.kind) {
      case 'bolt': case 'pierce': case 'homing':
        shot(f.face); sfx.shoot(f.side); break;
      case 'spread':
        for (let i = 0; i < a.count; i++) shot(f.face + (i - (a.count - 1) / 2) * a.spread);
        sfx.shoot(f.side); break;
      case 'lob': {
        const d = clamp(dist ?? a.range, 70, a.range);
        this.shots.push({ kind: 'lob', owner: f, sx, sy, tx: f.x + dir.x * d, ty: f.y + dir.y * d, t: 0, T: d / a.speed, dmg: a.dmg, blast: a.blast });
        sfx.shoot(f.side); break;
      }
      case 'melee': {
        const t = this.foe(f), ddx = t.x - f.x, ddy = t.y - f.y;
        this.fx.push({ kind: 'swing', x: f.x, y: f.y, ang: f.face, reach: a.reach + f.r, arc: a.arc, side: f.side, t: 0.18, T: 0.18 });
        sfx.swing();
        if (Math.hypot(ddx, ddy) <= a.reach + f.r + t.r * 0.5 && Math.abs(angDiff(Math.atan2(ddy, ddx), f.face)) <= a.arc / 2) {
          this.damage(t, a.dmg);
          const d = Math.hypot(ddx, ddy) || 1;
          t.vx += (ddx / d) * 420; t.vy += (ddy / d) * 420;
        }
        break;
      }
    }
  }

  damage(f, amount, silent = false) {
    if (this.over && !silent) return;
    const absorbed = Math.min(f.shield, amount);
    f.shield -= absorbed;
    f.hp -= amount - absorbed;
    if (silent) return;
    f.flash = 0.12;
    sfx.hit();
    if (f.isPlayer) buzz(25);
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 140;
      this.fx.push({ kind: 'spark', x: f.x, y: f.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, side: this.foe(f).side, t: 0.35, T: 0.35 });
    }
    this.fx.push({ kind: 'num', x: f.x, y: f.y - f.r - 6, text: (Math.round(amount * 10) / 10).toString(), t: 0.7, T: 0.7, absorbed: absorbed >= amount });
  }

  updateShots(dt) {
    const keep = [];
    for (const s of this.shots) {
      const target = this.foe(s.owner);
      if (s.kind === 'lob') {
        s.t += dt;
        if (s.t >= s.T) {
          this.fx.push({ kind: 'blast', x: s.tx, y: s.ty, r: s.blast, side: s.owner.side, t: 0.35, T: 0.35 });
          sfx.boom();
          if (Math.hypot(target.x - s.tx, target.y - s.ty) <= s.blast + target.r) this.damage(target, s.dmg);
          continue;
        }
        keep.push(s); continue;
      }
      if (s.kind === 'homing') {
        const want = Math.atan2(target.y - s.y, target.x - s.x), cur = Math.atan2(s.vy, s.vx);
        const turn = clamp(angDiff(want, cur), -s.owner.arch.attack.turn * dt, s.owner.arch.attack.turn * dt);
        const sp = Math.hypot(s.vx, s.vy);
        s.vx = Math.cos(cur + turn) * sp; s.vy = Math.sin(cur + turn) * sp;
      }
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      let dead = s.life <= 0 || s.x < 0 || s.x > AW || s.y < 40 || s.y > AH - 40;
      for (const pl of this.pillars) {
        if (!dead && this.solid(pl) && Math.hypot(s.x - pl.x, s.y - pl.y) < pl.r + s.r) {
          dead = true;
          this.fx.push({ kind: 'spark', x: s.x, y: s.y, vx: -s.vx * 0.2, vy: -s.vy * 0.2, side: s.owner.side, t: 0.25, T: 0.25 });
        }
      }
      if (!dead && !s.hit.has(target) && Math.hypot(s.x - target.x, s.y - target.y) < target.r + s.r) {
        this.damage(target, s.dmg);
        s.hit.add(target);
        if (s.kind !== 'pierce') dead = true;
      }
      if (!dead) keep.push(s);
    }
    this.shots = keep;
  }

  updateFx(dt) {
    for (const e of this.fx) {
      e.t -= dt;
      if (e.vx !== undefined) { e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.9; e.vy *= 0.9; }
      if (e.kind === 'num') e.y -= 30 * dt;
    }
    this.fx = this.fx.filter((e) => e.t > 0);
  }

  blocked(x1, y1, x2, y2) {
    return this.pillars.some((p) => {
      if (!this.solid(p)) return false;
      const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1;
      const t = clamp(((p.x - x1) * dx + (p.y - y1) * dy) / L, 0, 1);
      return Math.hypot(x1 + dx * t - p.x, y1 + dy * t - p.y) < p.r + 4;
    });
  }

  // Enemy fighter brain: keep a preferred range, strafe, dodge, and shoot with some lead and error.
  think(f, dt) {
    const sk = this.skill, a = f.arch.attack, foe = this.foe(f), ai = f.ai;
    const dx = foe.x - f.x, dy = foe.y - f.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
    const want = a.kind === 'melee' ? 0 : a.kind === 'lob' ? a.range * 0.6 : Math.min(a.range * 0.5, 250);
    ai.flipT -= dt;
    if (ai.flipT <= 0) { ai.strafe *= Math.random() < 0.7 ? -1 : 1; ai.flipT = 0.7 + Math.random() * 1.6; }
    const los = a.kind === 'lob' || a.kind === 'melee' || !this.blocked(f.x, f.y, foe.x, foe.y);
    let mx = 0, my = 0;
    if (dist > want + 25) { mx += ux; my += uy; } else if (dist < want - 25) { mx -= ux; my -= uy; }
    const strafe = a.kind === 'melee' ? 0.35 : los ? 0.8 : 1.3;
    mx += -uy * ai.strafe * strafe; my += ux * ai.strafe * strafe;
    // Dodge incoming fire.
    for (const s of this.shots) {
      if (s.owner === f) continue;
      if (s.kind === 'lob') {
        const ld = Math.hypot(f.x - s.tx, f.y - s.ty);
        if (ld < s.blast + f.r + 15) { mx += ((f.x - s.tx) / (ld || 1)) * 2 * sk.dodge; my += ((f.y - s.ty) / (ld || 1)) * 2 * sk.dodge; }
        continue;
      }
      const rx = f.x - s.x, ry = f.y - s.y, sp = Math.hypot(s.vx, s.vy) || 1;
      const t = (rx * s.vx + ry * s.vy) / (sp * sp);
      if (t < 0 || t > 0.6) continue;
      const cx = rx - s.vx * t, cy = ry - s.vy * t, cd = Math.hypot(cx, cy);
      if (cd < f.r + 22) { mx += (cx / (cd || 1)) * 1.8 * sk.dodge; my += (cy / (cd || 1)) * 1.8 * sk.dodge; }
    }
    if (f.x < 60) mx += 1; if (f.x > AW - 60) mx -= 1;
    if (f.y < 100) my += 1; if (f.y > AH - 100) my -= 1;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const spd = f.arch.speed * sk.speed;
    f.vx += (mx * spd - f.vx) * Math.min(1, dt * 10);
    f.vy += (my * spd - f.vy) * Math.min(1, dt * 10);
    if (!(Math.abs(mx) < 0.01 && Math.abs(my) < 0.01)) f.face = Math.atan2(my, mx);

    ai.react -= dt;
    const inRange = a.kind === 'melee' ? dist <= a.reach + f.r + foe.r * 0.4 : dist <= a.range * 0.9;
    if (f.cd <= 0 && ai.react <= 0 && inRange && los) {
      const aim = this.leadAim(f, foe, sk.lead);
      const ang = Math.atan2(aim.y, aim.x) + (Math.random() - 0.5) * sk.err;
      this.fire(f, { x: Math.cos(ang), y: Math.sin(ang) }, aim.dist);
      ai.react = sk.react * (0.5 + Math.random());
    }
  }

  draw(ctx, now) {
    this.ctx = ctx;
    const lum = this.lum;
    // Floor tinted by the square's light.
    const bg = ctx.createLinearGradient(0, 0, 0, AH);
    const warm = Math.max(0, lum) / 3, cool = Math.max(0, -lum) / 3;
    bg.addColorStop(0, `rgb(${20 + 40 * warm},${18 + 18 * warm + 6 * cool},${36 + 50 * cool})`);
    bg.addColorStop(1, `rgb(${12 + 30 * warm},${12 + 12 * warm},${26 + 36 * cool})`);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, AW, AH);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (let x = 0; x <= AW; x += 40) { ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x, AH - 40); ctx.stroke(); }
    for (let y = 40; y <= AH - 40; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(AW, y); ctx.stroke(); }
    if (this.time > COLLAPSE_AT) {
      ctx.fillStyle = `rgba(255,40,60,${0.08 + 0.06 * Math.sin(this.time * 6)})`;
      ctx.fillRect(0, 40, AW, AH - 80);
    }

    for (const p of this.pillars) {
      const ph = (Math.sin(this.time * 0.9 + p.off) + 1) / 2, solid = this.solid(p);
      ctx.globalAlpha = solid ? 0.55 + ph * 0.45 : 0.18;
      const g = ctx.createRadialGradient(p.x, p.y - p.r * 0.4, 2, p.x, p.y, p.r);
      g.addColorStop(0, '#e8f4ff'); g.addColorStop(1, '#4a6a8c');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#cfe6ff'; ctx.lineWidth = 2; ctx.setLineDash(solid ? [] : [4, 5]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    for (const f of this.fighters) {
      if (f.hp <= 0 && this.over) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(f.x, f.y + f.r * 0.9, f.r, f.r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      if (f.shield > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.5 * (f.shield / (f.maxShield || 1))})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 7, 0, Math.PI * 2); ctx.stroke();
      }
      drawGlyph(ctx, f.unit.type, f.side, f.x, f.y, f.r, { ang: f.face, flash: f.flash > 0, time: now });
      if (f.isPlayer) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 12, f.face - 0.25, f.face + 0.25); ctx.stroke();
        if (f.cd > 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - f.cd / f.arch.attack.cd)); ctx.stroke();
        }
      }
    }

    for (const s of this.shots) {
      const col = COLORS[s.owner.side];
      if (s.kind === 'lob') {
        const k = s.t / s.T, x = s.sx + (s.tx - s.sx) * k, y = s.sy + (s.ty - s.sy) * k, h = Math.sin(k * Math.PI) * 70;
        ctx.strokeStyle = col.glow + '0.4)'; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(s.tx, s.ty, s.blast, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col.light; ctx.beginPath(); ctx.arc(x, y - h, 8, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      ctx.fillStyle = col.light; ctx.shadowColor = col.main; ctx.shadowBlur = 12;
      if (s.kind === 'pierce') {
        const a = Math.atan2(s.vy, s.vx);
        ctx.strokeStyle = col.light; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - Math.cos(a) * 26, s.y - Math.sin(a) * 26); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    for (const e of this.fx) {
      const k = e.t / e.T, col = COLORS[e.side] || COLORS.dawn;
      ctx.globalAlpha = k;
      if (e.kind === 'spark') { ctx.fillStyle = col.light; ctx.fillRect(e.x - 2, e.y - 2, 4, 4); }
      if (e.kind === 'blast') {
        ctx.fillStyle = col.glow + (0.5 * k) + ')';
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1.2 - k * 0.3), 0, Math.PI * 2); ctx.fill();
      }
      if (e.kind === 'swing') {
        ctx.fillStyle = col.glow + (0.55 * k) + ')';
        ctx.beginPath(); ctx.moveTo(e.x, e.y);
        ctx.arc(e.x, e.y, e.reach, e.ang - e.arc / 2, e.ang + e.arc / 2); ctx.closePath(); ctx.fill();
      }
      if (e.kind === 'num') {
        ctx.fillStyle = e.absorbed ? '#cfe6ff' : '#fff'; ctx.font = 'bold 15px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(e.text, e.x, e.y);
      }
      ctx.globalAlpha = 1;
    }

    this.drawBar(this.enemy, 8);
    this.drawBar(this.player, AH - 34);
    ctx.textAlign = 'center';
    if (this.time > COLLAPSE_AT - 5 && !this.over) {
      ctx.fillStyle = '#ff6b7d'; ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText(this.time > COLLAPSE_AT ? 'ARENA COLLAPSING' : `Collapse in ${Math.ceil(COLLAPSE_AT - this.time)}`, AW / 2, 62);
    }
    if (this.intro > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, AH / 2 - 60, AW, 120);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText(this.intro > 0.5 ? `${NAMES[this.player.side][this.player.unit.type]} vs ${NAMES[this.enemy.side][this.enemy.unit.type]}` : 'FIGHT!', AW / 2, AH / 2);
      ctx.font = '13px system-ui, sans-serif'; ctx.fillStyle = '#bbb';
      ctx.fillText('Left thumb: move · Right thumb: drag to aim, tap to auto-fire', AW / 2, AH / 2 + 30);
    }
    if (this.over) {
      const won = this.player.hp > 0, both = this.player.hp <= 0 && this.enemy.hp <= 0;
      ctx.fillStyle = both ? '#ddd' : won ? '#ffe08a' : '#ff8a8a'; ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.fillText(both ? 'Mutual Ruin' : won ? 'Victory' : 'Defeated', AW / 2, AH / 2);
    }
  }

  drawBar(f, y) {
    const ctx = this.ctx;
    const w = AW - 24, total = f.unit.maxHp + f.maxShield;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(12, y, w, 26);
    ctx.fillStyle = COLORS[f.side].main; ctx.fillRect(12, y, w * Math.max(0, f.hp) / total, 26);
    ctx.fillStyle = 'rgba(230,240,255,0.8)'; ctx.fillRect(12 + w * Math.max(0, f.hp) / total, y, w * f.shield / total, 26);
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 3; ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`${NAMES[f.side][f.unit.type]}${f.isPlayer ? ' (you)' : ''}`, 18, y + 18);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.max(0, Math.ceil(f.hp))}${f.shield > 0 ? ` +${Math.ceil(f.shield)}` : ''}`, AW - 18, y + 18);
    ctx.shadowBlur = 0;
  }
}
