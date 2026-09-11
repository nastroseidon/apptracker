/* AppCull — decide which iPhone apps are worth keeping.
   All data is kept in this browser's localStorage. Nothing leaves the device. */
'use strict';

const KEY = 'appcull.v1';
const DAY = 86400000;

/* ---------- state ---------- */

// Assigned in init(), not here: load() reads consts declared further down, and
// at module scope those are still in the temporal dead zone.
let state = { apps: [] };

/* A first open with an empty list shows nothing about what the tool does, so it
   starts on a sample phone. Any import or manual add clears it. */
const SAMPLE = [
  ['Instagram', 1270, -404, false],
  ['TikTok', 2150, -1, false],
  ['Peloton', 780, null, true],
  ['United Airlines', 190, -924, false],
  ['GarageBand', 1640, -45, false],
  ['Duolingo', 310, -615, false],
  ['Spotify', 640, -2, false],
  ['Kindle', 220, -190, false],
];

function sampleApps() {
  const today = Date.now();
  return SAMPLE.map(([name, sizeMB, offset, neverUsed]) => ({
    id: uid(),
    name,
    sizeMB,
    lastUsed: neverUsed ? null : isoOf(new Date(today + offset * DAY)),
    neverUsed,
    pinned: false,
    notes: '',
    decision: null,
  }));
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { apps: sampleApps(), demo: true };
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.apps) ? parsed : { apps: [] };
  } catch {
    return { apps: [] };
  }
}

/* The sample is a demonstration, not the user's phone — the first real app
   they add or import replaces it wholesale rather than mixing in. */
function dropSample() {
  if (!state.demo) return;
  state = { apps: [] };
  delete state.demo;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    toast('Could not save — storage is full or blocked.');
  }
}

// Function declarations, not consts: load() runs at module scope above these,
// and a temporal-dead-zone error there would be swallowed by its own try/catch.
function uid() { return Math.random().toString(36).slice(2, 10); }
function norm(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }

/* ---------- scoring ---------- */

const UNKNOWN_STALE = 0.4;     // neutral-ish when we have no date at all

