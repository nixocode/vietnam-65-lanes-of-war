'use strict';

const CANVAS_W = 1280, CANVAS_H = 720; // viewport
const WORLD_W = 2560;                  // battlefield width — scroll to see it all
// Vertical scale of the lane elevation profiles. At 96 a whole map moved a
// soldier about 30px — the ground read as flat. This gives real hills and
// terraces without touching any map's authored shape.
const ELEV_PX = 230;
// a little more air between the tiers, so raised ground reads as levels
const LANE_BASE = [388, 520, 664];
const LANE_DEPTH = [0.84, 0.96, 1.1];
const LANE_BANDS = [[288, 458], [458, 584], [584, 720]];
const BASE_X = { us: 52, vc: WORLD_W - 52 };

/* unit key → sliced sprite sheet (assets/manifest.js). Missing sheet = procedural. */
const UNIT_SPRITES = {
  rifleman: 'us_rifle', arvn: 'arvn', m60: 'us_m60', engineer: 'us_rifle',
  recon: 'us_sniper', sniper: 'us_sniper',
  guerrilla: 'vc_rifle', nva: 'vc_gunner', rpd: 'vc_gunner',
  sapper: 'vc_black', marksman: 'vc_sniper',
};

/* battlefield-dressing art sliced from the casualty sheet */
const DECAL_ART = {
  corpse_us: 'decal_extra0', corpse_vc: 'decal_extra1', hat: 'decal_extra2',
  wounded_a: 'decal_extra3', wounded_b: 'decal_extra4',
  stretcher: 'decal_extra5', sandbag_dead: 'decal_extra6',
};

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(a, b) { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }
function other(side) { return side === 'us' ? 'vc' : 'us'; }
// deterministic per-map scenery placement
function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const FACTIONS = {
  us: { name: 'US / ARVN', doctrine: 'FIREPOWER DOCTRINE', color: '#8aa06b', bright: '#b5c98f' },
  vc: { name: 'VC / NVA', doctrine: 'GROUND DOCTRINE', color: '#c25b45', bright: '#e08767' },
};

const DIFFS = {
  recruit: { label: 'Recruit', aiIncome: 0.85, aiInterval: 2.4, playerIncome: 1.1, mistake: 0.3 },
  veteran: { label: 'Veteran', aiIncome: 1.05, aiInterval: 1.7, playerIncome: 1.0, mistake: 0.12 },
  elite:   { label: 'Elite',   aiIncome: 1.3,  aiInterval: 1.2, playerIncome: 1.0, mistake: 0.02 },
};

/* ---------------- Units ----------------
   hat: m1 | boonie | conical | pith | band | cap
   speed px/s, rof shots/s, range px, acc hit chance */
/* rof = rounds/sec INSIDE a burst; burst = [min,max] rounds; pause = [min,max] s
   between bursts. Accuracy is per round — most rounds miss, as they did. */
