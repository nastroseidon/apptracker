const test = require('node:test');
const assert = require('node:assert');
const { parseStorageText, parseDate, evaluate, toMB, fmtSize } = require('./app.js');

const NOW = new Date('2026-09-11T12:00:00Z');
const DAY = 86400000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY).toISOString().slice(0, 10);

test('parses the three-line Live Text shape', () => {
  const rows = parseStorageText(`
Instagram
1.24 GB
Last Used: 8/3/25
TikTok
2.1 GB
Last Used: Yesterday
`, NOW);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, 'Instagram');
  assert.ok(Math.abs(rows[0].sizeMB - 1269.76) < 0.1);
  assert.strictEqual(rows[0].lastUsed, '2025-08-03');
  assert.strictEqual(rows[1].name, 'TikTok');
  assert.strictEqual(rows[1].lastUsed, daysAgo(1));
});

test('handles size glued onto the name line', () => {
  const rows = parseStorageText('Spotify 456.8 MB\nLast Used: Today', NOW);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Spotify');
  assert.ok(Math.abs(rows[0].sizeMB - 456.8) < 0.01);
  assert.strictEqual(rows[0].lastUsed, daysAgo(0));
});

test('records never-used apps', () => {
  const rows = parseStorageText('SomeBloatware\n88 MB\nNever Used', NOW);
  assert.strictEqual(rows[0].neverUsed, true);
  assert.strictEqual(rows[0].lastUsed, null);
});

test('skips storage-screen chrome and system rows', () => {
  const rows = parseStorageText(`
iPhone Storage
Recommendations
Offload Unused Apps
Show All
iOS
12.4 GB
System Data
Slack
310 MB
Last Used: Aug 1, 2026
`, NOW);
  assert.deepStrictEqual(rows.map((r) => r.name), ['Slack']);
});

test('parses the date formats iOS actually prints', () => {
  assert.strictEqual(parseDate('8/3/25', NOW), '2025-08-03');
  assert.strictEqual(parseDate('12/25/2024', NOW), '2024-12-25');
  assert.strictEqual(parseDate('Aug 3, 2025', NOW), '2025-08-03');
  assert.strictEqual(parseDate('Today', NOW), daysAgo(0));
  assert.strictEqual(parseDate('nonsense', NOW), null);
});

test('a bare month/day never resolves into the future', () => {
  // NOW is September; "Dec 25" with no year must mean last December.
  assert.strictEqual(parseDate('Dec 25', NOW), '2025-12-25');
  assert.strictEqual(parseDate('Mar 2', NOW), '2026-03-02');
});

test('an app not opened in two years is a delete', () => {
  const ev = evaluate({ name: 'X', sizeMB: 800, lastUsed: daysAgo(730) }, NOW.getTime());
  assert.strictEqual(ev.bucket, 'cull');
  assert.ok(ev.score >= 80, `score was ${ev.score}`);
});

test('a big app used last month is an offload, not a delete', () => {
  const ev = evaluate({ name: 'X', sizeMB: 2048, lastUsed: daysAgo(45) }, NOW.getTime());
  assert.strictEqual(ev.bucket, 'offload');
});

test('a small app used yesterday is a keep', () => {
  const ev = evaluate({ name: 'X', sizeMB: 40, lastUsed: daysAgo(1) }, NOW.getTime());
  assert.strictEqual(ev.bucket, 'keep');
  assert.ok(ev.score < 20, `score was ${ev.score}`);
});

test('pinning overrides every other signal', () => {
  const ev = evaluate({ name: 'X', sizeMB: 3000, neverUsed: true, pinned: true }, NOW.getTime());
  assert.strictEqual(ev.bucket, 'keep');
});

test('never-used outranks merely old', () => {
  const never = evaluate({ name: 'A', sizeMB: 100, neverUsed: true }, NOW.getTime());
  const old = evaluate({ name: 'B', sizeMB: 100, lastUsed: daysAgo(200) }, NOW.getTime());
  assert.ok(never.score > old.score);
  assert.strictEqual(never.bucket, 'cull');
});

test('unit conversion and size formatting', () => {
  assert.strictEqual(toMB('1', 'GB'), 1024);
  assert.strictEqual(toMB('1,024', 'KB'), 1);
  assert.strictEqual(fmtSize(1536), '1.5 GB');
  assert.strictEqual(fmtSize(250), '250 MB');
});

test('a skipped chrome row does not leak its date onto the app above it', () => {
  // Regression: "Messages" is filtered as a storage-legend label, and its
  // "Last Used: Today" was being applied to Duolingo instead.
  const rows = parseStorageText(`
Duolingo
310 MB
Last Used: Jan 4, 2025
Messages
120 MB
Last Used: Today
Slack
88 MB
Last Used: 9/1/26
`, NOW);
  const duo = rows.find((r) => r.name === 'Duolingo');
  assert.strictEqual(duo.lastUsed, '2025-01-04');
  assert.ok(Math.abs(duo.sizeMB - 310) < 0.01);
  // The row after the skipped one still parses cleanly.
  assert.strictEqual(rows.find((r) => r.name === 'Slack').lastUsed, '2026-09-01');
});

test('legend rows with the size glued on are not imported as apps', () => {
  const rows = parseStorageText(`
System Data 12.4 GB
iOS 8.1 GB
Notion 240 MB
Last Used: 9/5/26
`, NOW);
  assert.deepStrictEqual(rows.map((r) => r.name), ['Notion']);
});

test('a genuinely old date is not reported as "never used"', () => {
  // Regression: any date past ~900 days was colliding with the never-used sentinel.
  const ev = evaluate({ name: 'United', sizeMB: 190, lastUsed: daysAgo(924) }, NOW.getTime());
  assert.ok(Number.isFinite(ev.days));
  assert.strictEqual(ev.days, 924);
  assert.ok(ev.reasons.some((r) => /year/.test(r)), ev.reasons.join(' | '));
});

test('never-used still scores at the ceiling', () => {
  const ev = evaluate({ name: 'Peloton', sizeMB: 780, neverUsed: true }, NOW.getTime());
  assert.strictEqual(ev.days, Infinity);
  assert.strictEqual(ev.bucket, 'cull');
  assert.ok(ev.score > evaluate({ name: 'X', sizeMB: 780, lastUsed: daysAgo(400) }, NOW.getTime()).score);
});

test('the sample phone is well-formed and exercises every bucket', () => {
  const { sampleApps } = require('./app.js');
  const apps = sampleApps();
  assert.ok(apps.length >= 6);
  for (const a of apps) {
    assert.ok(a.id && a.name, 'every sample app needs an id and a name');
    assert.ok(a.neverUsed || /^\d{4}-\d{2}-\d{2}$/.test(a.lastUsed), `bad date on ${a.name}`);
  }
  const buckets = new Set(apps.map((a) => evaluate(a).bucket));
  assert.deepStrictEqual([...buckets].sort(), ['cull', 'keep', 'offload']);
});
