'use strict';

const CP_CAP = 250;

/* Squad veterancy. Men who survive contact get better at it, which is the whole
 * reason to pull a hurt squad back instead of feeding it. Kept deliberately small
 * — this should reward keeping a squad alive, not make a rank-3 squad unkillable.
 * Thresholds are kills by that squad. */
const RANKS = [
  { at: 0,  name: 'GREEN',     acc: 1.00, steady: 1.00 },
  { at: 3,  name: 'SEASONED',  acc: 1.08, steady: 0.88 },
  { at: 8,  name: 'VETERAN',   acc: 1.16, steady: 0.76 },
  { at: 16, name: 'HARDENED',  acc: 1.24, steady: 0.64 },
];

function rankOf(xp) {
  let r = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if ((xp || 0) >= RANKS[i].at) { r = i; break; }
  }
  return r;
}
const INCOME = { us: 3.1, vc: 3.5 }; // squads cost more than v1 units — keep waves breathing
const FLAG_INCOME = 0.5;
const FLAG_DRAIN = 0.22;
const MORALE_LOSS = { us: 0.24, vc: 0.15 }; // per CP of unit lost — US is casualty-sensitive
const MAX_TRAPS = 10;

/* structure archetypes: [w, hp] */
const STRUCT_DEFS = {
  hooch:     { w: 42, hp: 60 },
  longhouse: { w: 74, hp: 110 },
  stilt:     { w: 48, hp: 55 },
  bunker:    { w: 52, hp: 220 },
  well:      { w: 12, hp: 70 },
  hay:       { w: 16, hp: 25 },
  tower:     { w: 30, hp: 120 },   // sniper emplacement — commanding view
  mgnest:    { w: 40, hp: 170 },   // log-and-sandbag MG position
  banana:    { w: 24, hp: 20 },
  cart:      { w: 28, hp: 24 },
  shrine:    { w: 18, hp: 30 },
  stall:     { w: 32, hp: 30 },
};

function buildSettlement(map, s, structures) {
  const rng = seeded((map.seed + s.lane * 7 + Math.floor(s.x * 997)) >>> 0);
  const cx = s.x * WORLD_W;
  const put = (kind, off) => {
    const d = STRUCT_DEFS[kind];
    structures.push({
      lane: s.lane, x: cx + off, w: d.w, kind,
      hp: s.pre ? d.hp * 0.4 : d.hp, maxHp: d.hp,
      state: s.pre ? 1 : 0, burnT: 0, fireHurt: 0,
      seed: Math.floor(rng() * 1e9),
    });
  };
  if (s.kind === 'hamlet') {
    put('hooch', -66); put('hooch', 6); put('hooch', 72);
    put('well', -18); put('hay', 40);
    put('banana', -96); put('cart', 98);
  } else if (s.kind === 'village') {
    put('hooch', -110); put('longhouse', -30); put('hooch', 52);
    put('hooch', 112); put('well', 84); put('hay', -66);
    put('banana', -146); put('shrine', -138); put('stall', 148); put('banana', 170);
  } else if (s.kind === 'stilt') {
    put('stilt', -54); put('stilt', 8); put('stilt', 66); put('hay', -14);
    put('banana', 100); put('cart', -88);
  } else if (s.kind === 'bunkers') {
    put('bunker', -34); put('bunker', 38); put('hay', 0);
  }
}

class Game {
  constructor(cfg) {
    this.map = MAPS[cfg.mapId];
    this.player = cfg.playerSide;
    this.enemy = other(this.player);
    this.aiSide = this.enemy;
    this.diff = DIFFS[cfg.difficulty || 'veteran'];
    this.mode = this.map.mode;

    this.fx = new FXManager(this.map);
    this.units = [];
    this.traps = [];
    this.holes = [];
    this.tunnels = [];
    this.strikes = [];
    this.fires = [];
    this.events = [];
    this.banner = null;

    this.cp = { us: 30, vc: 30 };
    if (this.map.startCP) for (const s in this.map.startCP) this.cp[s] += this.map.startCP[s];
    this.morale = { us: 100, vc: 100 };
    this.cool = { us: {}, vc: {} };
    this.stats = {
      us: { kills: 0, losses: 0, callins: 0, cpSpent: 0 },
      vc: { kills: 0, losses: 0, callins: 0, cpSpent: 0 },
    };
    this.hiddenLoss = [0, 0, 0];

    this.conceal = this.map.lanes.map(l =>
      (l.conceal || []).map(z => ({ x0: z[0], x1: z[1], burned: false }))
    );
    this.flags = this.map.flags.map((fx_, i) => ({
      lane: i, x: fx_ * WORLD_W, owner: this.map.preOwner || null, cap: 0, capSide: null,
    }));

    this.time = 0;
    this.timeLimit = this.mode === 'siege' ? this.map.siegeTime : this.mode === 'assault' ? this.map.assaultTime : 0;
    this.over = false;
    this.result = null;
    this.aiT = 2;
    this.duelAnnounced = 0;

    // settlements → destructible structures
    this.structures = [];
    for (const s of (this.map.settlements || [])) buildSettlement(this.map, s, this.structures);

    // squads + cover network
    this.squads = [];
    this.nades = [];
    this.smokes = [];
    this.genCovers();
    this._addWindows();

    // ambient life
    this.birdT = rand(4, 10);
    this.patrolT = rand(30, 60);
    const arng = seeded(this.map.seed + 99);
    this.smokeSrc = [];
    for (let i = 0; i < 2; i++) {
      this.smokeSrc.push({ x: (0.2 + arng() * 0.6) * WORLD_W, t: arng() * 0.6 });
    }

    if (this.map.prePlaced) {
      for (const p of this.map.prePlaced) {
        const x = p.x * WORLD_W;
        if (p.kind === 'unit') {
          this._makeSquad(p.side, p.key, p.lane, x, { hold: true });
        } else if (p.kind === 'hole') {
          this.holes.push(this._makeHole(p.lane, x));
        } else if (p.kind === 'trap') {
          this.traps.push({ side: p.side, lane: p.lane, x, type: p.type, discovered: false, defuse: 0 });
        }
      }
    }
  }

  emit(text, cls) {
    this.events.push({ text, cls: cls || 'sys' });
    if (this.events.length > 30) this.events.shift();
  }

  setBanner(text, danger) { this.banner = { text, danger: !!danger, fresh: true }; }

  /* ---------- helpers ---------- */
  inConceal(lane, x) {
    return this.conceal[lane].some(z => !z.burned && x >= z.x0 * WORLD_W && x <= z.x1 * WORLD_W);
  }

  isConcealed(u) {
    if (u.side !== 'vc' || !UNITS[u.key].conceal) return false;
    if (u.revealT > 0 || u.spotT > 0) return false;
    // a prepared jungle hide conceals on its own, brush zone or not
    const inHide = u.squad && u.squad.inCover && u.squad.cover && u.squad.cover.conceals;
    return inHide || this.inConceal(u.lane, u.x);
  }

  visibleToPlayer(u) {
    if (u.side === this.player) return true;
    return !this.isConcealed(u);
  }

  /* How much smoke sits on a point, 0..1. Screening builds as the cloud develops
   * and thins as it dies, so popping smoke is not instant cover. */
  smokeAt(lane, x) {
    let k = 0;
    for (const s of this.smokes) {
      if (s.lane !== lane) continue;
      const d = Math.abs(s.x - x);
      if (d > s.radius) continue;
      const grow = Math.min(1, s.age / SMOKE.build);
      const fade = Math.min(1, s.life / 2.5);
      k = Math.max(k, (1 - d / s.radius) * grow * fade);
    }
    return k;
  }

  canSee(side, t) {
    if (t.isHole) return t.revealT > 0 || t.discovered || side === 'vc';
    if (t.side === side) return true;
    // a target well inside smoke cannot be picked out
    if (this.smokeAt(t.lane, t.x) > 0.55) return false;
    return !this.isConcealed(t);
  }

  spawnX(side, lane) {
    if (side === 'vc') {
      const tn = this.tunnels.find(t => t.lane === lane);
      if (tn) return tn.x;
    }
    return BASE_X[side];
  }

  _makeUnit(side, key, lane, x) {
    const d = UNITS[key];
    return {
      side, key, lane, x,
      y: groundY(this.map, lane, x),
      dir: side === 'us' ? 1 : -1,
      hp: d.hp, maxHp: d.hp,
      sj: rand(0.94, 1.06), // slight build variation
      // gait identity: without these a squad walks in perfect lockstep, which is
      // the thing that reads as "robots" rather than men
      gaitOff: Math.random(), gaitK: rand(0.93, 1.07),
      // a hair of depth inside the lane, so men who share an x do not become one
      // flat stack of identical silhouettes
      yj: rand(-2.5, 2.5),
      burstN: 0, wounded: false,
      phase: Math.random() * 6, moving: false, pose: null,
      deadT: null, muzzleT: 0, fireT: rand(0, 0.5),
      hitT: 0, combatT: 0, shots: 0, gibbed: false, baked: false,
      suppressT: 0, slowT: 0, revealT: 0, spotT: 0, emergeT: 0,
      aiming: false, aimT: 0, aimTime: d.aim || 0, aimTarget: null,
      glintT: 0, hold: false, holdX: 0,
      sniperUnit: !!d.sniper,
      squad: null, slot: 0, cpShare: d.cost,
    };
  }

  /* ---------- squads ---------- */
  _makeSquad(side, skey, lane, x, opts = {}) {
    const sd = SQUADS[skey];
    const squad = {
      side, key: skey, lane, x,
      dir: side === 'us' ? 1 : -1,
      order: opts.hold ? 'hold' : 'advance',
      hold: !!opts.hold, holdX: opts.hold ? x : 0,
      pin: 0, pinned: false, underFireT: 0, quietT: 0,
      xp: 0, rank: 0,   // VETERAN CADRE starts the player's squads one rank up
      ...(typeof Perks !== 'undefined' && Perks.on(this, side, 'cadre')
        ? { xp: RANKS[1].at, rank: 1 } : {}),
      cover: null, coverTarget: null, inCover: false,
      emergeT: 0, men: [],
    };
    sd.comp.forEach((ukey, i) => {
      const m = this._makeUnit(side, ukey, lane, x - squad.dir * i * 13);
      m.squad = squad;
      m.slot = i;
      m.cpShare = sd.cost / sd.comp.length;
      m.hold = squad.hold; m.holdX = squad.holdX;
      squad.men.push(m);
      this.units.push(m);
    });
    this.squads.push(squad);
    return squad;
  }

  squadAlive(s) { return s.men.filter(m => m.deadT == null); }

  squadAnchor(s) {
    const alive = this.squadAlive(s);
    if (!alive.length) return s.x;
    return alive.reduce((a, m) => a + m.x, 0) / alive.length;
  }

  /* ---------- cover ---------- */
  /* Firing ports on village buildings.
   *
   * Troops could already hold a building, but with nothing marking where they
   * were they simply vanished into the wall — you could hear them shooting and
   * not see them. A window gives the squad a defined spot to stand, the renderer
   * something to cut into the wall behind them, and the position dies with the
   * structure it belongs to.
   */
  _addWindows() {
    const WINDOWED = { hooch: 1, longhouse: 1, stilt: 1, stall: 1 };
    for (const st of this.structures) {
      if (!WINDOWED[st.kind] || st.state === 2) continue;
      const spot = this.addCover(st.lane, st.x, 'window', true, 44);
      if (spot) {
        spot.structRef = st;
        // a stilt house is fought from its raised floor
        spot.lift = st.kind === 'stilt' ? 16 : 0;
      }
    }
  }