const UNITS = {
  rifleman: { side: 'us', name: 'Rifleman', sub: 'M16', cost: 10, cd: 4, hp: 55, dmg: 9, rof: 5, burst: [2, 4], pause: [0.9, 1.7], range: 320, speed: 42, acc: 0.4, hat: 'm1' },
  arvn:     { side: 'us', name: 'ARVN', sub: 'Light Inf.', cost: 7, cd: 2.5, hp: 40, dmg: 7, rof: 4.5, burst: [2, 3], pause: [1.0, 1.8], range: 280, speed: 46, acc: 0.33, hat: 'm1', small: true },
  m60:      { side: 'us', name: 'M60 Gunner', sub: 'MG', cost: 24, cd: 9, hp: 70, dmg: 6, rof: 9, burst: [6, 11], pause: [1.3, 2.2], range: 380, speed: 32, acc: 0.32, hat: 'm1', mg: true, suppress: true },
  engineer: { side: 'us', name: 'Engineer', sub: 'Demo', cost: 18, cd: 8, hp: 60, dmg: 8, rof: 4, burst: [1, 3], pause: [1.1, 1.9], range: 230, speed: 37, acc: 0.4, hat: 'm1', engineer: true, pack: true },
  recon:    { side: 'us', name: 'LRRP Recon', sub: 'Spotter', cost: 16, cd: 10, hp: 45, dmg: 8, rof: 4.5, burst: [2, 3], pause: [0.9, 1.6], range: 340, speed: 48, acc: 0.45, hat: 'boonie', detect: 325, antenna: true },
  sniper:   { side: 'us', name: 'Scout Sniper', sub: 'M40', cost: 42, cd: 16, hp: 40, dmg: 999, rof: 0.3, range: 700, speed: 30, acc: 0.97, hat: 'boonie', sniper: true, aim: 2.6 },

  /* Vehicles.
     A vehicle is a unit like any other so it inherits targeting, cover, morale
     and damage for free — it just carries `vehicle: true`, which the renderer
     uses to draw a prop instead of a soldier, and which the sim uses to keep it
     off the ground (it never goes prone, dives, or takes a stance). Heavy armour
     against small arms, but a sapper's satchel or a mine kills it outright. */
  m113:     { side: 'us', name: 'M113 APC', sub: '.50 cal', cost: 0, cd: 0, hp: 260, dmg: 8,
              rof: 7.5, burst: [6, 11], pause: [1.3, 2.1], range: 340, speed: 30, acc: 0.34,
              hat: null, mg: true, suppress: true, vehicle: true, prop: 'm113',
              armour: 0.34 },

  guerrilla:{ side: 'vc', name: 'Guerrilla', sub: 'Local Force', cost: 8, cd: 3, hp: 45, dmg: 8, rof: 5, burst: [2, 4], pause: [1.0, 1.9], range: 280, speed: 44, acc: 0.35, hat: 'conical', conceal: true, ambush: 1.6 },
  nva:      { side: 'vc', name: 'NVA Regular', sub: 'AK-47', cost: 14, cd: 4.5, hp: 60, dmg: 10, rof: 5.5, burst: [2, 5], pause: [0.9, 1.7], range: 310, speed: 40, acc: 0.4, hat: 'pith', conceal: true, ambush: 1.35 },
  rpd:      { side: 'vc', name: 'RPD Gunner', sub: 'MG', cost: 22, cd: 9, hp: 65, dmg: 6, rof: 8.5, burst: [5, 9], pause: [1.4, 2.3], range: 360, speed: 33, acc: 0.3, hat: 'pith', mg: true, suppress: true },
  /* The VC answer to armour. Slow, short-legged and useless in a firefight, but
     its warhead ignores armour — without it the APC could only be killed by a
     sapper closing to satchel range, which is not a counter, it is a hope. */
  rpgman:   { side: 'vc', name: 'RPG Gunner', sub: 'B-40', cost: 0, cd: 0, hp: 48, dmg: 46,
              rof: 0.42, range: 260, speed: 36, acc: 0.55, hat: 'pith',
              conceal: true, ambush: 1, at: true, blast: 46 },

  sapper:   { side: 'vc', name: 'Sapper', sub: 'Satchel', cost: 20, cd: 10, hp: 55, dmg: 0, rof: 0, range: 38, speed: 56, acc: 1, hat: 'band', sapper: true, conceal: true, ambush: 1 },
  marksman: { side: 'vc', name: 'Marksman', sub: 'Mosin', cost: 36, cd: 15, hp: 38, dmg: 999, rof: 0.3, range: 640, speed: 31, acc: 0.95, hat: 'conical', sniper: true, aim: 2.9, conceal: true, ambush: 1 },
};

/* ---------------- Squads ----------------
   The deployable is a SQUAD (Warfare 1944 style); comp lists the men, each drawing
   his stats from UNITS. cost/cd are squad-level. */
