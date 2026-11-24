// Unified touch / mouse / keyboard input.
// Board mode: taps. Duel mode: twin floating sticks (left half moves, right half aims+fires),
// a quick tap on the right half fires at the enemy; on desktop WASD moves and the mouse aims.
const DEAD = 0.25;
const STICK_R = 56;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'board';
    this.onTap = null;
    this.keys = new Set();
    this.move = { x: 0, y: 0 };
    this.aim = { x: 0, y: -1 };
    this.firing = false;
    this.autoFire = false;   // one-shot: fire at the enemy
    this.mouse = null;       // {x,y,down} in CSS px when a mouse is in use
    this.sticks = {};        // pointerId -> stick
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.moveEv(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'Space') this.autoFire = true; });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.reset());
  }

  reset() {
    this.sticks = {}; this.keys.clear(); this.firing = false; this.autoFire = false;
    this.move = { x: 0, y: 0 };
    if (this.mouse) this.mouse.down = false;
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  down(e) {
    e.preventDefault();
    const p = this.pos(e);
    if (this.mode === 'board') { this.onTap?.(p.x, p.y); return; }
    if (e.pointerType === 'mouse') { this.mouse = { ...p, down: true }; return; }
    this.canvas.setPointerCapture?.(e.pointerId);
    const side = p.x < this.canvas.clientWidth / 2 ? 'move' : 'aim';
    // One stick per half.
    for (const s of Object.values(this.sticks)) if (s.side === side) return;
    this.sticks[e.pointerId] = { side, ox: p.x, oy: p.y, x: p.x, y: p.y, t: performance.now() };
  }

  moveEv(e) {
    const p = this.pos(e);
    if (e.pointerType === 'mouse') { this.mouse = { ...p, down: this.mouse?.down ?? false }; return; }
    const s = this.sticks[e.pointerId];
    if (!s) return;
    s.x = p.x; s.y = p.y;
    // Let the stick base trail the finger so long drags stay responsive.
    const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy);
    if (d > STICK_R * 1.4) { s.ox = s.x - (dx / d) * STICK_R * 1.4; s.oy = s.y - (dy / d) * STICK_R * 1.4; }
  }

  up(e) {
    if (e.pointerType === 'mouse') { if (this.mouse) this.mouse.down = false; return; }
    const s = this.sticks[e.pointerId];
    if (s && s.side === 'aim' && performance.now() - s.t < 220 && Math.hypot(s.x - s.ox, s.y - s.oy) < 14) {
      this.autoFire = true;
    }
    delete this.sticks[e.pointerId];
  }

  // Called every duel frame. toArena converts CSS px to arena coords; me is the player's fighter.
  poll(toArena, me) {
    let mx = 0, my = 0, firing = false;
    for (const s of Object.values(this.sticks)) {
      const dx = (s.x - s.ox) / STICK_R, dy = (s.y - s.oy) / STICK_R;
      const m = Math.min(1, Math.hypot(dx, dy));
      const ang = Math.atan2(dy, dx);
      if (s.side === 'move' && m > 0.12) { mx = Math.cos(ang) * m; my = Math.sin(ang) * m; }
      if (s.side === 'aim' && m > DEAD) { this.aim = { x: Math.cos(ang), y: Math.sin(ang), mag: m }; firing = true; }
    }
    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    if (kx || ky) { const d = Math.hypot(kx, ky); mx = kx / d; my = ky / d; }
    if (this.mouse && me) {
      const a = toArena(this.mouse.x, this.mouse.y);
      const dx = a.x - me.x, dy = a.y - me.y, d = Math.hypot(dx, dy) || 1;
      this.aim = { x: dx / d, y: dy / d, dist: d };
      if (this.mouse.down) firing = true;
    }
    this.move = { x: mx, y: my };
    this.firing = firing;
    const auto = this.autoFire; this.autoFire = false;
    return { move: this.move, aim: this.aim, firing, auto };
  }

  drawSticks(ctx) {
    for (const s of Object.values(this.sticks)) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.ox, s.oy, STICK_R, 0, Math.PI * 2); ctx.stroke();
      const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy), k = d > STICK_R ? STICK_R / d : 1;
      ctx.globalAlpha = 0.5; ctx.fillStyle = s.side === 'aim' ? '#ff8a6b' : '#fff';
      ctx.beginPath(); ctx.arc(s.ox + dx * k, s.oy + dy * k, 24, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
}