  genCovers() {
    this.covers = [[], [], []];
    const map = this.map;
    const rng = seeded(map.seed + 777);
    const biomeType = { grass: 'log', jungle: 'log', palm: 'dike', shattered: 'crater' }[map.trees] || 'log';

    // EMPLACEMENTS: class-locked strongpoints, destructible via their structure.
    // Every lane gets a sniper tower on its best ground and an MG nest, so each
    // lane has a strongpoint worth taking and holding.
    const erng = seeded(map.seed + 4242);
    const emplace = (lane, x, kind) => {
      const st = {
        lane, x, w: STRUCT_DEFS[kind].w, kind,
        hp: STRUCT_DEFS[kind].hp, maxHp: STRUCT_DEFS[kind].hp,
        state: 0, burnT: 0, fireHurt: 0, seed: Math.floor(erng() * 1e9),
      };
      this.structures.push(st);
      const spot = this.addCover(lane, x, kind === 'tower' ? 'towerpos' : 'nestpos', true);
      if (spot) spot.structRef = st;
    };
    for (let lane = 0; lane < 3; lane++) {
      // tower on the highest ground in the lane's forward half
      let bestX = WORLD_W * 0.5, bestE = -1;
      for (let x = WORLD_W * 0.24; x < WORLD_W * 0.78; x += 40) {
        const el = elevAt(map, lane, x) + erng() * 0.05;
        if (el > bestE) { bestE = el; bestX = x; }
      }
      emplace(lane, bestX, 'tower');
      // MG nest set back from the tower, covering the approach
      const nx = clamp(bestX - (0.10 + erng() * 0.08) * WORLD_W, WORLD_W * 0.12, WORLD_W * 0.88);
      if (Math.abs(nx - bestX) > 90) emplace(lane, nx, 'mgnest');
    }

    // TRENCH LINES astride every objective — the ground both sides must fight for
    for (let lane = 0; lane < 3; lane++) {
      const fx = this.flags[lane].x;
      this.addCover(lane, fx - 96, 'trench', true);
      this.addCover(lane, fx + 96, 'trench', true);
    }

    // VC JUNGLE HIDES: firing positions inside the brush. VC only, and they keep
    // their concealment while occupied, so the ambush doctrine has real estate.
    for (let lane = 0; lane < 3; lane++) {
      for (const z of this.conceal[lane]) {
        const x0 = z.x0 * WORLD_W, x1 = z.x1 * WORLD_W;
        const n = Math.max(1, Math.round((x1 - x0) / 260));
        for (let i = 0; i < n; i++) {
          const hx = x0 + (x1 - x0) * ((i + 0.5) / n) + (erng() - 0.5) * 60;
          this.addCover(lane, hx, 'hide', true);
        }
      }
    }

    // priority spots first — the scatter pass dedupes around them
    // dug positions on the garrison lines, matching the pre-placed defenders
    if (map.id === 'khesanh') {
      for (const p of map.prePlaced || []) {
        if (p.kind === 'unit') this.addCover(p.lane, p.x * WORLD_W, 'trench', true);
      }
    }
    if (map.id === 'hill937') {
      for (const p of map.prePlaced || []) {
        if (p.kind === 'unit') this.addCover(p.lane, p.x * WORLD_W, 'trench', true);
      }
    }
    // villages are fighting positions: low walls flank every settlement
    for (const s of (map.settlements || [])) {
      const cx = s.x * WORLD_W;
      this.addCover(s.lane, cx - 118, 'wall', true);
      this.addCover(s.lane, cx + 118, 'wall', true);
    }

    for (let lane = 0; lane < 3; lane++) {
      let x = WORLD_W * 0.16 + rng() * 120;
      while (x < WORLD_W * 0.86) {
        // don't bury cover in flags or settlements
        const nearFlag = Math.abs(x - this.flags[lane].x) < 70;
        const nearStruct = this.structures.some(st => st.lane === lane && Math.abs(st.x - x) < st.w);
        if (!nearFlag && !nearStruct) {
          const t = rng() < 0.25 ? 'sandbag' : biomeType;
          this.addCover(lane, x, t, true);
        }
        x += 150 + rng() * 105;
      }
    }
  }

  addCover(lane, x, type, static_ = false, minGap) {
    const defs = {
      log:     { w: 34, prot: 0.4 },
      sandbag: { w: 34, prot: 0.5 },
      dike:    { w: 38, prot: 0.45 },
      crater:  { w: 36, prot: 0.38 },
      trench:  { w: 62, prot: 0.6 },
      rubble:  { w: 40, prot: 0.5 },
      wall:    { w: 36, prot: 0.5 },
      towerpos:{ w: 30, prot: 0.45, classReq: 'sniper' },
      nestpos: { w: 40, prot: 0.6,  classReq: 'mg' },
      hide:    { w: 34, prot: 0.35, sideReq: 'vc', conceals: true },
      // a firing port cut in a village building — see genCovers
      window:  { w: 30, prot: 0.55 },
    };
    const d = defs[type];
    if (!d) return null;
    const lc = this.covers[lane];
    // Windows belong to a specific building, and village huts stand closer
    // together than the general 70px spacing rule allows — at that radius almost
    // every firing port was rejected and buildings had none.
    const gap = minGap != null ? minGap : 70;
    if (lc.some(c => Math.abs(c.x - x) < gap)) return null;
    if (!static_ && lc.filter(c => c.dyn).length >= 8) return null;
    const spot = {
      lane, x, w: type === 'rubble' ? Math.max(40, d.w) : d.w, type, prot: d.prot,
      occ: null, dyn: !static_, lift: 0,
      classReq: d.classReq || null, sideReq: d.sideReq || null, conceals: !!d.conceals,
    };
    lc.push(spot);
    return spot;
  }

  squadFitsCover(s, c) {
    if (c.sideReq && s.side !== c.sideReq) return false;
    if (!c.classReq) return true;
    return this.squadAlive(s).some(m =>
      c.classReq === 'sniper' ? m.sniperUnit : !!UNITS[m.key][c.classReq]);
  }

  freeCoverAhead(squad, maxDist) {
    // Troops under fire take the nearest cover FORWARD or right where they are.
    // They never stroll rearward to find a better hole — men who break contact
    // backwards across open ground get killed, and it read as cowardly wandering.
    let best = null, bd = 1e9;
    for (const c of this.covers[squad.lane]) {
      if (c.occ && c.occ !== squad) continue;
      if (!this.squadFitsCover(squad, c)) continue;
      const dx = (c.x - squad.x) * squad.dir;
      if (dx < -28 || dx > maxDist) continue;
      const score = dx >= 0 ? dx : -dx * 3;
      if (score < bd) { bd = score; best = c; }
    }
    return best;
  }