const SQUADS = {
  rifles:    { side: 'us', name: 'Rifle Squad', sub: '4 men · M16', cost: 26, cd: 8,
               comp: ['rifleman', 'rifleman', 'rifleman', 'rifleman'], portrait: 'port_rifleman',
               grenades: true, ability: 'Frag Grenades — flush dug-in enemies' },
  arvnsq:    { side: 'us', name: 'ARVN Squad', sub: '3 men · Light', cost: 15, cd: 5.5,
               comp: ['arvn', 'arvn', 'arvn'], portrait: 'port_arvn',
               grenades: true, ability: 'Frag Grenades' },
  weapons:   { side: 'us', name: 'Weapons Team', sub: 'M60 + rifle', cost: 30, cd: 12,
               comp: ['m60', 'rifleman'], portrait: 'port_m60',
               suppressive: true, ability: 'Suppressive Fire — pins a target squad' },
  engineers: { side: 'us', name: 'Engineer Team', sub: 'Demo ×2', cost: 24, cd: 10,
               comp: ['engineer', 'engineer'], portrait: 'port_engineer',
               ability: 'Clears traps, tunnels, spider holes' },
  lrrp:      { side: 'us', name: 'LRRP Team', sub: 'Recon ×2', cost: 22, cd: 11,
               comp: ['recon', 'rifleman'], portrait: 'port_recon',
               ability: 'Spots concealed enemies at range' },
  snipers:   { side: 'us', name: 'Sniper Team', sub: 'M40 + spotter', cost: 48, cd: 18,
               comp: ['sniper', 'recon'], portrait: 'port_sniper',
               ability: 'One shot, one kill · spotter marks' },

  apc:       { side: 'us', name: 'APC Section', sub: 'M113 · .50 cal', cost: 40, cd: 20,
               comp: ['m113'], portrait: 'port_rifleman',
               ability: 'Armour — shrugs off small arms, but sappers and mines kill it' },

  rpgteam:   { side: 'vc', name: 'RPG Team', sub: 'B-40 + rifle', cost: 26, cd: 12,
               comp: ['rpgman', 'nva'], portrait: 'port_nva',
               ability: 'Rocket — ignores armour, wrecks cover' },

  cell:      { side: 'vc', name: 'Guerrilla Cell', sub: '3 fighters', cost: 16, cd: 5.5,
               comp: ['guerrilla', 'guerrilla', 'guerrilla'], portrait: 'port_guerrilla',
               grenades: true, ability: 'Stick Grenades · ambush from brush' },
  nvasq:     { side: 'vc', name: 'NVA Squad', sub: '4 men · AK', cost: 30, cd: 9,
               comp: ['nva', 'nva', 'nva', 'nva'], portrait: 'port_nva',
               grenades: true, ability: 'Stick Grenades' },
  rpdteam:   { side: 'vc', name: 'RPD Team', sub: 'RPD + AK', cost: 28, cd: 12,
               comp: ['rpd', 'nva'], portrait: 'port_rpd',
               suppressive: true, ability: 'Suppressive Fire — pins a target squad' },
  sapperu:   { side: 'vc', name: 'Sapper', sub: 'Satchel', cost: 20, cd: 10,
               comp: ['sapper'], portrait: 'port_sapper',
               ability: 'Satchel charge — devastates positions' },
  marksmanu: { side: 'vc', name: 'Marksman', sub: 'Mosin', cost: 40, cd: 16,
               comp: ['marksman'], portrait: 'port_marksman',
               ability: 'One shot, one kill from concealment' },
};

const GRENADE = { range: 115, blast: 44, dmg: 34, fuse: 0.7, flight: 0.85, cd: 14 };

/* Smoke. The bounding-advance rules already say a squad will not cross open
 * ground while a lane is being swept — smoke is the tool that changes that
 * answer. Popping it is the difference between being stuck and taking the
 * ground, which makes it a real decision rather than another damage button. */
const SMOKE = {
  range: 140, radius: 88, life: 13, build: 1.1, cd: 22, flight: 0.8,
};

const ROSTERS = {
  us: ['rifles', 'arvnsq', 'weapons', 'apc', 'engineers', 'lrrp', 'snipers'],
  vc: ['cell', 'nvasq', 'rpdteam', 'rpgteam', 'sapperu', 'marksmanu'],
};

/* ---------------- Call-ins / abilities ----------------
   target: 'point' needs lane+x click; 'none' fires immediately */
const CALLINS = {
  arty:     { side: 'us', name: 'Fire Mission', cost: 45, cd: 26, key: 'Q', target: 'point', icon: 'shell',
              hint: 'MARK TARGET FOR 105MM BATTERY' },
  napalm:   { side: 'us', name: 'Napalm', cost: 65, cd: 40, key: 'W', target: 'point', icon: 'flame',
              hint: 'MARK STRIP FOR AIR STRIKE — BURNS COVER' },
  medevac:  { side: 'us', name: 'Dustoff', cost: 30, cd: 36, key: 'E', target: 'none', icon: 'cross',
              hint: '' },
  aircav:   { side: 'us', name: 'Air Cav', cost: 55, cd: 48, key: 'R', target: 'point', icon: 'huey',
              hint: 'MARK LZ FOR HELICOPTER INSERTION' },
  arclight: { side: 'us', name: 'Arc Light', cost: 130, cd: 120, key: 'T', target: 'point', icon: 'b52',
              hint: 'MARK GRID FOR B-52 STRIKE' },

  punji:    { side: 'vc', name: 'Punji Pit', cost: 12, cd: 9, key: 'Q', target: 'point', icon: 'spikes',
              hint: 'PLACE HIDDEN PUNJI STAKES' },
  mine:     { side: 'vc', name: 'Tripwire', cost: 18, cd: 13, key: 'W', target: 'point', icon: 'mine',
              hint: 'PLACE TRIPWIRE CHARGE' },
  spiderhole:{ side: 'vc', name: 'Spider Hole', cost: 34, cd: 28, key: 'E', target: 'point', icon: 'hole',
              hint: 'BURY A MARKSMAN IN AMBUSH' },
  tunnel:   { side: 'vc', name: 'Tunnel', cost: 45, cd: 55, key: 'R', target: 'point', icon: 'tunnel',
              hint: 'DIG FORWARD EXIT — TROOPS EMERGE HERE' },
};

