// Tiny WebAudio synth so the game ships with zero audio assets.
let ac = null;
export let muted = false;
export const setMuted = (m) => { muted = m; };

export function unlockAudio() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; } }
  if (ac?.state === 'suspended') ac.resume();
}

function tone(freq, dur, type = 'sine', vol = 0.15, slide = 0) {
  if (muted || !ac) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + dur);
}

export const sfx = {
  select: () => tone(660, 0.08, 'triangle', 0.1),
  move: () => tone(330, 0.12, 'sine', 0.12, 120),
  clash: () => { tone(120, 0.4, 'sawtooth', 0.12, -60); tone(240, 0.3, 'square', 0.05, 200); },
  shoot: (side) => tone(side === 'dawn' ? 880 : 520, 0.07, 'square', 0.04, -200),
  swing: () => tone(200, 0.12, 'sawtooth', 0.07, -120),
  hit: () => tone(140, 0.12, 'square', 0.09, -60),
  boom: () => tone(90, 0.35, 'sawtooth', 0.12, -50),
  win: () => { tone(523, 0.18, 'triangle', 0.12); setTimeout(() => tone(784, 0.3, 'triangle', 0.12), 140); },
  lose: () => { tone(330, 0.2, 'triangle', 0.12); setTimeout(() => tone(196, 0.4, 'triangle', 0.12), 160); },
};

// Native haptics inside the Capacitor app (works on iOS too); browser vibration elsewhere.
export function buzz(ms) {
  if (muted) return;
  const haptics = window.Capacitor?.Plugins?.Haptics;
  if (haptics) haptics.impact({ style: ms > 40 ? 'MEDIUM' : 'LIGHT' }).catch(() => {});
  else navigator.vibrate?.(ms);
}