function daysSince(app, now = Date.now()) {
  if (app.neverUsed) return Infinity;   // worse than any real date, and never mistaken for one
  if (!app.lastUsed) return null;
  const t = Date.parse(app.lastUsed + 'T12:00:00');
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

// 0 while recently used, ramping to 1 at a year untouched.
function staleFactor(days) {
  if (days === null) return UNKNOWN_STALE;
  if (!Number.isFinite(days)) return 1;
  if (days <= 14) return 0;
  return Math.min(1, (days - 14) / (365 - 14));
}

// log scale so 2 GB reads as "big" and 20 MB barely registers.
function sizeFactor(mb) {
  if (!mb || mb <= 0) return 0;
  return Math.min(1, Math.log10(mb + 1) / Math.log10(2049));
}

function evaluate(app, now = Date.now()) {
  const days = daysSince(app, now);
  const mb = app.sizeMB || 0;
  const stale = staleFactor(days);
  const size = sizeFactor(mb);
  // Staleness saturates at a year, so a never-opened app and one opened once two
  // years ago tie. Break that tie: never-opened is the safer thing to delete.
  const neverBonus = app.neverUsed ? 3 : 0;
  const score = Math.min(100, Math.round(100 * (0.72 * stale + 0.28 * size)) + neverBonus);

  const reasons = [];
  if (app.neverUsed) reasons.push('You have never opened it.');
  else if (days === null) reasons.push('No last-used date recorded yet.');
  else if (days >= 365) reasons.push(`Untouched for ${Math.floor(days / 365)}+ year${days >= 730 ? 's' : ''}.`);
  else if (days >= 90) reasons.push(`Untouched for about ${Math.round(days / 30)} months.`);
  else if (days >= 30) reasons.push(`Last opened ${days} days ago.`);
  else reasons.push(days <= 1 ? 'Opened in the last day.' : `Opened ${days} days ago.`);

  if (mb >= 1024) reasons.push(`Takes up ${fmtSize(mb)} — one of the heavy ones.`);
  else if (mb >= 300) reasons.push(`Takes up ${fmtSize(mb)}.`);

  let bucket;
  if (app.pinned) {
    bucket = 'keep';
    reasons.push('Pinned, so it is never suggested for deletion.');
  } else if (score >= 55 && (days === null ? false : days >= 90)) {
    bucket = 'cull';
    reasons.push('Stale enough that deleting it costs you nothing you would miss.');
  } else if (mb >= 300 && (days === null ? false : days >= 30)) {
    bucket = 'offload';
    reasons.push('Worth offloading: iOS frees the app but keeps its documents and data.');
  } else if (days === null) {
    bucket = 'offload';
    reasons.push('Add a last-used date to get a real verdict.');
  } else {
    bucket = 'keep';
    reasons.push('Recent or small enough to leave alone.');
  }

  return { score, bucket, days, reasons };
}

/* ---------- formatting ---------- */

function fmtSize(mb) {
  if (!mb) return '—';
  if (mb >= 1024) return (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + ' GB';
  if (mb < 1) return Math.round(mb * 1024) + ' KB';
  return Math.round(mb) + ' MB';
}

function fmtDays(days) {
  if (days === null) return 'no date';
  if (!Number.isFinite(days)) return 'never used';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return days + 'd ago';
  if (days < 365) return Math.round(days / 30) + 'mo ago';
  return (days / 365).toFixed(1) + 'y ago';
}

/* ---------- import parser ---------- */
/* Tolerant of Live Text output from Settings > General > iPhone Storage,
   where the name, the size and the "Last Used" line arrive in any order. */

const SIZE_RE = /^([\d.,]+)\s*(KB|MB|GB|TB)$/i;
const SIZE_INLINE_RE = /([\d.,]+)\s*(KB|MB|GB|TB)\b/i;
const LAST_USED_RE = /last\s*used[:\s]*(.*)$/i;
const NEVER_RE = /never\s*used/i;

const SKIP = new Set([
  'iphonestorage', 'storage', 'settings', 'general', 'used', 'available',
  'apps', 'photos', 'media', 'messages', 'mail', 'ios', 'systemdata', 'system',
  'recommendations', 'offloadunusedapps', 'enable', 'showall', 'back', 'other',
  'appsanddata', 'documentsdata', 'documentsanddata', 'appsize',
]);

const UNITS = { kb: 1 / 1024, mb: 1, gb: 1024, tb: 1024 * 1024 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function toMB(value, unit) {
  const n = parseFloat(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return n * (UNITS[unit.toLowerCase()] ?? 1);
}

function isoOf(d) {
  if (!d || Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseDate(text, now = new Date()) {
  const s = String(text).trim().toLowerCase().replace(/[.]/g, '');
  if (!s) return null;
  if (s === 'today') return isoOf(now);
  if (s === 'yesterday') return isoOf(new Date(now.getTime() - DAY));

  // 8/3/25 or 8/3/2025 — US month/day order, as iOS shows in en-US.
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, mo, da, yr] = m;
    yr = Number(yr);
    if (yr < 100) yr += 2000;
    return isoOf(new Date(yr, Number(mo) - 1, Number(da)));
  }

  // "Aug 3, 2025" / "3 Aug 2025" / "Aug 3" (year implied)
  m = s.match(/([a-z]{3,})\s+(\d{1,2})(?:,?\s*(\d{4}))?/) || s.match(/(\d{1,2})\s+([a-z]{3,})(?:,?\s*(\d{4}))?/);
  if (m) {
    const parts = [m[1], m[2]];
    const monText = parts.find((p) => /[a-z]/.test(p));
    const dayText = parts.find((p) => /^\d+$/.test(p));
    const mo = MONTHS.indexOf(String(monText).slice(0, 3));
    if (mo >= 0 && dayText) {
      const day = Number(dayText);
      if (m[3]) return isoOf(new Date(Number(m[3]), mo, day));
      // No year given: take the most recent occurrence that is not in the future.
      let d = new Date(now.getFullYear(), mo, day);
      if (d.getTime() > now.getTime() + DAY) d = new Date(now.getFullYear() - 1, mo, day);
      return isoOf(d);
    }
  }
  return null;
}

function looksLikeName(line) {
  if (!line || line.length > 60) return false;
  if (SIZE_RE.test(line)) return false;
  if (LAST_USED_RE.test(line) || NEVER_RE.test(line)) return false;
  if (SKIP.has(norm(line))) return false;
  if (!/[a-z]/i.test(line)) return false;          // pure numbers / separators
  if (/^\d+(\.\d+)?\s*(of|\/)/i.test(line)) return false;
  return true;
}

function parseStorageText(text, now = new Date()) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  let cur = null;

  const flush = () => {
    if (cur && cur.name && (cur.sizeMB !== null || cur.lastUsed || cur.neverUsed)) out.push(cur);
    cur = null;
  };

  for (const line of lines) {
    const sizeOnly = line.match(SIZE_RE);
    if (sizeOnly) {
      if (cur && cur.sizeMB === null) cur.sizeMB = toMB(sizeOnly[1], sizeOnly[2]);
      continue;
    }

    if (NEVER_RE.test(line)) {
      if (cur) { cur.neverUsed = true; cur.lastUsed = null; }
      continue;
    }

    const lu = line.match(LAST_USED_RE);
    if (lu) {
      if (cur) cur.lastUsed = parseDate(lu[1], now);
      continue;
    }

    // Chrome and storage-legend rows ("iOS", "System Data", "Show All") end the
    // current record. Without this their following size and date lines would be
    // misattributed to the app above them.
    if (SKIP.has(norm(line))) { flush(); continue; }

    // A name line. Its size is sometimes glued onto the same line by Live Text.
    let name = line;
    let inlineMB = null;
    const inline = line.match(SIZE_INLINE_RE);
    if (inline) {
      const stripped = line.replace(SIZE_INLINE_RE, '').trim().replace(/[·•\-–—,]+$/, '').trim();
      // Legend rows arrive with the size glued on, e.g. "System Data 12.4 GB".
      if (SKIP.has(norm(stripped))) { flush(); continue; }
      if (looksLikeName(stripped)) {
        name = stripped;
        inlineMB = toMB(inline[1], inline[2]);
      }
    }
    if (!looksLikeName(name)) continue;

    flush();
    cur = { name, sizeMB: inlineMB, lastUsed: null, neverUsed: false };
  }
  flush();
  return out;
}

/* Merge parsed rows into state, updating rather than duplicating. */
function mergeParsed(rows) {
  dropSample();
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = state.apps.find((a) => norm(a.name) === norm(row.name));
    if (existing) {
      if (row.sizeMB !== null) existing.sizeMB = row.sizeMB;
      if (row.neverUsed) { existing.neverUsed = true; existing.lastUsed = null; }
      else if (row.lastUsed) { existing.lastUsed = row.lastUsed; existing.neverUsed = false; }
      updated++;
    } else {
      state.apps.push({
        id: uid(),
        name: row.name,
        sizeMB: row.sizeMB ?? 0,
        lastUsed: row.lastUsed,
        neverUsed: !!row.neverUsed,
        pinned: false,
        notes: '',
        decision: null,
      });
      added++;
    }
  }
  save();
  return { added, updated };
}

/* ---------- views ---------- */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

let view = 'verdict';
let search = '';
let sortBy = 'score';

function show(name) {
  view = name;
  for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== 'view-' + name;
  for (const t of document.querySelectorAll('.tab')) {
    t.setAttribute('aria-selected', String(t.dataset.view === name));
  }
  render();
}

function render() {
  $('#demo-banner').hidden = !state.demo;
  const active = state.apps.filter((a) => a.decision !== 'deleted');
  const reclaimable = active
    .filter((a) => !a.pinned && evaluate(a).bucket === 'cull')
    .reduce((sum, a) => sum + (a.sizeMB || 0), 0);
  $('#headline').textContent = state.apps.length
    ? `${active.length} apps · ${fmtSize(reclaimable)} reclaimable`
    : '';

  if (view === 'verdict') renderVerdict(active);
  if (view === 'triage') renderTriage(active);
  if (view === 'library') renderLibrary();
}

function appRow(app, ev, onClick) {
  const row = el('button', 'app' + (app.decision ? ' decided' : ''));
  row.type = 'button';

  const score = el('div', 'score s-' + ev.bucket, String(ev.score));
  const meta = el('div', 'meta');
  const name = el('div', 'name');
  name.append(el('span', null, app.name));
  if (app.pinned) name.append(el('em', 'pin', 'PINNED'));
  if (app.decision === 'deleted') name.append(el('em', 'pin', 'REMOVED'));
  if (app.decision === 'kept') name.append(el('em', 'pin', 'KEEPING'));
  meta.append(name, el('div', 'why', `${fmtDays(ev.days)} · ${fmtSize(app.sizeMB)}`));

  row.append(score, meta);
  row.addEventListener('click', () => onClick(app));
  return row;
}

function renderVerdict(active) {
  const has = active.length > 0;
  $('#verdict-empty').hidden = has;
  $('#verdict-body').hidden = !has;
  if (!has) return;

  const scored = active
    .map((a) => ({ app: a, ev: evaluate(a) }))
    .sort((x, y) => y.ev.score - x.ev.score);

  const groups = { cull: [], offload: [], keep: [] };
  for (const item of scored) groups[item.ev.bucket].push(item);

  const totalMB = active.reduce((s, a) => s + (a.sizeMB || 0), 0);
  const cullMB = groups.cull.reduce((s, i) => s + (i.app.sizeMB || 0), 0);
  const summary = $('#summary');
  summary.replaceChildren();
  for (const [value, label] of [
    [String(groups.cull.length), 'to delete'],
    [fmtSize(cullMB), 'you get back'],
    [fmtSize(totalMB), 'total'],
  ]) {
    const stat = el('div', 'stat');
    stat.append(el('b', null, value), el('span', null, label));
    summary.append(stat);
  }

  const defs = [
    ['cull', 'Delete these', 'Stale, and big enough or old enough that the space is worth more than the app.'],
    ['offload', 'Offload these', 'Settings → General → iPhone Storage → tap the app → Offload App. Frees the space, keeps your data, leaves the icon in place.'],
    ['keep', 'Keep these', 'Recent, small, or pinned. Leave them alone.'],
  ];

  const host = $('#buckets');
  host.replaceChildren();
  for (const [key, title, note] of defs) {
    const items = groups[key];
    if (!items.length) continue;
    const sec = el('section', 'bucket b-' + key);
    const head = el('div', 'bucket-head');
    head.append(el('i', 'dot'), el('h2', null, `${title} (${items.length})`));
    sec.append(head, el('p', 'bucket-note', note));
    for (const { app, ev } of items) sec.append(appRow(app, ev, openEditor));
    host.append(sec);
  }
}

function renderTriage(active) {
  const queue = active
    .filter((a) => !a.decision)
    .map((a) => ({ app: a, ev: evaluate(a) }))
    .sort((x, y) => y.ev.score - x.ev.score);

  $('#triage-empty').hidden = queue.length > 0;
  const host = $('#triage-card');
  host.hidden = queue.length === 0;
  if (!queue.length) return;

  const { app, ev } = queue[0];
  const decidedCount = state.apps.filter((a) => a.decision).length;

  host.replaceChildren();
  host.append(el('p', 'progress', `${decidedCount} decided · ${queue.length} to go`));

  const card = el('div', 'card');
  const verdict = el('div', 'verdict s-' + ev.bucket,
    ev.bucket === 'cull' ? 'Delete it' : ev.bucket === 'offload' ? 'Offload it' : 'Keep it');
  verdict.style.color = `var(--${ev.bucket === 'cull' ? 'cull' : ev.bucket === 'offload' ? 'offload' : 'keep'})`;
  card.append(
    el('div', 'big', app.name),
    el('div', 'facts', `${fmtDays(ev.days)} · ${fmtSize(app.sizeMB)} · score ${ev.score}`),
    verdict,
  );
  const ul = el('ul');
  for (const r of ev.reasons) ul.append(el('li', null, r));
  card.append(ul);

  const actions = el('div', 'row');
  const del = el('button', 'btn danger', 'I deleted it');
  del.addEventListener('click', () => decide(app, 'deleted'));
  const keep = el('button', 'btn primary', 'Keep it');
  keep.addEventListener('click', () => decide(app, 'kept'));
  const skip = el('button', 'btn', 'Edit');
  skip.addEventListener('click', () => openEditor(app));
  actions.append(del, keep, skip);
  card.append(actions);
  host.append(card);
}

function decide(app, decision) {
  app.decision = decision;
  app.decidedAt = new Date().toISOString();
  save();
  toast(decision === 'deleted' ? `${app.name} marked as removed` : `Keeping ${app.name}`);
  render();
}

function renderLibrary() {
  const host = $('#app-list');
  host.replaceChildren();
  const q = norm(search);
  let items = state.apps
    .filter((a) => !q || norm(a.name).includes(q))
    .map((a) => ({ app: a, ev: evaluate(a) }));

  items.sort((x, y) => {
    if (sortBy === 'name') return x.app.name.localeCompare(y.app.name);
    if (sortBy === 'size') return (y.app.sizeMB || 0) - (x.app.sizeMB || 0);
    if (sortBy === 'stale') return (y.ev.days ?? -1) - (x.ev.days ?? -1);
    return y.ev.score - x.ev.score;
  });

  if (!items.length) {
    host.append(el('p', 'muted', state.apps.length ? 'No matches.' : 'No apps yet — import or add one.'));
    return;
  }
  for (const { app, ev } of items) host.append(appRow(app, ev, openEditor));
}

/* ---------- editor ---------- */

let editing = null;

function openEditor(app) {
  editing = app || null;
  const dlg = $('#editor');
  const f = $('#editor-form');
  $('#editor-title').textContent = app ? app.name : 'Add an app';
  $('#editor-delete').hidden = !app;

  const mb = app?.sizeMB || 0;
  const useGB = mb >= 1024;
  f.name.value = app?.name || '';
  f.size.value = mb ? (useGB ? (mb / 1024).toFixed(2) : Math.round(mb)) : '';
  f.unit.value = useGB ? 'GB' : 'MB';
  f.lastUsed.value = app?.lastUsed || '';
  f.neverUsed.checked = !!app?.neverUsed;
  f.pinned.checked = !!app?.pinned;
  f.notes.value = app?.notes || '';
  dlg.showModal();
}

function closeEditor(action) {
  const f = $('#editor-form');
  if (action === 'cancel') return;

  if (action === 'delete' && editing) {
    state.apps = state.apps.filter((a) => a !== editing);
    save();
    toast('Removed from the list');
    render();
    return;
  }

  const name = f.name.value.trim();
  if (!name) return;
  if (!editing) dropSample();
  const sizeMB = toMB(f.size.value || 0, f.unit.value) || 0;
  const target = editing || { id: uid(), decision: null };
  Object.assign(target, {
    name,
    sizeMB,
    lastUsed: f.neverUsed.checked ? null : (f.lastUsed.value || null),
    neverUsed: f.neverUsed.checked,
    pinned: f.pinned.checked,
    notes: f.notes.value.trim(),
  });
  if (!editing) state.apps.push(target);
  save();
  render();
}

/* ---------- misc ui ---------- */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

/* Hosted in the claude.ai artifact viewer, a plain <a download> does nothing —
   saving there goes through the downloads capability. Self-hosted, that
   capability is absent and the anchor is the only thing that works, so try the
   capability first and fall back. */
async function download(filename, text) {
  try {
    const downloads = await window.claude?.use?.('downloads');
    if (downloads) {
      await downloads.save({ filename, data: text });
      toast('Backup saved');
      return;
    }
  } catch (err) {
    toast(err?.code === 'declined' ? 'Export cancelled' : 'Could not save the backup.');
    return;
  }
  saveViaAnchor(filename, text);
}

function saveViaAnchor(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- wiring ---------- */

function init() {
  state = load();

  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => show(t.dataset.view));
  }
  for (const b of document.querySelectorAll('[data-goto]')) {
    b.addEventListener('click', () => show(b.dataset.goto));
  }

  $('#search').addEventListener('input', (e) => { search = e.target.value; renderLibrary(); });
  $('#sort').addEventListener('change', (e) => { sortBy = e.target.value; renderLibrary(); });
  $('#add-app').addEventListener('click', () => openEditor(null));
  $('#editor-form').addEventListener('submit', (e) => closeEditor(e.submitter?.value));

  $('#do-parse').addEventListener('click', () => {
    const text = $('#paste').value;
    const box = $('#parse-result');
    box.replaceChildren();
    if (!text.trim()) { box.append(noticeEl('bad', 'Nothing pasted yet.')); return; }

    const rows = parseStorageText(text);
    if (!rows.length) {
      box.append(noticeEl('bad', 'No apps recognised. Make sure each app has a size or a "Last Used" line, or add them by hand in Library.'));
      return;
    }
    const { added, updated } = mergeParsed(rows);
    const n = noticeEl('ok', `Imported ${rows.length} app${rows.length === 1 ? '' : 's'} — ${added} new, ${updated} updated.`);
    const ul = el('ul');
    for (const r of rows.slice(0, 12)) {
      ul.append(el('li', null, `${r.name} — ${r.sizeMB ? fmtSize(r.sizeMB) : 'no size'}, ${r.neverUsed ? 'never used' : r.lastUsed || 'no date'}`));
    }
    if (rows.length > 12) ul.append(el('li', null, `…and ${rows.length - 12} more`));
    n.append(ul);
    box.append(n);
    $('#paste').value = '';
    render();
  });

  $('#clear-paste').addEventListener('click', () => {
    $('#paste').value = '';
    $('#parse-result').replaceChildren();
  });

  $('#export').addEventListener('click', () => {
    download(`appcull-${isoOf(new Date())}.json`, JSON.stringify(state, null, 2));
  });

  $('#import-json').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed?.apps)) throw new Error('bad shape');
      state = parsed;
      save();
      toast(`Loaded ${state.apps.length} apps`);
      render();
    } catch {
      toast('That file is not an AppCull backup.');
    }
    e.target.value = '';
  });

  $('#wipe').addEventListener('click', () => {
    if (!confirm('Erase every app and decision stored here? This cannot be undone.')) return;
    state = { apps: [] };
    save();
    toast('Erased');
    render();
  });

  $('#drop-sample').addEventListener('click', () => {
    state = { apps: [] };
    save();
    toast('Sample cleared — import your own list');
    show('import');
  });

  show('verdict');

  // The single-file bundle ships no sw.js or manifest, so only the multi-file
  // build — the one that has a manifest link — tries to register.
  if ('serviceWorker' in navigator && document.querySelector('link[rel="manifest"]')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}

function noticeEl(kind, text) {
  return el('div', 'notice ' + kind, text);
}

if (typeof document !== 'undefined') init();

/* exported for the test runner */
if (typeof module !== 'undefined') {
  module.exports = { parseStorageText, parseDate, evaluate, toMB, fmtSize, staleFactor, sizeFactor, sampleApps };
}