const CALLIN_ROSTERS = {
  us: ['arty', 'napalm', 'medevac', 'aircav', 'arclight'],
  vc: ['punji', 'mine', 'spiderhole', 'tunnel'],
};

/* ---------------- Maps ----------------
   lane pts: [normalized x, elevation 0..1]; conceal zones normalized [x0,x1]
   trees: grass | jungle | palm | shattered
   mode: standard | siege (vc attacks, timer favors us) | assault (us must take flags) */
const MAPS = {
  iadrang: {
    id: 'iadrang', name: 'IA DRANG VALLEY', year: 'NOVEMBER 1965', mode: 'standard',
    desc: 'Open rolling grassland in the Central Highlands. First major clash of US air cavalry and NVA regulars.',
    trees: 'grass', treeDensity: 0.35, seed: 11965,
    weather: {},
    pal: {
      skyTop: '#f6d7a0', skyBot: '#e8a35e', sun: { x: 1020, y: 130, r: 46, color: '#fff3d0' },
      /* Golden elephant grass needs something cool to sit against or the whole
       * valley is one amber wash (it was: 43 degree spread). The Chu Pong massif
       * goes blue-grey with distance, which is both what haze actually does to a
       * far ridge and the contrast the foreground was missing. Spread 195. */
      hillFar: '#8c93a8', hillNear: '#8f6a42',
      laneTop: ['#a8954f', '#9c8a46', '#8f7c3e'], laneBody: ['#7d6c38', '#726231', '#67582b'],
      brush: '#5f7a38', tree: '#44502c', haze: 'rgba(240,195,130,0.13)',
    },
    lanes: [
      { pts: [[0, .18], [.2, .32], [.45, .16], [.7, .34], [1, .22]], conceal: [[.52, .68]] },
      { pts: [[0, .12], [.3, .24], [.55, .1], [.8, .28], [1, .18]], conceal: [[.58, .76]] },
      { pts: [[0, .08], [.25, .2], [.5, .07], [.75, .22], [1, .12]], conceal: [[.46, .6]] },
    ],
    flags: [.5, .5, .5],
    settlements: [
      { lane: 1, x: .36, kind: 'hamlet' },
      { lane: 2, x: .66, kind: 'hamlet' },
    ],
  },

  cuchi: {
    id: 'cuchi', name: 'CU CHI DISTRICT', year: 'JANUARY 1966', mode: 'standard',
    desc: 'Dense jungle over a vast tunnel network northwest of Saigon. The ground itself is hostile.',
    trees: 'jungle', treeDensity: 1.0, seed: 21966,
    weather: { fog: 0.35 },
    detectPenalty: 0.85,
    pal: {
      /* Cu Chi was a single hue — sky, hills, ground, brush and trees all green
       * across a 30 degree spread, which is why the map read as flat no matter
       * how much texture went into the terrain. The fix is the map's own
       * history: those tunnels were dug through RED LATERITE, so the earth a
       * man stands on is now red-brown and the canopy above it stays green.
       * Turf keeps the green on top, the soil beneath it does not. Spread 127. */
      skyTop: '#d6e4d0', skyBot: '#a8c49a', sun: { x: 640, y: 100, r: 60, color: 'rgba(255,255,240,0.7)' },
      hillFar: '#6e8478', hillNear: '#42603c',
      laneTop: ['#5a6b34', '#4f5f2d', '#455428'], laneBody: ['#6b4028', '#5e3823', '#52301e'],
      brush: '#3f652c', tree: '#243820', haze: 'rgba(200,225,195,0.12)',
    },
    lanes: [
      { pts: [[0, .1], [.3, .2], [.6, .1], [1, .16]], conceal: [[.22, .42], [.58, .84]] },
      { pts: [[0, .08], [.35, .16], [.7, .08], [1, .14]], conceal: [[.3, .5], [.64, .88]] },
      { pts: [[0, .06], [.4, .14], [.75, .06], [1, .1]], conceal: [[.2, .38], [.55, .78]] },
    ],
    flags: [.48, .52, .5],
    startCP: { vc: 25 },
    settlements: [
      { lane: 0, x: .3, kind: 'village' },
      { lane: 2, x: .58, kind: 'hamlet' },
      { lane: 1, x: .74, kind: 'hamlet' },
    ],
  },

  mekong: {
    id: 'mekong', name: 'MEKONG DELTA', year: 'JUNE 1967', mode: 'standard',
    desc: 'Rice paddies, canals and raised dikes at sunset. Close terrain where farmland and battlefield blur.',
    trees: 'palm', treeDensity: 0.55, seed: 31967,
    weather: {},
    pal: {
      skyTop: '#f2a65e', skyBot: '#e4695a', sun: { x: 340, y: 170, r: 58, color: '#ffd9a8' },
      hillFar: '#a05c48', hillNear: '#7c4638',
      laneTop: ['#6d7a3a', '#637036', '#596631'], laneBody: ['#4d5626', '#454e22', '#3d451e'],
      brush: '#5c7030', tree: '#3a3524', haze: 'rgba(255,160,110,0.16)', water: '#d78a5e',
    },
    lanes: [
      { pts: [[0, .07], [.18, .17], [.34, .05], [.5, .16], [.66, .05], [.82, .17], [1, .08]], conceal: [[.28, .46], [.62, .8]] },
      { pts: [[0, .06], [.22, .16], [.4, .05], [.58, .15], [.74, .05], [.9, .16], [1, .07]], conceal: [[.34, .52], [.68, .84]] },
      { pts: [[0, .05], [.2, .14], [.38, .04], [.55, .14], [.72, .04], [.88, .14], [1, .06]], conceal: [[.24, .4], [.6, .76]] },
    ],
    flags: [.42, .58, .5],
    settlements: [
      { lane: 0, x: .34, kind: 'stilt' },
      { lane: 1, x: .57, kind: 'stilt' },
      { lane: 2, x: .27, kind: 'village' },
    ],
  },

  khesanh: {
    id: 'khesanh', name: 'KHE SANH', year: 'JANUARY 1968', mode: 'siege', siegeTime: 640,
    desc: 'A besieged Marine combat base on a red-earth plateau. The NVA press; the garrison holds and calls the sky.',
    trees: 'shattered', treeDensity: 0.5, seed: 41968, tod: 'night',
    weather: { fog: 0.5 },
    detectPenalty: 0.8,
    pal: {
      /* Red mud plateau — correct, and it was the ONLY note being played (36
       * degrees). Highland jungle brings the green back, a grey ridge line
       * breaks the warm run, and the trees go to deep shadow so the map has a
       * true dark to anchor against. This one is fought at night, so the dark
       * end matters more here than anywhere else. Spread 80, luminance 55. */
      skyTop: '#d97a52', skyBot: '#eeb47a', sun: { x: 200, y: 150, r: 50, color: '#ffe0b0' },
      hillFar: '#6b6a70', hillNear: '#6b4234',
      laneTop: ['#8a5a3e', '#7d5138', '#704832'], laneBody: ['#5c3a28', '#533424', '#4a2e20'],
      brush: '#5c6b34', tree: '#26301f', haze: 'rgba(230,160,110,0.2)',
    },
    lanes: [
      { pts: [[0, .72], [.22, .58], [.45, .32], [.7, .2], [1, .16]], conceal: [[.55, .8]] },
      { pts: [[0, .68], [.25, .52], [.5, .28], [.75, .17], [1, .13]], conceal: [[.6, .85]] },
      { pts: [[0, .64], [.28, .48], [.52, .25], [.78, .15], [1, .11]], conceal: [[.5, .74]] },
    ],
    flags: [.3, .34, .32],
    preOwner: 'us',
    incomeMult: { vc: 1.25 },
    settlements: [
      { lane: 0, x: .09, kind: 'bunkers' },
      { lane: 1, x: .11, kind: 'bunkers' },
      { lane: 2, x: .1, kind: 'bunkers' },
      { lane: 1, x: .52, kind: 'hamlet', pre: 1 },
    ],
    prePlaced: [
      { kind: 'unit', key: 'weapons', side: 'us', lane: 0, x: 0.22, hold: true },
      { kind: 'unit', key: 'weapons', side: 'us', lane: 2, x: 0.24, hold: true },
      { kind: 'unit', key: 'rifles', side: 'us', lane: 1, x: 0.2, hold: true },
      { kind: 'unit', key: 'snipers', side: 'us', lane: 1, x: 0.12, hold: true },
    ],
  },

  hill937: {
    id: 'hill937', name: 'HILL 937', year: 'MAY 1969', mode: 'assault', assaultTime: 780,
    desc: '"Hamburger Hill." A steep, fortified ridge in the A Shau Valley under monsoon rain. The only way is up.',
    trees: 'shattered', treeDensity: 0.7, seed: 51969,
    weather: { rain: true, fog: 0.25 },
    detectPenalty: 0.85,
    pal: {
      /* Hue was never this map's problem (123 degrees) — VALUE was. Everything
       * sat mid-dark, a 45 point luminance range with no true light or true
       * dark, so an overcast hill read as mud-coloured soup. The cloud deck
       * lifts and the canopy drops to near-black. Range 45 -> 58. */
      skyTop: '#6a7a82', skyBot: '#b3c0bf', sun: { x: 900, y: 120, r: 70, color: 'rgba(230,235,235,0.35)' },
      hillFar: '#4a5a52', hillNear: '#3a4a40',
      laneTop: ['#55603c', '#4d5836', '#455031'], laneBody: ['#3a4326', '#343c22', '#2e361e'],
      brush: '#495830', tree: '#232a24', haze: 'rgba(190,205,205,0.22)',
    },
    lanes: [
      { pts: [[0, .06], [.3, .18], [.55, .42], [.78, .68], [1, .88]], conceal: [[.4, .62]] },
      { pts: [[0, .05], [.32, .16], [.58, .4], [.8, .66], [1, .86]], conceal: [[.46, .68]] },
      { pts: [[0, .04], [.28, .14], [.55, .38], [.78, .62], [1, .82]], conceal: [[.36, .58]] },
    ],
    flags: [.68, .72, .7],
    preOwner: 'vc',
    settlements: [
      { lane: 0, x: .84, kind: 'bunkers', pre: 1 },
      { lane: 1, x: .87, kind: 'bunkers' },
      { lane: 2, x: .82, kind: 'bunkers' },
    ],
    prePlaced: [
      { kind: 'unit', key: 'nvasq', side: 'vc', lane: 0, x: 0.74, hold: true },
      { kind: 'unit', key: 'nvasq', side: 'vc', lane: 2, x: 0.76, hold: true },
      { kind: 'unit', key: 'rpdteam', side: 'vc', lane: 1, x: 0.78, hold: true },
      { kind: 'hole', side: 'vc', lane: 0, x: 0.82 },
      { kind: 'hole', side: 'vc', lane: 2, x: 0.84 },
      { kind: 'trap', type: 'punji', side: 'vc', lane: 1, x: 0.55 },
      { kind: 'trap', type: 'punji', side: 'vc', lane: 0, x: 0.5 },
      { kind: 'trap', type: 'mine', side: 'vc', lane: 2, x: 0.52 },
    ],
  },
};

