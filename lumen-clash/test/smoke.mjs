// Browser smoke test: title -> board -> select -> forced duel -> back to board.
// Usage: node test/smoke.mjs [outDir]   (serves ./web itself)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const out = process.argv[2] || '.';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ ...devices['iPhone 13'] });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const fail = (msg) => { console.error('FAIL', msg, errors); process.exitCode = 1; };

await page.goto(url);
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/1-title.png` });
await page.getByText('New game').click();
await page.waitForTimeout(1800);

// Tap the player's Glimmerkite (row 8, col 1) and check it gets moves.
const pos = await page.evaluate(() => { const L = __lc.layout(); return __lc.cellToScreen(8, 1, L); });
await page.touchscreen.tap(pos.x, pos.y);
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/2-board.png` });

// Move the Glimmerkite forward, then let the AI answer.
await page.touchscreen.tap(pos.x, pos.y - (await page.evaluate(() => __lc.layout().cell)) * 3);
await page.waitForFunction(() => __lc.state.turn === 'dawn' && __lc.state.turnCount >= 2, null, { timeout: 8000 })
  .catch(() => fail('AI did not reply'));

// Force a duel: put an enemy Wisp next to our Bastion and attack it.
await page.evaluate(() => {
  const s = __lc.state;
  const wisp = s.units.find((u) => u.side === 'dusk' && u.type === 'scout');
  wisp.r = 7; wisp.c = 0;
  const bastion = s.units.find((u) => u.side === 'dawn' && u.r === 8 && u.c === 0);
  __lc.commitMove(bastion, 7, 0);
});
await page.waitForFunction(() => __lc.scene === 'duel', null, { timeout: 3000 }).catch(() => fail('no duel'));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/3-duel.png` });
// Fight: hold move key and spam auto-fire until it ends.
const t0 = Date.now();
await page.keyboard.down('KeyW');
while (Date.now() - t0 < 70000 && (await page.evaluate(() => __lc.scene)) === 'duel') {
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
}
await page.keyboard.up('KeyW');
if ((await page.evaluate(() => __lc.scene)) !== 'board') fail('duel never ended');
const after = await page.evaluate(() => ({ turn: __lc.state.turn, n: __lc.state.units.length, at70: __lc.state.units.find((u) => u.r === 7 && u.c === 0) }));
console.log('after duel:', JSON.stringify(after), 'duel seconds', ((Date.now() - t0) / 1000).toFixed(1));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/4-after.png` });

// Pause menu
await page.touchscreen.tap(page.viewportSize().width - 26, 30);
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/5-pause.png` });

if (errors.length) fail('console errors');
else console.log('OK');
await browser.close();
server.close();