  _updateSquads(dt) {
    for (let i = this.squads.length - 1; i >= 0; i--) {
      const s = this.squads[i];
      const alive = this.squadAlive(s);
      if (!alive.length) {
        if (s.cover && s.cover.occ === s) s.cover.occ = null;
        this.squads.splice(i, 1);
        continue;
      }
      s.underFireT = Math.max(0, s.underFireT - dt);
      s.emergeT = Math.max(0, s.emergeT - dt);
      s.nadeCd = Math.max(0, (s.nadeCd || 0) - dt);
      s.suppCd = Math.max(0, (s.suppCd || 0) - dt);
      s.smokeCd = Math.max(0, (s.smokeCd || 0) - dt);
      s.suppFireT = Math.max(0, (s.suppFireT || 0) - dt);
      // pin: builds from incoming fire (added in _fire/_areaDamage), decays in lulls
      // veterans keep their heads when green troops would be pinned
      if (s.underFireT <= 0) s.pin = Math.max(0, s.pin - dt * 0.24 * (2 - RANKS[s.rank || 0].steady));
      s.pin = Math.min(1.4, s.pin);
      s.pinned = s.pinned ? s.pin > 0.28 : s.pin > 0.6;
      if (s.pinned) {
        // whole squad hugs the ground — reuses the prone/speed/accuracy penalties
        for (const m of alive) m.suppressT = Math.max(m.suppressT, 0.45);
      }

      if (s.emergeT > 0) continue;

      const engaged = alive.some(m => (m.combatT || 0) > 0 || m.aiming);
      const sp = Math.min(...alive.map(m => UNITS[m.key].speed)) *
        (alive.some(m => m.slowT > 0) ? 0.45 : 1);
      const xBefore = s.x;

      // Under effective fire: get into the nearest position forward. Never back.
      if (s.order === 'advance' && s.underFireT > 0 && !s.inCover && !s.coverTarget) {
        const c = this.freeCoverAhead(s, 150);
        if (c) { s.coverTarget = c; s.order = 'tocover'; }
      }
      // Bounding: troops moving up occupy the strongpoints they pass through
      // (trench, nest, tower, hide) instead of walking by them in the open.
      s.coverCd = Math.max(0, (s.coverCd || 0) - dt);
      if (s.order === 'advance' && !s.inCover && !s.coverTarget && !s.playerHeld &&
          s.coverCd <= 0) {
        const strong = { trench: 1, nestpos: 1, towerpos: 1, hide: 1, wall: 1,
                         rubble: 1, window: 1 };
        let pick = null, bd = 1e9;
        for (const c of this.covers[s.lane]) {
          if (!strong[c.type] || (c.occ && c.occ !== s)) continue;
          if (!this.squadFitsCover(s, c)) continue;
          const dx = (c.x - s.x) * s.dir;
          // Strictly AHEAD. A window starting behind the squad included the hole it
          // was standing in, so a squad that timed out of cover re-claimed the same
          // cover on the next tick, reset its timer, and never advanced again —
          // both sides parked outside weapon range and no shot was ever fired.
          if (dx < 60 || dx > 210) continue;
          if (dx < bd) { bd = dx; pick = c; }
        }
        if (pick) { s.coverTarget = pick; s.order = 'tocover'; }
      }

      if (s.order === 'tocover' && s.coverTarget) {
        if (s.coverTarget.occ && s.coverTarget.occ !== s) {
          s.coverTarget = null; s.order = 'advance';
        } else {
          const dx = s.coverTarget.x - s.x;
          if (Math.abs(dx) < 6) {
            s.cover = s.coverTarget; s.coverTarget = null;
            s.cover.occ = s; s.inCover = true; s.order = 'holdcover'; s.quietT = 0;
            s.ceding = false;
          } else {
            // rush the hole — crawl if pinned, sprint otherwise
            s.x += Math.sign(dx) * Math.min(Math.abs(dx), sp * (s.pinned ? 0.35 : 1.15) * dt);
          }
        }
      } else if (s.order === 'holdcover') {
        // a squad on ADVANCE orders pushes on once the shooting stops; only an
        // explicit player HOLD keeps it in the hole
        if (s.underFireT <= 0 && !engaged && !s.playerHeld) {
          s.quietT += dt;
          if (s.quietT > 2.6) {
            if (s.cover) s.cover.occ = null;
            s.cover = null; s.inCover = false; s.order = s.hold ? 'hold' : 'advance';
            // do not let it dive straight back into the hole it just left
            s.coverCd = 3.5;
          }
        } else s.quietT = 0;
      } else if (s.order === 'moveto') {
        const dx = s.moveToX - s.x;
        if (Math.abs(dx) < 6) {
          s.order = 'hold'; s.hold = true; s.holdX = s.x; s.ceding = false;
        } else if (!s.pinned) {
          s.x += Math.sign(dx) * Math.min(Math.abs(dx), sp * 1.05 * dt);
        }
      } else if (s.order === 'hold') {
        if ((s.x - s.holdX) * s.dir < 0 && !s.pinned && !engaged) {
          s.x += s.dir * sp * dt;
        } else if (!s.inCover) {
          // settle into a dug position on our hold point if one exists
          const c = this.covers[s.lane].find(c2 => !c2.occ && Math.abs(c2.x - s.holdX) < 50);
          if (c) { c.occ = s; s.cover = c; s.inCover = true; }
        }
      } else if (s.order === 'advance') {
        // Bounding: nobody walks upright into a lane that is being swept. A
        // squad only crosses open ground while a friendly is putting rounds
        // down, or while the enemy is still out of effective range.
        let hostileFire = 0;
        for (const o of this.squads) {
          if (o.side === s.side || o.lane !== s.lane) continue;
          if (!this.squadAlive(o).length) continue;
          const d = Math.abs(this.squadAnchor(o) - s.x);
          if (d < 340 && o.men.some(m => (m.combatT || 0) > 0)) hostileFire++;
        }
        const covering = this.squads.some(o =>
          o !== s && o.side === s.side && o.lane === s.lane &&
          this.squadAlive(o).length && o.men.some(m => (m.combatT || 0) > 0));
        // screened by our own smoke, a squad can cross ground it otherwise would not
        const screened = this.smokeAt(s.lane, s.x) > 0.35 ||
          this.smokeAt(s.lane, s.x + s.dir * 70) > 0.35;
        const mayMove = hostileFire === 0 || covering || s.inCover || screened;
        if (!s.pinned && !engaged && this._squadPathClear(s) && mayMove) {
          s.x += s.dir * sp * dt;
        }
      }
      // hard-sync anchor if men drifted (breakthrough removal etc.)
      if (Math.abs(this.squadAnchor(s) - s.x) > 90) s.x = this.squadAnchor(s);

      // GROUND IS NEVER GIVEN UP by accident. Losing the point man used to drag
      // the squad's anchor rearward, which read as troops wandering backwards
      // under fire. Only an explicit FALL BACK or MOVE order may cede ground.
      const ceding = !!s.ceding;
      if (s.front === undefined) s.front = s.x;
      if (ceding) {
        s.front = s.x;
      } else {
        if ((s.x - s.front) * s.dir > 0) s.front = s.x;
        else if ((s.front - s.x) * s.dir > 16) s.x = s.front - s.dir * 16;
      }
      s._advancing = Math.abs(s.x - xBefore) > 0.01;

      // stance state machine — ONE owner, with commitment so nobody yo-yos.
      // A man stays prone ≥2.4s and standing ≥1.1s before he may switch.
      let nearFoe = 1e9;
      for (const f of this.units) {
        if (f.side === s.side || f.lane !== s.lane || f.deadT != null) continue;
        nearFoe = Math.min(nearFoe, Math.abs(f.x - s.x));
      }
      for (let mi = 0; mi < alive.length; mi++) {
        const m = alive[mi];
        if (m.sniperUnit || (m.nadeT || 0) > 0) continue;
        if (UNITS[m.key].vehicle) { m.stance = 'stand'; m.pose = null; continue; }
        m.stanceT = (m.stanceT || 0) + dt;
        if (!m.stance) m.stance = 'stand';
        let want = m.stance;
        if (m.moving || s._advancing) want = 'stand';
        else if (nearFoe < 150) want = 'stand';          // point blank: stay on your feet
        else if (s.inCover && (engaged || s.underFireT > 0)) want = 'prone'; // gun on the parapet
        else if (s.pinned) want = 'prone';
        else if ((m.combatT || 0) > 0 && mi < 2) want = 'prone'; // front rank drops at range
        else if (s.underFireT <= 0 && (m.combatT || 0) <= 0 && m.stanceT > 3) want = 'stand';
        const lock = m.stance === 'prone' ? 2.4 : 1.1;
        if (want !== m.stance && (m.stanceT >= lock || m.moving)) {
          m.stance = want;
          m.stanceT = 0;
          if (!m.moving) { // play the drop/rise transition frames
            m.transDir = want === 'prone' ? 1 : -1;
            m.transT = 0.45;
          }
        }
        m.pose = m.stance === 'prone' && !m.moving ? 'prone' : null;
      }
    }
  }

  /* ---------- player/AI squad orders ---------- */
  orderSquad(s, order, arg) {
    if (!s || !this.squadAlive(s).length) return false;
    const release = () => {
      if (s.cover && s.cover.occ === s) s.cover.occ = null;
      s.cover = null; s.inCover = false; s.coverTarget = null;
    };
    if (order === 'advance') {
      release();
      s.ceding = false;
      s.hold = false; s.playerHeld = false; s.order = 'advance';
    } else if (order === 'hold') {
      release();
      s.ceding = false;
      s.hold = true; s.holdX = s.x; s.playerHeld = true; s.order = 'hold';
    } else if (order === 'fallback') {
      release();
      s.ceding = true;   // the one order allowed to give ground
      // scramble back to the previous cover, or just give ground
      let best = null, bd = 1e9;
      for (const c of this.covers[s.lane]) {
        if (c.occ && c.occ !== s) continue;
        const dx = (s.x - c.x) * s.dir; // behind us
        if (dx < 20 || dx > 420) continue;
        if (dx < bd) { bd = dx; best = c; }
      }
      s.playerHeld = true;
      if (best) { s.coverTarget = best; s.order = 'tocover'; }
      else { s.moveToX = s.x - s.dir * 130; s.order = 'moveto'; }
    } else if (order === 'moveto') {
      release();
      s.ceding = true;   // the player picked the spot, forward or back
      s.playerHeld = true;
      // snap to a free cover spot if the click is on one (and the class fits)
      const c = this.covers[s.lane].find(c2 => (!c2.occ || c2.occ === s) &&
        this.squadFitsCover(s, c2) && Math.abs(c2.x - arg) < c2.w);
      if (c) { s.coverTarget = c; s.order = 'tocover'; }
      else { s.moveToX = clamp(arg, 30, WORLD_W - 30); s.order = 'moveto'; }
    } else if (order === 'grenade') {
      return this._squadGrenade(s);
    }
    if (order === 'smoke') {
      return this._squadSmoke(s);
    } else if (order === 'suppress') {
      return this._squadSuppress(s);
    }
    return true;
  }

  /* Pop smoke between the squad and whatever is shooting at it. Thrown short of
   * the enemy, not onto them — the point is a screen to move behind. */
  _squadSmoke(s) {
    if ((s.smokeCd || 0) > 0) return false;
    const alive = this.squadAlive(s);
    if (!alive.length) return false;
    const anchor = this.squadAnchor(s);
    s.smokeCd = SMOKE.cd;
    const m = alive[0];
    m.nadeT = 0.75;
    m.nadeDur = m.nadeT;
    m.nadeThrown = false;
    m.nadeSmoke = true;
    m.nadeTarget = anchor + s.dir * SMOKE.range * 0.62;
    if (s.side === this.player) this.emit(`SMOKE OUT — LANE ${s.lane + 1}`, s.side);
    return true;
  }

  _squadGrenade(s) {
    const sd = SQUADS[s.key];
    if (!sd.grenades || (s.nadeCd || 0) > 0) return false;
    const alive = this.squadAlive(s);
    // nearest enemy squad anchor in throw range
    let target = null, bd = 1e9;
    for (const o of this.squads) {
      if (o.side === s.side || o.lane !== s.lane) continue;
      const oa = this.squadAnchor(o);
      if (!this.squadAlive(o).length) continue;
      const d = Math.abs(oa - s.x);
      if (d < GRENADE.range && d < bd) { bd = d; target = oa; }
    }
    if (target == null) return false;
    s.nadeCd = GRENADE.cd;
    let n = 0;
    for (const m of alive) {
      if (n >= 3 || m.sniperUnit) continue;
      n++;
      m.nadeT = 0.9 + n * 0.25; // staggered wind-ups
      m.nadeDur = m.nadeT;
      m.nadeThrown = false;
      m.nadeTarget = target + rand(-18, 18);
    }
    if (s.side === this.player) this.emit(`GRENADES OUT — LANE ${s.lane + 1}`, s.side);
    return n > 0;
  }

  _squadSuppress(s) {
    const sd = SQUADS[s.key];
    if (!sd.suppressive || (s.suppCd || 0) > 0) return false;
    s.suppCd = 20;
    s.suppFireT = 5;
    if (s.side === this.player) this.emit(`SUPPRESSIVE FIRE — LANE ${s.lane + 1}`, s.side);
    return true;
  }