const MAP_ORDER = ['iadrang', 'cuchi', 'mekong', 'khesanh', 'hill937'];

/* ---------------- Campaign ---------------- */
const CAMPAIGN = [
  {
    map: 'iadrang', side: 'us', diff: 'recruit', title: 'LZ X-RAY',
    meta: 'IA DRANG VALLEY · 14 NOVEMBER 1965 · PLAYING: US 1st CAVALRY',
    brief: 'The 1st Cavalry Division (Airmobile) has put four hundred men into a clearing at the foot of the Chu Pong massif — directly beneath two NVA regiments. This is the first battle where American troops arrive entirely by helicopter, and the first test of a simple question: can firepower and mobility beat numbers and terrain?\n\nHold the line. Use artillery early and often — it is the only reason a battalion survives against a division.',
    objectives: ['◆ Break enemy morale', '◆ Hold the lane flags to bleed their will to fight', '◆ Try each call-in: Fire Mission [Q], Napalm [W], Dustoff [E]'],
  },
  {
    map: 'cuchi', side: 'vc', diff: 'veteran', title: 'THE EARTH FIGHTS',
    meta: 'CU CHI DISTRICT · JANUARY 1966 · PLAYING: LOCAL FORCE VC',
    brief: 'Beneath this stretch of jungle northwest of Saigon run two hundred kilometers of hand-dug tunnels — hospitals, workshops, barracks, all underground. The Americans sweeping above have more of everything except one thing: they do not know where you are.\n\nYou have no artillery and no aircraft. You have the ground. Seed the lanes with punji pits before their point men arrive, keep your fighters in the brush, and make every meter cost them.',
    objectives: ['◆ Break enemy morale', '◆ Place traps ahead of their advance [Q]/[W]', '◆ Dig a tunnel [R] to reinforce forward without walking'],
  },
  {
    map: 'mekong', side: 'us', diff: 'veteran', title: 'BROWN WATER',
    meta: 'MEKONG DELTA · JUNE 1967 · PLAYING: US 9th INFANTRY',
    brief: 'The delta is a checkerboard of paddies and dikes where a rifle platoon can vanish twenty meters from the trail. Every treeline is a potential ambush; every dike is high ground worth exactly one squad of casualties.\n\nRecon is not optional here. Spot the ambush before you walk into it, then burn it out.',
    objectives: ['◆ Break enemy morale', '◆ Use LRRP recon to spot concealed enemies', '◆ Napalm burns away the brush they hide in'],
  },
  {
    map: 'khesanh', side: 'vc', diff: 'veteran', title: 'THE RING TIGHTENS',
    meta: 'KHE SANH COMBAT BASE · JANUARY 1968 · PLAYING: NVA 325C DIVISION',
    brief: 'Six thousand Marines sit on the plateau ahead, and the world is watching to see whether this becomes another Dien Bien Phu. It will not be easy: they are dug in on the high ground, and everything the American war machine can fly or fire is on call above them.\n\nYou have nine minutes of darkness and fog. Break the garrison\'s will before the weather lifts and their relief arrives.',
    objectives: ['◆ Break US morale before the timer expires', '◆ Their base sits uphill — mass your attacks, use tunnels', '◆ If time runs out, the siege fails'],
  },
  {
    map: 'hill937', side: 'us', diff: 'veteran', title: 'HAMBURGER HILL',
    meta: 'HILL 937, A SHAU VALLEY · MAY 1969 · PLAYING: US 101st AIRBORNE',
    brief: 'Ten days, eleven assaults, monsoon rain, and a ridge the men have started calling Hamburger Hill. The 29th NVA Regiment is dug into bunkers on the crest, and orders are to take it — a hill that everyone suspects will be abandoned a month after it falls.\n\nThis is the war at its most grinding. The enemy owns the high ground and every approach is registered. Climb.',
    objectives: ['◆ Capture ALL THREE lane flags — or break enemy morale', '◆ Enemy fires downhill: expect losses', '◆ If the timer expires, the assault is called off'],
  },
];

