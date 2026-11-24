// Unit roster. Both factions share six archetypes (so the game stays balanced)
// but each faction has its own names and look.

export const SIDES = ['dawn', 'dusk'];
export const other = (side) => (side === 'dawn' ? 'dusk' : 'dawn');

export const ARCHETYPES = {
  scout: {
    move: 3, mode: 'ground', hp: 12, speed: 200, radius: 14, value: 4,
    attack: { kind: 'bolt', dmg: 1.4, cd: 0.34, speed: 540, range: 320 },
    blurb: 'Fast, rapid light shots.',
  },
  bulwark: {
    move: 2, mode: 'ground', hp: 26, speed: 128, radius: 21, value: 8,
    attack: { kind: 'melee', dmg: 5, cd: 0.85, reach: 60, arc: 1.5 },
    blurb: 'Slow, huge melee cleave.',
  },
  bow: {
    move: 3, mode: 'ground', hp: 14, speed: 150, radius: 15, value: 7,
    attack: { kind: 'pierce', dmg: 4, cd: 1.05, speed: 860, range: 640 },
    blurb: 'Long-range piercing lance.',
  },
  kite: {
    move: 4, mode: 'fly', hp: 15, speed: 215, radius: 15, value: 7,
    attack: { kind: 'spread', dmg: 1.5, cd: 0.62, speed: 470, range: 270, count: 3, spread: 0.24 },
    blurb: 'Flies. Three-way spread shot.',
  },
  drake: {
    move: 3, mode: 'fly', hp: 18, speed: 140, radius: 18, value: 8,
    attack: { kind: 'lob', dmg: 5, cd: 1.3, speed: 330, range: 340, blast: 62 },
    blurb: 'Flies. Lobs bursting bombs over walls.',
  },
  regent: {
    move: 3, mode: 'blink', hp: 22, speed: 170, radius: 17, value: 14,
    attack: { kind: 'homing', dmg: 3, cd: 0.95, speed: 250, range: 720, turn: 2.8 },
    blurb: 'Teleports. Seeking orbs. Your leader.',
  },
};

export const NAMES = {
  dawn: { scout: 'Ember Scout', bulwark: 'Bastion', bow: 'Sunbow', kite: 'Glimmerkite', drake: 'Flarewyrm', regent: 'Solarch' },
  dusk: { scout: 'Wisp', bulwark: 'Gravemaw', bow: 'Hexbow', kite: 'Nightwing', drake: 'Ashdrake', regent: 'Umbrarch' },
};

export const COLORS = {
  dawn: { main: '#ffb547', light: '#ffe6a8', dark: '#b55d12', glow: 'rgba(255,190,80,', ui: '#ffcf72' },
  dusk: { main: '#9d7bff', light: '#d6c8ff', dark: '#3b2585', glow: 'rgba(150,120,255,', ui: '#b9a3ff' },
};

// Starting layout, listed from the back row outward.
const BACK = ['bulwark', 'kite', 'drake', 'bow', 'regent', 'bow', 'drake', 'kite', 'bulwark'];
const FRONT = [null, 'scout', 'scout', 'scout', 'scout', 'scout', 'scout', 'scout', null];

export function makeArmy(side) {
  const backRow = side === 'dawn' ? 8 : 0;
  const frontRow = side === 'dawn' ? 7 : 1;
  const units = [];
  BACK.forEach((type, c) => units.push(makeUnit(side, type, backRow, c)));
  FRONT.forEach((type, c) => type && units.push(makeUnit(side, type, frontRow, c)));
  return units;
}

let nextId = 1;
export function makeUnit(side, type, r, c) {
  const a = ARCHETYPES[type];
  return { id: `${side[0]}${nextId++}`, side, type, r, c, hp: a.hp, maxHp: a.hp };
}