  _updateSmokes(dt) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.age += dt;
      s.life -= dt;
      // a cloud drifts and spreads as it dies
      s.radius += dt * 2.2;
      if (s.life <= 0) this.smokes.splice(i, 1);
    }
  }

  _updateNades(dt) {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      if (!n.landed) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        n.vy += 620 * dt;
        n.spin += dt * 14;
        const gy = groundY(this.map, n.lane, n.x);
        if (n.y >= gy) {
          n.y = gy; n.landed = true;
          n.vx = 0;
        }
      } else {
        n.fuse -= dt;
        if (n.fuse <= 0) {
          this.nades.splice(i, 1);
          this.fx.explosion(n.x, n.y - 2, 40, { shake: 3 });
          Sound.explosion(0.6, n.x);
          this.fx.addDecal(n.lane, n.x, 'crater', 7);
          if (n.smoke) {
            this.smokes.push({ lane: n.lane, x: n.x, radius: SMOKE.radius,
              life: SMOKE.life, age: 0, side: n.side });
            this.fx.smokePuff(n.x, n.y);
          } else {
            this._areaDamage(n.lane, n.x, GRENADE.blast, GRENADE.dmg, { side: n.side }, n.side);
          }
        }
      }
    }
  }

  _squadPathClear(s) {
    for (const o of this.squads) {
      if (o === s || o.side !== s.side || o.lane !== s.lane) continue;
      if (!this.squadAlive(o).length) continue;
      const gap = (o.x - s.x) * s.dir;
      if (gap > 0 && gap < 44) return false;
    }
    return true;
  }

  _makeHole(lane, x) {
    return {
      isHole: true, side: 'vc', lane, x,
      y: groundY(this.map, lane, x) - 5,
      hp: 60, maxHp: 60, cd: rand(1, 2.5), revealT: 0, discovered: false,
      dirToTarget: -1, deadT: null, defuse: 0,
    };
  }

  /* ---------- spawning & call-ins ---------- */
  trySpawn(side, key, lane, opts = {}) {
    const d = SQUADS[key];
    if (!d || d.side !== side || this.over) return false;
    if (!opts.free) {
      if ((this.cool[side][key] || 0) > 0) return false;
      if (this.cp[side] < d.cost) return false;
      this.cp[side] -= d.cost;
      this.stats[side].cpSpent += d.cost;
      this.cool[side][key] = d.cd;
    }
    const x = opts.x != null ? opts.x : this.spawnX(side, lane);
    const squad = this._makeSquad(side, key, lane, x, { hold: !!opts.hold });
    if (side === 'vc' && opts.x == null && this.tunnels.some(t => t.lane === lane)) {
      squad.emergeT = 0.9;
      squad.men.forEach((m, i) => { m.emergeT = 0.5 + i * 0.22; });
      this.fx.smokePuff(x, squad.men[0].y);
    }
    return true;
  }

  callinValid(side, key, lane, x) {
    const lo = WORLD_W * 0.06, hi = WORLD_W * 0.94;
    if (x < lo || x > hi) return false;
    if (key === 'tunnel') {
      if (x < WORLD_W * 0.4) return false;
      if (this.tunnels.some(t => t.lane === lane)) return false;
    }
    if ((key === 'punji' || key === 'mine') && this.traps.filter(t => t.side === side).length >= MAX_TRAPS) return false;
    return true;
  }

  tryCallin(side, key, lane, x) {
    const d = CALLINS[key];
    if (!d || d.side !== side || this.over) return false;
    const artyK = (typeof Perks !== 'undefined' && Perks.on(this, side, 'arty')) ? 0.75 : 1;
    const cost = d.cost * artyK;
    if ((this.cool[side][key] || 0) > 0 || this.cp[side] < cost) return false;
    if (d.target === 'point' && !this.callinValid(side, key, lane, x)) return false;

    this.cp[side] -= cost;
    this.stats[side].cpSpent += cost;
    this.stats[side].callins++;
    this.cool[side][key] = d.cd;
    const isPlayer = side === this.player;

    switch (key) {
      case 'arty': {
        const impacts = [];
        for (let i = 0; i < 6; i++) {
          impacts.push({ t: 2.6 + i * 0.38 + rand(0, 0.2), x: clamp(x + rand(-115, 115), 20, WORLD_W - 20), dmg: 42, r: 78, done: false });
        }
        this.strikes.push({ type: 'arty', side, lane, x, age: 0, dur: 6, impacts });
        Sound.radio(); Sound.shellWhistle(1.8);
        this.emit(`FIRE MISSION LANE ${lane + 1} — SHOT, OVER`, side);
        break;
      }
      case 'napalm':
        this.strikes.push({ type: 'napalm', side, lane, x, age: 0, dur: 5, dropT: 2.2, dropped: false });
        Sound.radio();
        setTimeout(() => Sound.jet(), 0);
        this.emit(`AIR STRIKE INBOUND — LANE ${lane + 1}`, side);
        break;
      case 'medevac':
        this.strikes.push({ type: 'medevac', side, age: 0, dur: 5, healed: false });
        Sound.radio(); Sound.chopper(4.5);
        this.emit('DUSTOFF INBOUND — GOLDEN HOUR', side);
        break;
      case 'aircav': {
        this.strikes.push({ type: 'aircav', side, lane, x, age: 0, dur: 6.2, dropped: false });
        Sound.radio(); Sound.chopper(5.5);
        this.emit(`AIR CAV INSERTION — LANE ${lane + 1}`, side);
        break;
      }
      case 'arclight': {
        const impacts = [];
        for (let i = 0; i < 12; i++) {
          impacts.push({ t: 3.5 + i * 0.22, x: clamp(x - 330 + i * 60 + rand(-20, 20), 20, WORLD_W - 20), dmg: 60, r: 96, done: false });
        }
        this.strikes.push({ type: 'arclight', side, lane, x, age: 0, dur: 8, impacts });
        Sound.radio(); Sound.bomberRumble(5);
        this.setBanner('ARC LIGHT INBOUND', true);
        this.emit('B-52 STRIKE CONFIRMED — DANGER CLOSE', side);
        break;
      }
      case 'punji':
        this.traps.push({ side, lane, x, type: 'punji', discovered: false, defuse: 0 });
        Sound.shovel(x);
        if (isPlayer) this.emit(`PUNJI STAKES SET — LANE ${lane + 1}`, side);
        break;
      case 'mine':
        this.traps.push({ side, lane, x, type: 'mine', discovered: false, defuse: 0 });
        Sound.shovel(x);
        if (isPlayer) this.emit(`TRIPWIRE SET — LANE ${lane + 1}`, side);
        break;
      case 'spiderhole':
        this.holes.push(this._makeHole(lane, x));
        Sound.shovel(x);
        if (isPlayer) this.emit(`MARKSMAN BURIED — LANE ${lane + 1}`, side);
        break;
      case 'tunnel':
        this.tunnels.push({ side, lane, x, discovered: false, defuse: 0, hp: 90 });
        Sound.shovel(x);
        if (isPlayer) this.emit(`TUNNEL EXIT DUG — LANE ${lane + 1}`, side);
        this.fx.smokePuff(x, groundY(this.map, lane, x));
        break;
    }
    return true;
  }

  /* ---------- main update ---------- */
  update(dt) {
    if (this.over) { this.fx.update(dt); return; }
    this.time += dt;

    for (const side of ['us', 'vc']) {
      let inc = INCOME[side];
      inc += this.flags.filter(f => f.owner === side).length * FLAG_INCOME;
      if (this.map.incomeMult && this.map.incomeMult[side]) inc *= this.map.incomeMult[side];
      inc *= side === this.player ? this.diff.playerIncome : this.diff.aiIncome;
      this.cp[side] = Math.min(CP_CAP, this.cp[side] + inc * dt);
      const cools = this.cool[side];
      for (const k in cools) cools[k] = Math.max(0, cools[k] - dt);
    }

    this._spottingPass(dt);
    this._updateSquads(dt);
    this._updateUnits(dt);
    this._updateNades(dt);
    this._updateSmokes(dt);
    this._updateHoles(dt);
    this._updateStrikes(dt);
    this._updateFires(dt);
    this._updateStructures(dt);
    this._ambient(dt);
    this._updateFlags(dt);
    this._aiUpdate(dt);
    this.fx.update(dt);

    // flag pressure on morale
    const net = this.flags.filter(f => f.owner === 'us').length - this.flags.filter(f => f.owner === 'vc').length;
    if (net > 0) this.morale.vc -= net * FLAG_DRAIN * dt;
    else if (net < 0) this.morale.us -= -net * FLAG_DRAIN * dt;

    this._checkEnd();
  }

  _checkEnd() {
    this.morale.us = clamp(this.morale.us, 0, 100);
    this.morale.vc = clamp(this.morale.vc, 0, 100);
    let winner = null, reason = '';
    if (this.morale.us <= 0) { winner = 'vc'; reason = 'US morale broken — the operation is called off.'; }
    else if (this.morale.vc <= 0) { winner = 'us'; reason = 'VC/NVA morale broken — they melt back into the jungle.'; }
    else if (this.mode === 'assault' && this.flags.every(f => f.owner === 'us')) {
      winner = 'us'; reason = 'All objectives taken. The crest is yours — at a price.';
    } else if (this.timeLimit && this.time >= this.timeLimit) {
      if (this.mode === 'siege') { winner = 'us'; reason = 'The weather lifted and the relief column arrived. The siege is broken.'; }
      else { winner = 'vc'; reason = 'The assault is called off. The hill remains in enemy hands.'; }
    }
    if (winner) {
      this.over = true;
      this.result = { winner, reason };
      Sound.bell(winner === this.player);
    }
  }

  /* ---------- spotting / discovery ---------- */
  _spottingPass(dt) {
    const penalty = this.map.detectPenalty || 1;
    for (const u of this.units) {
      if (u.side !== 'us' || u.deadT != null) continue;
      let base = (UNITS[u.key].detect || 70) * penalty;
      if (typeof Perks !== 'undefined' && Perks.on(this, u.side, 'scouts')) base *= 1.25;
      const eng = UNITS[u.key].engineer;
      const isRecon = !!UNITS[u.key].detect;
      for (const v of this.units) {
        if (v.side !== 'vc' || v.deadT != null || v.lane !== u.lane) continue;
        if (!this.isConcealed(v)) continue;
        const elevAdv = elevAt(this.map, u.lane, u.x) - elevAt(this.map, v.lane, v.x);
        const r = base * (1 + 0.4 * Math.max(0, elevAdv));
        if (Math.abs(v.x - u.x) < r) {
          if (v.spotT <= 0) {
            this.fx.floater(v.x, v.y - 44, 'SPOTTED', '#ffd98a');
            if (this.player === 'us') this.emit(`CONTACT — LANE ${v.lane + 1}`, 'us');
          }
          v.spotT = 5;
        }
      }
      const dr = isRecon ? 150 : eng ? 100 : 0;
      if (dr) {
        for (const t of this.traps) {
          if (t.lane === u.lane && !t.discovered && Math.abs(t.x - u.x) < dr) {
            t.discovered = true;
            this.fx.floater(t.x, groundY(this.map, t.lane, t.x) - 20, 'TRAP MARKED', '#ffd98a');
          }
        }
        for (const h of this.holes) {
          if (h.lane === u.lane && !h.discovered && Math.abs(h.x - u.x) < dr) {
            h.discovered = true;
            this.fx.floater(h.x, h.y - 20, 'SPIDER HOLE', '#ffd98a');
          }
        }
        for (const tn of this.tunnels) {
          if (tn.lane === u.lane && !tn.discovered && Math.abs(tn.x - u.x) < dr) {
            tn.discovered = true;
            this.fx.floater(tn.x, groundY(this.map, tn.lane, tn.x) - 20, 'TUNNEL FOUND', '#ffd98a');
          }
        }
      }
    }
  }

  /* ---------- units ---------- */
  _targetsFor(side, lane) {
    const foes = [];
    for (const u of this.units) {
      if (u.side !== side && u.deadT == null && u.lane === lane && u.emergeT <= 0) foes.push(u);
    }
    if (side === 'us') {
      for (const h of this.holes) {
        if (h.lane === lane && (h.revealT > 0 || h.discovered)) foes.push(h);
      }
    }
    return foes;
  }

  _acquire(u) {
    const d = UNITS[u.key];
    const foes = this._targetsFor(u.side, u.lane);
    const eu = elevAt(this.map, u.lane, u.x);
    let best = null, bestScore = -1e9;
    for (const f of foes) {
      if (!this.canSee(u.side, f)) continue;
      const dx = (f.x - u.x) * u.dir;
      if (dx < -40) continue;
      const ef = elevAt(this.map, f.lane, f.x);
      let range = d.range * (1 + 0.3 * clamp(eu - ef, -0.9, 0.9));
      // a sniper in a tower sees forever
      if (u.sniperUnit && u.squad && u.squad.inCover && u.squad.cover &&
          u.squad.cover.type === 'towerpos') range *= 1.3;
      const dist = Math.abs(f.x - u.x);
      if (dist > range) continue;
      let score = -dist;
      // riflemen distribute fire across a bunched group instead of queueing
      // on the point man — every acquire re-rolls, so bursts walk the line
      if (!d.sniper) score += rand(0, 150);
      if (d.sniper) {
        if (f.sniperUnit) score += 600;
        else if (!f.isHole && UNITS[f.key] && UNITS[f.key].mg) score += 300;
        if (f.isHole) score += 200;
      }
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  _fire(u, t) {
    const d = UNITS[u.key];
    const distT = Math.abs(t.x - u.x);
    const closeQuarters = distT < d.range * 0.45;
    // burst cadence: quick rounds inside a burst, a long breath between bursts —
    // shorter breaths when the enemy is right on top of you
    const suppressive = d.mg && u.squad && (u.squad.suppFireT || 0) > 0;
    if (suppressive) {
      u.fireT = 1 / d.rof; // the gun talks without pause
    } else if (d.burst) {
      if (!u.burstN || u.burstN <= 0) u.burstN = randi(d.burst[0], d.burst[1]);
      u.burstN--;
      const ammo = (typeof Perks !== 'undefined' && Perks.on(this, u.side, 'ammo')) ? 0.78 : 1;
      u.fireT = u.burstN > 0 ? 1 / d.rof
        : rand(d.pause[0], d.pause[1]) * (closeQuarters ? 0.7 : 1) * ammo;
    } else {
      u.fireT = 1 / d.rof;
    }
    u.muzzleT = 0.07;
    u.combatT = 0.9;
    u.shots++;
    const scale = LANE_DEPTH[u.lane];
    const mp = muzzlePoint(u);
    const mx = mp.x, my = mp.y;
    this.fx.muzzle(mx, my, u.dir, scale, !!d.mg);
    this.fx.casing(u.x + u.dir * 2 * scale, my + 3, u.dir, scale);
    if (u.shots % 4 === 0) this.fx.addDecal(u.lane, u.x - u.dir * 3 + rand(-4, 4), 'casing', 1);
    if (d.at) Sound.rocket(mx);
    else Sound.shot(d.mg ? 'mg' : u.side === 'us' ? 'm16' : 'ak', mx);
    if (Math.random() < 0.08) this.tryBirds(u.x);

    const wasHidden = this.isConcealed(u);
    if (u.side === 'vc' && UNITS[u.key].conceal) u.revealT = 6.0;

    const suppressed = u.suppressT > 0;
    // point-blank volleys land far more often — close fights resolve fast
    const closeK = clamp(1 - distT / (d.range || 1), 0, 1);
    /* Cover shields you from fire ACROSS GROUND, not from a man in your face.
     *
     * Measured: 87% of all shots are taken at a target in cover, average
     * protection 0.56 — so a flat multiplier was not a situational advantage, it
     * was a permanent halving of everyone's damage, and firefights took ~35
     * rounds per casualty. Scaling it by range keeps a dug-in squad genuinely
     * hard to shift at distance while letting a close assault break the position,
     * which is how the fight is supposed to resolve. */
    let rawProt = (!t.isHole && t.squad && t.squad.inCover && t.squad.cover)
      ? t.squad.cover.prot : 0;
    if (rawProt && typeof Perks !== 'undefined' && Perks.on(this, t.side, 'entrench')) {
      rawProt = Math.min(0.82, rawProt * 1.28);
    }
    const coverMult = 1 - rawProt * (0.34 + 0.46 * (1 - closeK));
    const vet = u.squad ? RANKS[u.squad.rank || 0].acc : 1;
    const hit = Math.random() <
      d.acc * vet * (1 + 0.7 * closeK) * (suppressed ? 0.7 : 1) * coverMult;

    if (Math.random() < 0.3) this.fx.smokePuffSmall(mx, my);
    if (hit) {
      const ty = t.y - (t.isHole ? 0 : 14 * LANE_DEPTH[t.lane]);
      this.fx.tracer(mx, my, t.x + rand(-4, 4), ty + rand(-4, 4),
        u.side === 'us' ? '#ffd98a' : '#ffb08a', 'spark');
      const eu = elevAt(this.map, u.lane, u.x), ef = elevAt(this.map, t.lane, t.x);
      let dmg = d.dmg * (1 + 0.35 * clamp(eu - ef, -0.9, 0.9));
      if (wasHidden && d.ambush && d.ambush > 1) {
        dmg *= d.ambush;
        this.fx.floater(u.x, u.y - 46, 'AMBUSH!', '#e08767', true);
      }
      if (d.suppress && !t.isHole) t.suppressT = 0.8;
      if (!t.isHole && t.squad) {
        const nest = u.squad && u.squad.inCover && u.squad.cover && u.squad.cover.type === 'nestpos';
        t.squad.pin += (d.suppress ? 0.13 : 0.06) * (suppressive ? 2 : 1) * (nest ? 1.5 : 1) *
          RANKS[t.squad.rank || 0].steady;
        t.squad.underFireT = 1.4;
      }
      if (d.at) {
        /* A rocket does not "hit a man" — it detonates. Area damage, flagged
         * heavy so armour is no defence, which is the whole reason the weapon
         * exists. */
        this.fx.explosion(t.x, t.y - 10, 46, { shake: 6 });
        this._areaDamage(u.lane, t.x, d.blast || 44, dmg, { side: u.side }, u.side);
        this.fx.punch(0.06, u.dir, -0.2);
      } else {
        this._damage(t, dmg, u);
        if (!t.isHole) this.fx.blood(t.x, t.y, LANE_DEPTH[t.lane]);
      }
    } else {
      // rounds go long or drop short — visibly
      const dist = (t.x - u.x) * u.dir;
      const missAt = Math.max(30, dist + rand(-60, 150));
      const ex = u.x + u.dir * missAt;
      const short = missAt < dist - 6;
      const gy = groundY(this.map, u.lane, ex);
      const ey = short ? gy : gy - rand(2, 26 * scale);
      this.fx.tracer(mx, my, ex + rand(-4, 4), ey,
        u.side === 'us' ? '#ffd98a' : '#ffb08a',
        (short || Math.random() < 0.45) ? 'dirt' : null);
      // impact debris by what is actually there: timber splinters off a building,
      // sparks off an emplacement, water out of a paddy, dirt everywhere else
      if (short || Math.random() < 0.5) {
        const hitSt = this.structures.find(st2 => st2.lane === u.lane &&
          st2.state !== 2 && Math.abs(st2.x - ex) < st2.w * 0.7);
        if (hitSt) {
          if (hitSt.kind === 'tower' || hitSt.kind === 'mgnest') {
            this.fx.sparks(ex, ey);
            if (Math.random() < 0.5) Sound.ricochet(ex);
          } else {
            this.fx.splinters(ex, ey);
            if (Math.random() < 0.2) Sound.ricochet(ex);
          }
        } else if (this.map.trees === 'palm' && Math.random() < 0.35) {
          this.fx.waterPlume(ex, gy);
        } else {
          this.fx.dirtKick(ex, gy);
        }
      }
      // cracking rounds keep heads down even when they miss
      if (!t.isHole && Math.abs(ex - t.x) < 46 && Math.random() < 0.6) {
        t.suppressT = Math.max(t.suppressT || 0, rand(0.4, 0.9));
        if (t.squad) {
          t.squad.pin += (d.suppress ? 0.1 : 0.045) * (suppressive ? 2 : 1) *
            RANKS[t.squad.rank || 0].steady;
          t.squad.underFireT = 1.2;
        }
      }
    }
  }

  _damage(t, dmg, killer, opts = {}) {
    // armour turns rifle fire aside; a satchel, mine or shell goes straight through
    const arm = !t.isHole && UNITS[t.key] && UNITS[t.key].armour;
    if (arm) {
      // Rifle fire is nearly useless against a hull; a shaped charge is the
      // opposite. Five satchels to kill made the APC a wall rather than a
      // decision — two is the trade that keeps sappers relevant.
      dmg *= opts.heavy ? 2.4 : (1 - arm) * 0.42;
    }
    t.hp -= dmg;
    if (t.hp <= 0 && t.deadT == null) this._kill(t, killer, opts);
    else if (t.deadT == null && !t.isHole) t.hitT = Math.max(t.hitT || 0, 0.16);
  }

  _kill(t, killer, opts = {}) {
    if (t.isHole) {
      t.deadT = 0;
      this.fx.explosion(t.x, t.y, 26, { shake: 2 });
      this.holes.splice(this.holes.indexOf(t), 1);
      if (killer) this.stats[killer.side || killer].kills++;
      this.emit('SPIDER HOLE DESTROYED', 'us');
      return;
    }
    t.deadT = 0;
    t.aiming = false;
    if (UNITS[t.key] && UNITS[t.key].vehicle) {
      // a knocked-out track brews up; no corpse, no blood
      t.baked = true;
      this.fx.explosion(t.x, t.y - 14, 62, { shake: 9 });
      this.fx.punch(0.1, killer && killer.x != null ? Math.sign(t.x - killer.x) : 0, -0.2);
      this.emit(`APC KNOCKED OUT — LANE ${t.lane + 1}`, t.side === this.player ? 'vc' : 'us');
    }
    /* A moment of near-freeze so a kill lands. Only when the player can actually
     * see it — stopping the clock for something off-screen is just a stutter. */
    if (Camera.sees(t.x, 80)) {
      const dx = killer && killer.x != null ? Math.sign(t.x - killer.x) : 0;
      this.fx.punch(opts.gib ? 0.085 : 0.05, dx, -0.25);
      this.fx.shake = Math.min(14, this.fx.shake + (opts.gib ? 5 : 2));
    }
    if (opts.gib) {
      t.gibbed = true;
      t.baked = true;
      const scale = LANE_DEPTH[t.lane];
      this.fx.gibs(t.x, t.y, scale, t.y + 2);
      this.fx.bakeCorpse(t, { gibbed: true });
    } else if (Math.random() < 0.3) {
      t.wounded = true; // drags himself a few meters before he stops
    }
    const medK = (typeof Perks !== 'undefined' && Perks.on(this, t.side, 'medics')) ? 0.72 : 1;
    this.morale[t.side] -= (t.cpShare || UNITS[t.key].cost) * MORALE_LOSS[t.side] * medK;
    this.stats[t.side].losses++;
    const ks = killer ? (killer.side || killer) : other(t.side);
    if (ks !== t.side) this.stats[ks].kills++;
    // the squad that did it gets the credit
    if (killer && killer.squad && ks !== t.side) {
      const sq = killer.squad;
      sq.xp = (sq.xp || 0) + 1;
      const nr = rankOf(sq.xp);
      if (nr > (sq.rank || 0)) {
        sq.rank = nr;
        this.fx.floater(this.squadAnchor(sq), groundY(this.map, sq.lane, sq.x) - 62,
          RANKS[nr].name, sq.side === 'us' ? '#b5c98f' : '#e08767', true);
        if (sq.side === this.player) this.emit(`SQUAD PROMOTED — ${RANKS[nr].name}`, 'us');
      }
    }
    if (killer && killer.key && (this.isConcealed(killer) || killer.isHole)) {
      this.hiddenLoss[t.lane]++;
    }
    if (killer && killer.isHole) this.hiddenLoss[t.lane]++;
  }

  _updateUnits(dt) {
    const map = this.map;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.deadT != null) {
        u.deadT += dt;
        if (u.wounded && u.deadT > 0.25 && u.deadT < 2.3) {
          u.x -= u.dir * 7 * dt; // crawls back the way he came
          u.y = groundY(map, u.lane, u.x);
          if (Math.random() < dt * 2.4) this.fx.addDecal(u.lane, u.x + rand(-2, 2), 'drip', 1);
        }
        const bakeAt = u.wounded ? 2.4 : 0.9;
        if (u.deadT > bakeAt && !u.baked) {
          u.baked = true;
          this.fx.bakeCorpse(u, { gibbed: u.gibbed });
        }
        if (u.deadT > (u.gibbed ? 0.05 : u.wounded ? 3.0 : 1.5)) this.units.splice(i, 1);
        continue;
      }
      u.y = groundY(map, u.lane, u.x);
      u.muzzleT = Math.max(0, u.muzzleT - dt);
      u.suppressT = Math.max(0, u.suppressT - dt);
      u.slowT = Math.max(0, u.slowT - dt);
      u.revealT = Math.max(0, u.revealT - dt);
      u.spotT = Math.max(0, u.spotT - dt);
      u.hitT = Math.max(0, (u.hitT || 0) - dt);
      u.combatT = Math.max(0, (u.combatT || 0) - dt);
      u.transT = Math.max(0, (u.transT || 0) - dt);
      if (u.emergeT > 0) { u.emergeT -= dt; u.moving = false; continue; }

      const d = UNITS[u.key];

      // engineer: defuse enemy works ahead
      if (d.engineer) {
        const target = this._engineerTarget(u);
        if (target) {
          u.moving = false;
          target.obj.defuse += dt;
          if (Math.random() < dt * 6) this.fx.dirtKick(target.obj.x, groundY(map, u.lane, target.obj.x));
          if (target.obj.defuse >= target.need) {
            this._removeWork(target.obj);
            this.fx.floater(target.obj.x, u.y - 30, 'CLEARED', '#b5c98f');
            Sound.shovel(target.obj.x);
            this.emit(`ENGINEERS CLEARED ${target.kind.toUpperCase()} — LANE ${u.lane + 1}`, 'us');
          }
          continue;
        }
      }

      // sapper: charge and detonate
      if (d.sapper) {
        const foes = this._targetsFor(u.side, u.lane);
        let nearest = null, nd = 1e9;
        for (const f of foes) {
          const dist = Math.abs(f.x - u.x);
          if (dist < nd) { nd = dist; nearest = f; }
        }
        if (nearest && nd < 38) {
          this.fx.explosion(u.x, u.y - 6, 55, { shake: 5 });
          Sound.explosion(0.9, u.x);
          this._areaDamage(u.lane, u.x, 100, 65, u, 'vc');
          this.fx.addDecal(u.lane, u.x, 'crater', 16);
          this._kill(u, null, { gib: true });
          this.stats.vc.losses--; // died by own hand, don't double count against morale twice
          this.morale.vc += (u.cpShare || UNITS[u.key].cost) * MORALE_LOSS.vc * 0.5; // sacrifice expected, partial refund
          this.stats.vc.losses++;
          continue;
        }
      }

      // grenade wind-up and release
      if ((u.nadeT || 0) > 0) {
        u.nadeT -= dt;
        u.moving = false;
        if (!u.nadeThrown && u.nadeT <= 0.45) {
          u.nadeThrown = true;
          const tx = u.nadeTarget != null ? u.nadeTarget : u.x + u.dir * 90;
          const dist = tx - u.x;
          const T = 0.85;
          this.nades.push({
            x: u.x + u.dir * 8, y: u.y - 30 * LANE_DEPTH[u.lane],
            vx: dist / T, vy: -0.5 * 620 * T * 0.62, spin: 0,
            lane: u.lane, side: u.side, landed: false,
            smoke: !!u.nadeSmoke,
            // a smoke canister starts pouring the moment it stops rolling
            fuse: u.nadeSmoke ? 0.25 : GRENADE.fuse,
          });
          Sound.shovel(u.x);
        }
        if (u.nadeT <= 0) { u.nadeThrown = false; u.nadeTarget = null; u.nadeSmoke = false; }
        continue;
      }

      // snipers
      if (u.sniperUnit) {
        this._updateSniper(u, dt);
      } else {
        u.fireT -= dt;
        // squads breaking for cover or repositioning hold their fire and run
        const rushing = u.squad && (u.squad.order === 'tocover' || u.squad.order === 'moveto');
        const t = !rushing && d.rof > 0 ? this._acquire(u) : null;
        if (t) {
          u.moving = false;
          u.combatT = Math.max(u.combatT, 0.4);
          if (u.fireT <= 0) this._fire(u, t);
        } else {
          this._advance(u, d, dt);
        }
      }

      // trap trigger
      if (u.side === 'us' && u.deadT == null) {
        for (const t of this.traps) {
          if (t.lane !== u.lane || Math.abs(t.x - u.x) > 14) continue;
          this.traps.splice(this.traps.indexOf(t), 1);
          if (t.type === 'punji') {
            Sound.trapSpring(u.x);
            this.fx.floater(u.x, u.y - 40, 'PUNJI PIT', '#e08767', true);
            this.fx.blood(u.x, u.y, 1);
            this.fx.addDecal(u.lane, u.x, 'blood', 5);
            u.slowT = 3;
            this._damage(u, 26, { side: 'vc' });
            this.hiddenLoss[u.lane]++;
          } else {
            Sound.explosion(0.7, t.x);
            this.fx.explosion(t.x, u.y, 46, { shake: 4 });
            this.fx.addDecal(u.lane, t.x, 'crater', 12);
            this._areaDamage(u.lane, t.x, 75, 46, { side: 'vc' }, 'vc');
            this.hiddenLoss[u.lane]++;
          }
          if (this.player === 'us') this.emit(`TROOPS IN CONTACT — BOOBY TRAP LANE ${u.lane + 1}`, 'vc');
          break;
        }
      }

      // breakthrough
      if (u.deadT == null) {
        const goal = u.side === 'us' ? WORLD_W - 42 : 42;
        if ((u.side === 'us' && u.x >= goal) || (u.side === 'vc' && u.x <= goal)) {
          const dmg = (u.cpShare || UNITS[u.key].cost) * (UNITS[u.key].sapper ? 0.9 : 0.45);
          this.morale[other(u.side)] -= dmg;
          this.fx.floater(u.x, u.y - 40, 'BREAKTHROUGH', u.side === 'us' ? '#b5c98f' : '#e08767', true);
          this.fx.explosion(u.x, u.y - 8, 40, { shake: 4 });
          Sound.explosion(0.6, u.x);
          this.emit(`LINE OVERRUN — LANE ${u.lane + 1}`, u.side);
          u.deadT = 99; u.baked = true; // gone through the line, not a casualty
          this.units.splice(i, 1);
        }
      }
    }
  }

  _advance(u, d, dt) {
    // men hold formation slots on their squad anchor (compressed inside cover)
    const s = u.squad;
    let tx;
    if (!s) {
      tx = u.hold ? u.holdX : u.x + u.dir * 1000;
    } else if (s.inCover && s.cover) {
      const alive = this.squadAlive(s);
      const idx = alive.indexOf(u);
      // Spacing is set by how wide a man actually draws, and the 3D sprites are
      // far wider than the cut-outs they replaced — a levelled rifle is ~40px on
      // its own, and a prone man is ~55px long. At the old 12px a fire team in
      // cover collapsed into a single unreadable blob.
      const prone = u.pose === 'prone';
      const want = prone ? 42 : 26;
      const floor = prone ? 32 : 20;   // a prone man is ~55px long, not ~26
      const spread = Math.max(floor, Math.min(want, s.cover.w / Math.max(2, alive.length)));
      tx = s.cover.x - s.dir * (idx - (alive.length - 1) / 2) * spread;
    } else {
      tx = s.x - u.dir * u.slot * 34; // room between men — silhouettes stay readable
    }
    const dx = tx - u.x;
    const marching = s && s._advancing; // the squad itself is on the move
    if (Math.abs(dx) < 2.5 && !marching) {
      u.moving = false;
      u.spd = 0;
      return;
    }
    u.moving = true;
    let sp = d.speed;
    if (typeof Perks !== 'undefined' && Perks.on(this, u.side, 'scouts')) sp *= 1.18;
    if (u.suppressT > 0) sp *= 0.5;
    if (u.slowT > 0) sp *= 0.45;
    // weight: heavy gunners lumber up to speed, light troops spring
    const accel = d.mg ? 130 : d.small ? 330 : 230;
    // arrival ease-in: bleed speed off approaching the slot instead of stopping dead
    if (!marching) sp = Math.min(sp, Math.abs(dx) * 5 + 10);
    u.spd = u.spd < sp ? Math.min(sp, (u.spd || 0) + accel * dt) : sp;
    const step = Math.sign(dx) * Math.min(Math.abs(dx), u.spd * dt);
    u.x += step;
    // stride follows the feet — heavier men take shorter, heavier steps
    const stride = d.mg ? 0.30 : d.small ? 0.245 : 0.262;
    u.phase += Math.abs(step) * stride;
    // raw ground covered, so the renderer can size a gait cycle to the distance
    // actually travelled instead of to a constant baked in here
    u.dist = (u.dist || 0) + Math.abs(step);

    /* Dust off the boots, emitted per STEP rather than per second, so it stays
     * locked to the stride at any speed. Half a gait cycle is one footfall. */
    const sc = LANE_DEPTH[u.lane] * (u.sj || 1);
    const stepLen = 84 * sc * 0.29 * (u.gaitK || 1);
    u.stepAcc = (u.stepAcc || 0) + Math.abs(step);
    if (u.stepAcc >= stepLen) {
      u.stepAcc -= stepLen;
      if (u.pose !== 'prone' && Camera.sees(u.x, 60)) {
        this.fx.footDust(u.x - u.dir * 4 * sc, u.y + 1, sc, u.dir);
      }
    }
  }

  _updateSniper(u, dt) {
    const d = UNITS[u.key];
    u.glintT -= dt;
    if (u.aiming) {
      const t = u.aimTarget;
      const valid = t && t.deadT == null && t.lane === u.lane && this.canSee(u.side, t) &&
        Math.abs(t.x - u.x) < d.range * 1.1 &&
        (!t.isHole || this.holes.includes(t)) &&
        (t.isHole || this.units.includes(t));
      if (!valid) {
        u.aiming = false; u.aimTarget = null; u.pose = null;
        return;
      }
      u.moving = false;
      u.pose = 'prone';
      u.combatT = Math.max(u.combatT, 0.4);
      // mutual aim = duel
      if (t.sniperUnit && t.aimTarget === u && !u.duelFlag) {
        u.duelFlag = t.duelFlag = true;
        this.setBanner('SNIPER DUEL', false);
        Sound.glintPing();
      }
      const elevAdv = elevAt(this.map, u.lane, u.x) - elevAt(this.map, t.lane, t.x);
      u.aimT += dt * (1 + 0.35 * clamp(elevAdv, -0.9, 0.9));
      if (u.glintT <= 0) {
        const scale = LANE_DEPTH[u.lane];
        this.fx.glint(u.x + u.dir * 12 * scale, u.y - 7 * scale);
        u.glintT = 0.45;
      }
      if (u.aimT >= u.aimTime) {
        const scale = LANE_DEPTH[u.lane];
        const mx = u.x + u.dir * 24 * scale, my = u.y - 6 * scale;
        Sound.sniperShot(mx);
        this.fx.muzzle(mx, my, u.dir, scale * 1.4);
        this.fx.tracer(mx, my, t.x, t.y - (t.isHole ? 2 : 14), '#fff0c8');
        if (t.isHole) this._damage(t, 80, u);
        else {
          this._damage(t, 999, u, { gib: Math.random() < 0.35 });
          this.fx.blood(t.x, t.y, 1.4);
          this.fx.addDecal(t.lane, t.x, 'blood', 5);
          if (t.sniperUnit && t.duelFlag) {
            this.setBanner('DUEL WON', false);
            this.fx.floater(u.x, u.y - 44, 'DUEL WON', '#ffd98a', true);
          }
        }
        u.aiming = false; u.aimTarget = null; u.pose = null;
        u.duelFlag = false;
        u.fireT = 3.5;
        if (u.side === 'vc' && UNITS[u.key].conceal) u.revealT = 6.5;
      }
      return;
    }
    u.pose = null;
    u.fireT -= dt;
    const t = this._acquire(u);
    if (t && u.fireT <= 0) {
      u.aiming = true;
      u.aimT = 0;
      u.aimTarget = t;
      u.moving = false;
    } else {
      this._advance(u, d, dt);
    }
  }

  _engineerTarget(u) {
    const works = [];
    for (const t of this.traps) if (t.side !== u.side && t.lane === u.lane) works.push({ obj: t, need: 1.6, kind: 'trap' });
    for (const tn of this.tunnels) if (tn.lane === u.lane) works.push({ obj: tn, need: 3, kind: 'tunnel' });
    for (const h of this.holes) if (h.lane === u.lane && (h.discovered || h.revealT > 0)) works.push({ obj: h, need: 2.2, kind: 'spider hole' });
    for (const w of works) {
      const dx = (w.obj.x - u.x) * u.dir;
      if (dx > -14 && dx < 62) return w;
    }
    return null;
  }

  _removeWork(obj) {
    let idx = this.traps.indexOf(obj);
    if (idx >= 0) { this.traps.splice(idx, 1); return; }
    idx = this.tunnels.indexOf(obj);
    if (idx >= 0) { this.tunnels.splice(idx, 1); return; }
    idx = this.holes.indexOf(obj);
    if (idx >= 0) this.holes.splice(idx, 1);
  }

  /* ---------- spider holes ---------- */
  _updateHoles(dt) {
    for (let i = this.holes.length - 1; i >= 0; i--) {
      const h = this.holes[i];
      h.cd -= dt;
      h.revealT = Math.max(0, h.revealT - dt);
      h.y = groundY(this.map, h.lane, h.x) - 5;
      if (h.cd > 0) continue;
      let best = null, nd = 1e9;
      for (const u of this.units) {
        if (u.side !== 'us' || u.deadT != null || u.lane !== h.lane) continue;
        const dist = Math.abs(u.x - h.x);
        if (dist < 300 && dist < nd) { nd = dist; best = u; }
      }
      if (best) {
        h.dirToTarget = Math.sign(best.x - h.x) || -1;
        Sound.sniperShot(h.x);
        this.fx.muzzle(h.x + h.dirToTarget * 10, h.y - 2, h.dirToTarget, 1);
        this.fx.tracer(h.x, h.y - 2, best.x, best.y - 14, '#fff0c8');
        this.fx.blood(best.x, best.y, 1);
        this._damage(best, 55, h);
        this.fx.floater(h.x, h.y - 26, 'AMBUSH!', '#e08767');
        h.revealT = 2.6;
        h.cd = 4.5;
        if (this.player === 'us') this.emit(`SNIPER FIRE — LANE ${h.lane + 1}`, 'vc');
      }
    }
  }

  /* ---------- strikes ---------- */
  _updateStrikes(dt) {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.age += dt;
      if (s.impacts) {
        for (const im of s.impacts) {
          if (!im.done && s.age >= im.t) {
            im.done = true;
            const y = groundY(this.map, s.lane, im.x);
            this.fx.explosion(im.x, y, im.r, {});
            this.fx.addDecal(s.lane, im.x, 'crater', im.r * 0.28);
            if (im.r >= 60) this.addCover(s.lane, im.x, 'crater'); // shellholes become cover
            Sound.explosion(s.type === 'arclight' ? 1.3 : 1, im.x);
            this.tryBirds(im.x);
            if (s.type === 'arclight') this.fx.flash = Math.max(this.fx.flash, 0.18);
            this._areaDamage(s.lane, im.x, im.r, im.dmg, { side: s.side }, s.side);
          }
        }
      }
      if (s.type === 'napalm' && !s.dropped && s.age >= s.dropT) {
        s.dropped = true;
        const y = groundY(this.map, s.lane, s.x);
        Sound.napalmWhoosh(s.x);
        this.fx.napalmBurst(s.x, y, 320);
        this.fx.addDecal(s.lane, s.x, 'scorch', 110);
        this.fires.push({ lane: s.lane, x0: s.x - 170, x1: s.x + 170, t: 0, dur: 7, dps: 24 });
        this._burnStrip(s.lane, s.x - 170, s.x + 170);
        this._areaDamage(s.lane, s.x, 175, 40, { side: s.side }, s.side);
      }
      if (s.type === 'medevac' && !s.healed && s.age >= 2.4) {
        s.healed = true;
        this.morale[s.side] = clamp(this.morale[s.side] + 14, 0, 100);
        this.fx.floater(Camera.x + CANVAS_W / 2, 200, 'WOUNDED EVACUATED  +14 MORALE', '#b5c98f', true);
      }
      if (s.type === 'aircav' && !s.dropped && s.age >= 3.0) {
        s.dropped = true;
        this.trySpawn(s.side, 'rifles', s.lane, { free: true, x: s.x - 12 });
        this.trySpawn(s.side, 'weapons', s.lane, { free: true, x: s.x + 18 });
        this.fx.smokePuff(s.x, groundY(this.map, s.lane, s.x) - 10);
      }
      if (s.age >= s.dur) this.strikes.splice(i, 1);
    }
  }

  _areaDamage(lane, x, r, dmg, killer, killerSide) {
    for (const u of this.units) {
      if (u.lane !== lane || u.deadT != null) continue;
      const dist = Math.abs(u.x - x);
      if (dist > r) continue;
      let k = 1 - 0.6 * (dist / r);
      // cover helps a little against blast — most of its value is vs small arms
      if (u.squad && u.squad.inCover && u.squad.cover) k *= 1 - u.squad.cover.prot * 0.3;
      // blast is `heavy`: armour is no defence against a satchel, mine or shell
      this._damage(u, dmg * k, { side: killerSide }, { gib: dmg * k >= 30, heavy: true });
      if (u.deadT == null) u.suppressT = Math.max(u.suppressT, 1);
      if (u.squad) {
        u.squad.pin += 0.5;
        u.squad.underFireT = Math.max(u.squad.underFireT, 2);
      }
    }
    for (let j = this.holes.length - 1; j >= 0; j--) {
      const h = this.holes[j];
      if (h.lane === lane && Math.abs(h.x - x) < r * 0.85) {
        h.hp -= dmg;
        if (h.hp <= 0) this._kill(h, killerSide);
      }
    }
    for (const st of this.structures) {
      if (st.lane === lane && Math.abs(st.x - x) < r * 0.9 + st.w / 2) {
        this._hurtStructure(st, dmg * 0.8, dmg >= 38);
      }
    }
    for (let j = this.traps.length - 1; j >= 0; j--) {
      const t = this.traps[j];
      if (t.lane === lane && Math.abs(t.x - x) < r * 0.7) this.traps.splice(j, 1);
    }
    for (let j = this.tunnels.length - 1; j >= 0; j--) {
      const tn = this.tunnels[j];
      if (tn.lane === lane && Math.abs(tn.x - x) < r * 0.7) {
        tn.hp -= dmg;
        if (tn.hp <= 0) {
          this.tunnels.splice(j, 1);
          this.fx.floater(tn.x, groundY(this.map, lane, tn.x) - 20, 'TUNNEL COLLAPSED', '#ffd98a');
        }
      }
    }
  }

  _burnStrip(lane, x0, x1) {
    let changed = false;
    for (const z of this.conceal[lane]) {
      if (z.burned) continue;
      const zx0 = z.x0 * WORLD_W, zx1 = z.x1 * WORLD_W;
      if (zx0 < x1 && zx1 > x0) { z.burned = true; changed = true; }
    }
    if (changed) {
      Renderer.markDirty(lane);
      this.emit(`COVER BURNED OFF — LANE ${lane + 1}`, 'us');
    }
  }

  _updateFires(dt) {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.t > f.dur) { this.fires.splice(i, 1); continue; }
      if (Math.random() < dt * 26) this.fx.fireTick(f.x0, f.x1, f.lane, this.map);
      for (const u of this.units) {
        if (u.lane === f.lane && u.deadT == null && u.x > f.x0 && u.x < f.x1) {
          this._damage(u, f.dps * dt, { side: 'us' });
        }
      }
    }
  }

  /* ---------- structures ---------- */
  _hurtStructure(st, dmg, burn) {
    if (st.state >= 2) return;
    st.hp -= dmg;
    if (burn && st.kind !== 'bunker' && st.kind !== 'well') st.burnT = Math.max(st.burnT, 8);
    if (st.hp <= st.maxHp * 0.5 && st.state === 0) {
      st.state = 1;
      this.fx.smokePuff(st.x, groundY(this.map, st.lane, st.x) - 12);
    }
    if (st.hp <= 0) {
      st.state = 2;
      st.burnT = Math.min(st.burnT, 2.5);
      const y = groundY(this.map, st.lane, st.x);
      this.fx.explosion(st.x, y - 6, 30, { shake: 2 });
      this.fx.addDecal(st.lane, st.x, 'scorch', st.w * 0.5);
      Sound.explosion(0.45, st.x);
      if (st.kind === 'bunker') this.emit(`BUNKER DESTROYED — LANE ${st.lane + 1}`, 'sys');
      // a levelled building is a fighting position — towns become cover
      const deco = ['well', 'hay', 'banana', 'cart', 'shrine', 'stall'];
      if (!deco.includes(st.kind)) this.addCover(st.lane, st.x, 'rubble');
      // a destroyed emplacement takes its strongpoint with it
      for (const laneCovers of this.covers) {
        const ci = laneCovers.findIndex(c => c.structRef === st);
        if (ci >= 0) {
          const c = laneCovers[ci];
          if (c.occ) {
            const s = c.occ;
            s.cover = null; s.inCover = false; s.order = 'advance';
            s.pin += 0.5; s.underFireT = 2;
          }
          laneCovers.splice(ci, 1);
          this.emit(`STRONGPOINT DESTROYED — LANE ${st.lane + 1}`, 'sys');
        }
      }
    }
  }

  _updateStructures(dt) {
    for (const st of this.structures) {
      if (st.burnT > 0) {
        st.burnT -= dt;
        st.fireHurt += dt;
        if (st.fireHurt > 0.5) {
          st.fireHurt = 0;
          this._hurtStructure(st, 6, false);
        }
        if (Math.random() < dt * 5) {
          const y = groundY(this.map, st.lane, st.x);
          this.fx.fireTick(st.x - st.w / 2, st.x + st.w / 2, st.lane, this.map);
          if (Math.random() < 0.5) this.fx.smokePuff(st.x + rand(-st.w / 3, st.w / 3), y - rand(14, 26));
        }
      }
      // standing fires ignite what they touch
      if (st.state < 2 && st.burnT <= 0) {
        for (const f of this.fires) {
          if (f.lane === st.lane && st.x > f.x0 - 12 && st.x < f.x1 + 12) st.burnT = 8;
        }
      }
    }
  }

  /* ---------- ambient life ---------- */
  _ambient(dt) {
    // birds scatter from the treeline when fighting is close
    this.birdT -= dt;
    // background smoke columns beyond the ridge
    for (const s of this.smokeSrc) {
      s.t -= dt;
      if (s.t <= 0) {
        s.t = rand(0.5, 1.1);
        this.fx.add({
          x: s.x + rand(-6, 6), y: 342, vx: rand(-4, 4), vy: rand(-14, -8), g: -2,
          t: 0, life: rand(3.5, 6), size: rand(9, 16), color: 'dark', type: 'smoke', drag: 0.3,
        });
      }
    }
    // an occasional patrol flight crossing the AO
    this.patrolT -= dt;
    if (this.patrolT <= 0) {
      this.patrolT = rand(55, 95);
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.strikes.push({
        type: 'patrol', age: 0, dur: (WORLD_W + 400) / 170,
        x: dir > 0 ? -180 : WORLD_W + 180, dirX: dir, y: rand(80, 140), heard: false,
      });
    }
  }

  tryBirds(x) {
    if (this.birdT > 0 || this.map.treeDensity < 0.3) return;
    this.birdT = rand(9, 18);
    this.fx.birds(x + rand(-60, 60), LANE_BASE[0] - rand(60, 110));
  }

  /* ---------- flags ---------- */
  _updateFlags(dt) {
    for (const f of this.flags) {
      let usN = 0, vcN = 0;
      for (const u of this.units) {
        if (u.lane !== f.lane || u.deadT != null) continue;
        if (Math.abs(u.x - f.x) < 100) u.side === 'us' ? usN++ : vcN++;
      }
      const side = usN > 0 && vcN === 0 ? 'us' : vcN > 0 && usN === 0 ? 'vc' : null;
      if (side && f.owner !== side) {
        if (f.capSide !== side) { f.capSide = side; f.cap = 0; }
        f.cap += dt * 0.3;
        if (f.cap >= 1) {
          f.owner = side;
          f.cap = 0; f.capSide = null;
          Sound.radio();
          this.fx.floater(f.x, groundY(this.map, f.lane, f.x) - 50, 'FLAG SECURED', side === 'us' ? '#b5c98f' : '#e08767', true);
          this.emit(`OBJECTIVE ${side === 'us' ? 'SECURED BY US' : 'TAKEN BY VC'} — LANE ${f.lane + 1}`, side);
        }
      } else if (!side) {
        f.cap = Math.max(0, f.cap - dt * 0.25);
        if (f.cap === 0) f.capSide = null;
      }
    }
  }

  /* ---------- AI ---------- */
  _lanePower(side, lane) {
    let p = 0;
    for (const u of this.units) {
      if (u.side === side && u.lane === lane && u.deadT == null) p += u.cpShare || UNITS[u.key].cost;
    }
    if (side === 'vc') for (const h of this.holes) if (h.lane === lane) p += 20;
    return p;
  }

  _aiUpdate(dt) {
    this.aiT -= dt;
    if (this.aiT > 0 || this.over) return;
    this.aiT = this.diff.aiInterval * rand(0.7, 1.3);
    if (Math.random() < this.diff.mistake) return;

    const side = this.aiSide, foe = other(side);
    const cp = this.cp[side];
    const powers = [0, 1, 2].map(l => ({
      lane: l,
      mine: this._lanePower(side, l),
      theirs: this._lanePower(foe, l),
    }));
    powers.sort((a, b) => (b.theirs - b.mine) - (a.theirs - a.mine));
    const hot = powers[0];
    const weak = powers[powers.length - 1];

    if (side === 'us') this._aiUS(cp, hot, weak);
    else this._aiVC(cp, hot, weak);

    // spawn decision
    const laneToSpawn = hot.theirs > hot.mine * 1.1 ? hot.lane
      : this.flags.find(f => f.owner !== side) ? this.flags.find(f => f.owner !== side).lane
      : weak.lane;
    const key = this._aiPickUnit(side, laneToSpawn);
    if (key) this.trySpawn(side, key, laneToSpawn);

    // squad abilities: grenade dug-in enemies, suppress massed ones
    for (const s of this.squads) {
      if (s.side !== side || !this.squadAlive(s).length) continue;
      const sd = SQUADS[s.key];
      if (sd.grenades && (s.nadeCd || 0) <= 0) {
        for (const o of this.squads) {
          if (o.side === side || o.lane !== s.lane || !o.inCover) continue;
          if (!this.squadAlive(o).length) continue;
          if (Math.abs(this.squadAnchor(o) - s.x) < GRENADE.range && Math.random() < 0.55) {
            this._squadGrenade(s);
            break;
          }
        }
      }
      if (sd.suppressive && (s.suppCd || 0) <= 0) {
        const close = this.squads.filter(o => o.side !== side && o.lane === s.lane &&
          this.squadAlive(o).length && Math.abs(this.squadAnchor(o) - s.x) < 270);
        if (close.length >= 2) this._squadSuppress(s);
      }
    }
  }

  _visibleFoesIn(lane, forSide) {
    const out = [];
    for (const u of this.units) {
      if (u.side !== forSide && u.deadT == null && u.lane === lane && this.canSee(forSide, u)) out.push(u);
    }
    return out;
  }

  _aiUS(cp, hot, weak) {
    const side = 'us';
    // artillery / arclight on clusters
    for (const l of [0, 1, 2]) {
      const foes = this._visibleFoesIn(l, side);
      if (foes.length >= 3 && cp >= CALLINS.arty.cost && (this.cool[side].arty || 0) <= 0) {
        const cx = foes.reduce((s, u) => s + u.x, 0) / foes.length;
        const cluster = foes.filter(u => Math.abs(u.x - cx) < 150);
        if (cluster.length >= 3) { this.tryCallin(side, 'arty', l, cx); return; }
      }
      if (foes.length >= 6 && cp >= CALLINS.arclight.cost && (this.cool[side].arclight || 0) <= 0) {
        const cx = foes.reduce((s, u) => s + u.x, 0) / foes.length;
        this.tryCallin(side, 'arclight', l, cx);
        return;
      }
    }
    // napalm where hidden threats hurt us
    let worst = 0, worstLane = -1;
    for (const l of [0, 1, 2]) if (this.hiddenLoss[l] > worst) { worst = this.hiddenLoss[l]; worstLane = l; }
    if (worst >= 2 && cp >= CALLINS.napalm.cost && (this.cool[side].napalm || 0) <= 0) {
      const zone = this.conceal[worstLane].find(z => !z.burned);
      if (zone) {
        this.hiddenLoss[worstLane] = 0;
        this.tryCallin(side, 'napalm', worstLane, ((zone.x0 + zone.x1) / 2) * WORLD_W);
        return;
      }
    }
    if (this.morale.us < 58 && cp >= CALLINS.medevac.cost && (this.cool[side].medevac || 0) <= 0) {
      this.tryCallin(side, 'medevac', null, null);
      return;
    }
    const contested = this.flags.find(f => f.owner !== 'us');
    if (contested && cp >= CALLINS.aircav.cost + 40 && (this.cool[side].aircav || 0) <= 0 && this.time > 90) {
      this.tryCallin(side, 'aircav', contested.lane, clamp(contested.x - 80, WORLD_W * 0.1, WORLD_W * 0.9));
    }
  }

  _aiVC(cp, hot, weak) {
    const side = 'vc';
    // trap seeding ahead of the US advance
    if (cp >= 30 && (this.cool[side].punji || 0) <= 0 && Math.random() < 0.65) {
      const lane = randi(0, 2);
      const front = this._usFront(lane);
      const x = clamp(front + rand(140, 420), WORLD_W * 0.1, WORLD_W * 0.9);
      this.tryCallin(side, 'punji', lane, x);
      return;
    }
    if (cp >= 45 && (this.cool[side].mine || 0) <= 0 && Math.random() < 0.4) {
      const lane = hot.lane;
      const front = this._usFront(lane);
      this.tryCallin(side, 'mine', lane, clamp(front + rand(160, 380), WORLD_W * 0.1, WORLD_W * 0.9));
      return;
    }
    if (cp >= CALLINS.spiderhole.cost + 20 && (this.cool[side].spiderhole || 0) <= 0 && this.holes.length < 4) {
      const lane = hot.lane;
      const front = this._usFront(lane);
      // bury on the highest ground ahead of their advance
      let bestX = 0, bestE = -1;
      for (let x = front + 180; x < WORLD_W * 0.9; x += 60) {
        const e = elevAt(this.map, lane, x);
        if (e > bestE) { bestE = e; bestX = x; }
      }
      if (bestX > 0) { this.tryCallin(side, 'spiderhole', lane, bestX); return; }
    }
    if (cp >= CALLINS.tunnel.cost + 30 && (this.cool[side].tunnel || 0) <= 0 && this.time > 100) {
      const lane = weak.lane;
      if (!this.tunnels.some(t => t.lane === lane)) {
        this.tryCallin(side, 'tunnel', lane, WORLD_W * rand(0.5, 0.62));
      }
    }
  }

  _usFront(lane) {
    let front = BASE_X.us;
    for (const u of this.units) {
      if (u.side === 'us' && u.deadT == null && u.lane === lane) front = Math.max(front, u.x);
    }
    return front;
  }

  _aiPickUnit(side, lane) {
    const cp = this.cp[side];
    const foes = this._visibleFoesIn(lane, side);
    const mySquads = this.squads.filter(s => s.side === side && this.squadAlive(s).length).length;
    if (mySquads > 7) return null;
    const foeSniper = foes.some(u => u.sniperUnit);
    const foeMg = foes.some(u => UNITS[u.key] && UNITS[u.key].mg);
    const cool = k => (this.cool[side][k] || 0) <= 0;
    const afford = k => cp >= SQUADS[k].cost;

    if (side === 'us') {
      if (this.hiddenLoss[lane] >= 1 && cool('engineers') && afford('engineers') && Math.random() < 0.5) return 'engineers';
      if (foeSniper && cool('snipers') && afford('snipers')) return 'snipers';
      if (foes.length >= 3 && cool('weapons') && afford('weapons')) return 'weapons';
      if (this.map.id !== 'iadrang' && cool('lrrp') && afford('lrrp') && Math.random() < 0.3) return 'lrrp';
      if (cool('rifles') && afford('rifles')) return 'rifles';
      if (cool('arvnsq') && afford('arvnsq')) return 'arvnsq';
    } else {
      const foeArmour = foes.some(u => UNITS[u.key] && UNITS[u.key].armour);
      if (foeArmour && cool('rpgteam') && afford('rpgteam')) return 'rpgteam';
      if (foeSniper && cool('marksmanu') && afford('marksmanu')) return 'marksmanu';
      if (foeMg && cool('sapperu') && afford('sapperu') && Math.random() < 0.6) return 'sapperu';
      if (foes.length >= 3 && cool('rpdteam') && afford('rpdteam')) return 'rpdteam';
      if (cool('nvasq') && afford('nvasq') && Math.random() < 0.5) return 'nvasq';
      if (cool('cell') && afford('cell')) return 'cell';
      if (cool('nvasq') && afford('nvasq')) return 'nvasq';
    }
    return null;
  }

  objectiveText() {
    if (this.mode === 'siege') {
      const left = Math.max(0, this.timeLimit - this.time);
      const m = Math.floor(left / 60), s = Math.floor(left % 60);
      return `SIEGE — RELIEF IN ${m}:${s.toString().padStart(2, '0')}`;
    }
    if (this.mode === 'assault') {
      const left = Math.max(0, this.timeLimit - this.time);
      const m = Math.floor(left / 60), s = Math.floor(left % 60);
      return `ASSAULT — TAKE ALL FLAGS · ${m}:${s.toString().padStart(2, '0')}`;
    }
    return 'BREAK ENEMY MORALE';
  }
}