/* Rolling micro-relief laid over the authored profile.
 *
 * The control points give a map its big shape — a ridge, a valley, a climb — but
 * between them the ground was a dead straight ramp. These two out-of-phase waves
 * add dips and rises at a human scale, and being pure functions of x they cost
 * nothing, stay identical every frame, and keep terrain, units, cover and decals
 * agreeing on where the ground is. Offset per lane so the tiers do not ripple in
 * unison. */
function _roll(lane, nx) {
  return Math.sin(nx * 21.7 + lane * 1.7) * 0.042 +
         Math.sin(nx * 47.3 + lane * 3.1) * 0.018 +
         Math.sin(nx * 9.1 + lane * 0.6) * 0.030;
}

function elevAt(map, lane, x) {
  const pts = map.lanes[lane].pts;
  const nx = clamp(x / WORLD_W, 0, 1);
  let base = pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = pts[i][0], e0 = pts[i][1], x1 = pts[i + 1][0], e1 = pts[i + 1][1];
    if (nx <= x1 || i === pts.length - 2) {
      const t = clamp((nx - x0) / (x1 - x0), 0, 1);
      const k = (1 - Math.cos(t * Math.PI)) / 2;
      base = e0 + (e1 - e0) * k;
      break;
    }
  }
  return base + _roll(lane, nx);
}

function groundY(map, lane, x) {
  return LANE_BASE[lane] - elevAt(map, lane, x) * ELEV_PX;
}
