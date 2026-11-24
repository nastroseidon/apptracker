// Procedural unit glyphs, drawn the same way on the board and in the arena.
import { COLORS } from './units.js';

function path(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

const poly = (n, r, rot = 0) => Array.from({ length: n }, (_, i) => {
  const a = rot + (i / n) * Math.PI * 2;
  return [Math.cos(a) * r, Math.sin(a) * r];
});

const star = (n, r1, r2, rot = -Math.PI / 2) => Array.from({ length: n * 2 }, (_, i) => {
  const a = rot + (i / (n * 2)) * Math.PI * 2, r = i % 2 ? r2 : r1;
  return [Math.cos(a) * r, Math.sin(a) * r];
});

// s is the glyph radius; ang is the facing (0 = right).
export function drawGlyph(ctx, type, side, x, y, s, { ang = -Math.PI / 2, flash = 0, alpha = 1, time = 0 } = {}) {
  const col = COLORS[side];
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  // Glow
  const g = ctx.createRadialGradient(0, 0, s * 0.3, 0, 0, s * 1.6);
  g.addColorStop(0, col.glow + '0.45)');
  g.addColorStop(1, col.glow + '0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, s * 1.6, 0, Math.PI * 2); ctx.fill();

  ctx.rotate(ang + Math.PI / 2); // glyphs are authored facing up
  const fill = ctx.createLinearGradient(0, -s, 0, s);
  fill.addColorStop(0, flash ? '#fff' : col.light);
  fill.addColorStop(0.55, flash ? '#fff' : col.main);
  fill.addColorStop(1, col.dark);
  ctx.fillStyle = fill;
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = Math.max(1.5, s * 0.1);
  ctx.lineJoin = 'round';

  switch (type) {
    case 'scout':
      path(ctx, [[0, -s], [s * 0.62, 0], [0, s * 0.85], [-s * 0.62, 0]]);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = col.light;
      ctx.beginPath(); ctx.arc(0, -s * 0.1, s * 0.2, 0, Math.PI * 2); ctx.fill();
      break;
    case 'bulwark':
      path(ctx, poly(6, s, Math.PI / 6)); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = col.light; ctx.lineWidth = s * 0.12;
      path(ctx, poly(6, s * 0.55, Math.PI / 6)); ctx.stroke();
      break;
    case 'bow':
      path(ctx, [[0, -s], [s * 0.8, s * 0.75], [-s * 0.8, s * 0.75]]);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = col.light; ctx.lineWidth = s * 0.1;
      ctx.beginPath(); ctx.arc(0, s * 0.45, s * 0.55, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, s * 0.5); ctx.lineTo(0, -s * 0.55); ctx.stroke();
      break;
    case 'kite': {
      const flap = Math.sin(time * 10) * 0.12;
      path(ctx, [[0, -s * 0.9], [s * (1 + flap), s * 0.55], [s * 0.25, s * 0.25], [0, s * 0.8],
        [-s * 0.25, s * 0.25], [-s * (1 + flap), s * 0.55]]);
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'drake':
      path(ctx, star(5, s, s * 0.6, -Math.PI / 2 + time * 0.8)); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col.dark;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col.light;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.24, 0, Math.PI * 2); ctx.fill();
      break;
    case 'regent':
      ctx.strokeStyle = col.light; ctx.lineWidth = s * 0.08;
      ctx.beginPath(); ctx.arc(0, 0, s * 1.05, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = col.dark; ctx.lineWidth = Math.max(1.5, s * 0.1);
      path(ctx, star(4, s * 0.95, s * 0.38, -Math.PI / 2 + time * 0.5)); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2); ctx.fill();
      break;
  }
  ctx.restore();
}
