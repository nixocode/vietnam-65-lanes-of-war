'use strict';

/* ============================== Camera ==============================
   The world is WORLD_W wide; the canvas shows a CANVAS_W window onto it.
   Mouse-edge scroll / arrow keys / minimap clicks move targetX. */
const Camera = {
  x: 0, targetX: 0,
  reset(px) { this.x = this.targetX = clamp(px, 0, WORLD_W - CANVAS_W); },
  pan(dx) { this.targetX = clamp(this.targetX + dx, 0, WORLD_W - CANVAS_W); },
  center(wx) { this.targetX = clamp(wx - CANVAS_W / 2, 0, WORLD_W - CANVAS_W); },
  update(dt) {
    this.x += (this.targetX - this.x) * Math.min(1, dt * 9);
    if (Math.abs(this.targetX - this.x) < 0.4) this.x = this.targetX;
  },
  sees(wx, margin = 90) { return wx > this.x - margin && wx < this.x + CANVAS_W + margin; },
};

/* ============================== Soldiers ============================== */
const SOLDIER_COLORS = {
  rifleman: { coat: '#4d5a3c', pants: '#414c34', hat: '#3d4830', skin: '#c9a37d' },
  arvn:     { coat: '#5d6a49', pants: '#4d583c', hat: '#48533a', skin: '#c19a70' },
  m60:      { coat: '#4d5a3c', pants: '#414c34', hat: '#3d4830', skin: '#b28963' },
  engineer: { coat: '#55604a', pants: '#414c34', hat: '#3d4830', skin: '#c9a37d' },
  recon:    { coat: '#42503a', pants: '#3a4530', hat: '#46523c', skin: '#b28963' },
  sniper:   { coat: '#46523a', pants: '#3d4830', hat: '#4a5538', skin: '#c9a37d' },
  guerrilla:{ coat: '#38362f', pants: '#302e28', hat: '#c2a36a', skin: '#c19a70' },
  nva:      { coat: '#6f6748', pants: '#5f583e', hat: '#655e3e', skin: '#c19a70' },
  rpd:      { coat: '#6f6748', pants: '#5f583e', hat: '#655e3e', skin: '#b28963' },
  sapper:   { coat: '#38362f', pants: '#302e28', hat: '#8a2f22', skin: '#c19a70' },
  marksman: { coat: '#45423a', pants: '#38362e', hat: '#b5975e', skin: '#c19a70' },
};

const WALK_CYCLE = ['walk1', 'walk2', 'walk3', 'walk2'];

const SPRITE_STAND_H = 56; // on-screen height of a standing soldier at depth 1

/* fixed-anchor run cycles — one shared anchor per anim, zero playback jitter.
   Every family runs as its OWN painted character (per-class sheet). */
const RUN_ANIMS = {
  us_rifle: 'us_run', arvn: 'us_run', us_m60: 'm60_runB',
  us_sniper: 'sniper_run',
  vc_rifle: 'vc_run', vc_gunner: 'nva_runB', vc_black: 'vc_run',
};
const RUN_FPS = 55;      // cycle playback: phase advances ~11/s at full speed
const RUN_SCALE = 1.0;   // benchmark run sheets share the idle sets' proportions — no trim,
                         // so run↔idle transitions keep an identical silhouette size
const POSE_FADE = 0.09;  // seconds to crossfade between pose changes

/* curated cells from the texture sheets (corrupted/header cells never referenced) */
const TEX = {
  mtn: ['t1_57', 't1_58', 't1_59'],
  treeline: ['t1_53', 't1_54', 't1_55'],
  villageSil: ['t2_54', 't2_56', 't2_57'],
  paddy: ['t1_12', 't1_14', 't1_16'],
  tuft: ['t1_42', 't1_43', 't1_44'],
  fern: ['t1_45', 't1_46'],
  bush: ['t1_47', 't1_48', 't2_48'],
  plant: ['t2_45'],
  banana: ['t2_42', 't2_43'],
  palm: ['t2_44'],
  dike: ['t1_02', 't1_04', 't1_05'],
  stonewall: ['t1_07', 't1_08', 't1_09'],
  sandbags: ['t2_08'],
  hooch: ['t2_18', 't2_22', 't2_23', 't2_24'],
  house: ['t2_12', 't2_14', 't2_15'],
  stiltH: ['t2_25', 't2_26', 't2_27'],
  well: ['t2_34'],
  cart: ['t2_38'],
  shrine: ['t2_33'],
  stall: ['t2_36'],
  watchtower: ['t2_01'],
  gate: ['t2_07'],
};

function tex(kind, i) {
  if (typeof Assets === 'undefined' || !Assets.done) return null;
  const list = TEX[kind];
  if (!list) return null;
  return Assets.img(list[((i % list.length) + list.length) % list.length]);
}

/* bottom-center anchored texture draw */
function drawTex(ctx, kind, i, x, gy, w, opts = {}) {
  const img = tex(kind, i);
  if (!img) return false;
  const h = img.height * (w / img.width);
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  if (opts.flip) {
    ctx.translate(x, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, gy - h + (opts.sink || 0), w, h);
  } else {
    ctx.drawImage(img, x - w / 2, gy - h + (opts.sink || 0), w, h);
  }
  ctx.restore();
  return true;
}
/* per-sheet body-size trim: some generations run bulkier at equal stand height */
const SHEET_TRIM = { us_sniper: 0.93, vc_sniper: 0.95 };
function spriteScaleFor(key, sheet, scale) {
  const u = UNITS[key];
  const sk = UNIT_SPRITES[key];
  return (SPRITE_STAND_H / sheet.standH) * (scale || 1) *
    (u && u.small ? 0.92 : 1) * (SHEET_TRIM[sk] || 1);
}

const NADE_ANIMS = {
  us_rifle: 'us_nade', arvn: 'us_nade', us_m60: 'us_nade', us_sniper: 'us_nade',
  vc_rifle: 'vc_nade', vc_gunner: 'vc_nade', vc_black: 'vc_nade', vc_sniper: 'vc_nade',
};
/* Anim sets are only shared where the painted CHARACTER matches the sheet —
   a khaki ARVN must never flash into a helmeted US rifleman between poses.
   Families without a matching set keep their own sheet frames. */
const IDLE_ANIMS = { us_rifle: 'us_idle', vc_rifle: 'vc_idle', vc_black: 'vc_idle' };
const FIRE_ANIMS = {
  us_rifle: 'us_fire_m16', us_m60: 'us_fire_m60',
  vc_rifle: 'vc_fire_ak', vc_black: 'vc_fire_ak',
};
const DEATH_ANIMS = {
  us_rifle: 'us_death', us_m60: 'us_death',
  vc_rifle: 'vc_death', vc_black: 'vc_death',
};
const TRANS_ANIMS = {
  us_rifle: 'us_toprone', us_m60: 'us_toprone',
  vc_rifle: 'vc_toprone', vc_black: 'vc_toprone',
};
/* body-mass normalization: crouched fire frames read bulkier at equal height */
const ANIM_TRIM = {
  us_fire_m16: 0.94, vc_fire_ak: 0.94, us_fire_m60: 0.96, us_fire_prone: 1,
  us_idle: 1, vc_idle: 1, us_death: 0.97, vc_death: 0.97,
  us_toprone: 0.96, vc_toprone: 0.96,
};

/* unit-level run overrides (engineer runs with his pack even on the rifle sheet) */
const RUN_ANIMS_UNIT = { engineer: 'eng_run', recon: 'sniper_run' };

/* resolve [poseId, frameName, animName] for a soldier's current state */
function resolvePose(sk, sheet, o, key) {
  if (o.deadT != null) {
    // full painted death sequence when the sheet family has one
    const dAnim = !o.wounded && DEATH_ANIMS[sk];
    const dSeq = dAnim && Assets.anim(dAnim);
    if (dSeq && dSeq.length) {
      const idx = Math.min(dSeq.length - 1, Math.floor(o.deadT / 0.9 * dSeq.length));
      return ['death', dSeq[idx], dAnim];
    }
    if (o.deadT < 0.2) return ['hit', sheet.poses.hit, null];
    if (o.deadT < 0.6 && !o.wounded) return ['fall', sheet.poses.hit, null];
    if (o.wounded && o.deadT < 2.3) return ['prone', sheet.poses.prone, null];
    return ['fallen', sheet.poses.fallen, null];
  }
  if ((o.nadeT || 0) > 0 && NADE_ANIMS[sk]) {
    const seq = Assets.anim(NADE_ANIMS[sk]);
    if (seq && seq.length) {
      const p = clamp(1 - o.nadeT / (o.nadeDur || 0.9), 0, 0.999);
      return ['nade', seq[Math.floor(p * seq.length)], NADE_ANIMS[sk]];
    }
  }
  // stand↔prone transition frames
  if ((o.transT || 0) > 0 && TRANS_ANIMS[sk]) {
    const seq = Assets.anim(TRANS_ANIMS[sk]);
    if (seq && seq.length) {
      const p = clamp(1 - o.transT / 0.45, 0, 0.999);
      const idx = Math.floor((o.transDir > 0 ? p : 1 - p) * seq.length);
      return ['trans', seq[clamp(idx, 0, seq.length - 1)], TRANS_ANIMS[sk]];
    }
  }
  if (o.pose === 'prone') return ['prone', sheet.poses.prone, null];
  if (o.hitT > 0) return ['hit', sheet.poses.hit, null];
  if (o.combat) {
    // recoil loop: aim frame between shots, flash→casing→recover during muzzleT
    const fAnim = FIRE_ANIMS[sk];
    const fSeq = fAnim && Assets.anim(fAnim);
    if (fSeq && fSeq.length >= 4) {
      let idx = 0;
      if ((o.muzzleT || 0) > 0) {
        idx = 1 + Math.min(2, Math.floor((1 - o.muzzleT / 0.07) * 3));
      }
      return ['fire', fSeq[idx], fAnim];
    }
    return ['fire', sheet.poses.fire, null];
  }
  if (o.moving) {
    const runName = RUN_ANIMS_UNIT[key] || RUN_ANIMS[sk];
    const run = runName && Assets.anim(runName);
    if (run && run.length) {
      // frames-per-stride is constant regardless of cycle length
      const idx = Math.floor((o.phase || 0) * 1.3 * (run.length / 12)) % run.length;
      return ['run', run[idx], runName];
    }
    return ['walk', sheet.poses[WALK_CYCLE[Math.floor((o.phase || 0) * 0.8) % 4]], null];
  }
  // living idle loop where the family has one; procedural breathing on top
  const iAnim = IDLE_ANIMS[sk];
  const iSeq = iAnim && Assets.anim(iAnim);
  if (iSeq && iSeq.length) {
    const idx = Math.floor((o.time || 0) * 5 + (o.x || 0) * 0.07) % iSeq.length;
    return ['idle', iSeq[idx], iAnim];
  }
  return ['idle', sheet.poses.idle, null];
}

function drawSpriteFrame(ctx, key, sheet, name, poseId, animName, o, alpha) {
  const img = Assets.img(name), m = Assets.meta(name);
  if (!img || !m) return false;
  let s = spriteScaleFor(key, sheet, o.scale);
  if (animName) {
    const am = Assets.animMeta(animName);
    if (am && am.standH) {
      s = (SPRITE_STAND_H / am.standH) * (o.scale || 1) *
          (poseId === 'run' ? RUN_SCALE : 1) * (ANIM_TRIM[animName] || 1);
    }
  }
  ctx.save();
  ctx.translate(o.x, o.y);
  // death fall: pivot the hit pose down at the feet (fallback path only)
  if (poseId === 'fall') {
    const k = Math.min(1, (o.deadT - 0.2) / 0.4);
    const e = 1 - (1 - k) * (1 - k); // ease-out
    ctx.rotate(-(o.dir || 1) * e * 1.35);
  }
  ctx.scale((o.dir || 1) * s, s);
  // procedural breathing rides on top of the idle loop
  if (poseId === 'idle') {
    const b = Math.sin((o.time || 0) * 2.1 + (o.x || 0) * 0.13);
    ctx.rotate(b * 0.012);
    ctx.scale(1, 1 + b * 0.009);
  }
  if (o.flash && poseId !== 'fire') {
    ctx.translate(-2.5 / s, 0); // recoil kick for families without a fire loop
    ctx.rotate(-0.035);
  }
  if (poseId === 'hit' && o.deadT == null && o.hitT > 0) {
    ctx.translate(rand(-0.8, 0.8) / s, 0); // flinch shudder
  }
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, -m.ax, -m.ay);
  ctx.restore();
  return true;
}

/* sprite path; returns false when art is missing so the vector path can run.
   Pose changes crossfade over POSE_FADE seconds via per-unit anim state (o.ref). */
function drawSoldierSprite(ctx, key, o) {
  if (typeof Assets === 'undefined' || !Assets.done) return false;
  const sk = UNIT_SPRITES[key];
  const sheet = sk && Assets.sheet(sk);
  if (!sheet) return false;

  let [poseId, name, animName] = resolvePose(sk, sheet, o, key);
  if (!name) return false;

  let alpha = o.alpha != null ? o.alpha : 1;
  if (o.deadT != null) {
    const fadeAt = o.wounded ? 2.4 : 0.9;
    alpha *= Math.max(0, 1 - Math.max(0, o.deadT - fadeAt) / 0.55);
  }
  if (alpha <= 0) return true;

  const ref = o.ref;
  if (ref) {
    let as = ref._as;
    if (!as) as = ref._as = { pose: poseId, name, anim: animName, prevName: null, prevPose: null, prevAnim: null, t: 1, holdT: 1 };
    as.holdT = (as.holdT || 0) + (Renderer._fdt || 0.016);
    if (as.pose !== poseId) {
      // min-hold: a pose must live ≥140ms before switching (kills state thrash),
      // except death/hit which interrupt instantly
      const urgent = poseId === 'fall' || poseId === 'fallen' || poseId === 'hit' ||
                     poseId === 'death' || o.deadT != null;
      if (as.holdT >= 0.14 || urgent) {
        as.prevPose = as.pose; as.prevName = as.name; as.prevAnim = as.anim;
        as.t = (poseId === 'fall' || as.pose === 'fall' || poseId === 'death') ? 1 : 0;
        as.pose = poseId;
        as.holdT = 0;
      }
    }
    if (as.pose === poseId) {
      as.name = name;         // same state: frames advance freely (cycles/loops)
      as.anim = animName;
    } else {
      poseId = as.pose;       // held: reuse the EXACT stored pose, frame, and scale basis
      name = as.name;
      animName = as.anim;
    }
    as.t = Math.min(1, as.t + (Renderer._fdt || 0.016) / POSE_FADE);
    if (as.t < 1 && as.prevName) {
      // old pose stays at FULL alpha underneath; new pose fades in on top —
      // total coverage never dips, so no mid-fade ghosting/dimming
      drawSpriteFrame(ctx, key, sheet, as.prevName, as.prevPose, as.prevAnim, o, alpha);
      return drawSpriteFrame(ctx, key, sheet, name, poseId, animName, o, alpha * as.t);
    }
  }
  return drawSpriteFrame(ctx, key, sheet, name, poseId, animName, o, alpha);
}

function drawSoldier(ctx, key, o) {
  /* Vehicles ride the prop path, not the soldier path — one static profile
   * sprite off the same camera. They are units in every other respect, so this
   * is the only place the difference shows. */
  const ud = typeof UNITS !== 'undefined' ? UNITS[key] : null;
  if (ud && ud.vehicle && typeof Props !== 'undefined' && Props.ready &&
      Props.has(ud.prop)) {
    const sc = o.scale || 1;
    const gy = o.y + S3_TARGET_H * sc * S3_FOOT;
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (o.deadT != null) {
      // a knocked-out track sits and burns rather than fading away
      ctx.globalAlpha = (o.alpha != null ? o.alpha : 1) * 0.9;
      ctx.filter = 'brightness(0.45)';
    }
    Props.draw(ctx, ud.prop, o.x, gy, sc, { flip: (o.dir || 1) < 0 });
    ctx.filter = 'none';
    ctx.restore();
    return;
  }
  // sheets rendered off a rigged 3D model are the primary path — one model, one
  // camera, so a soldier cannot morph or drift between frames
  if (typeof Sprite3D !== 'undefined' && Sprite3D.enabled && Sprite3D.has(key)) {
    if (Sprite3D.draw(ctx, key, o)) return;
  }
  // skeletal puppet is the fallback (consistent, smooth, morph-proof)
  if (typeof Rig !== 'undefined' && Rig.enabled) { Rig.draw(ctx, key, o); return; }
  if (drawSoldierSprite(ctx, key, o)) return;
  drawSoldierVector(ctx, key, o);
}

/* world-space muzzle location for a unit — the weapon-bone barrel tip */
function muzzlePoint(u) {
  const laneS = LANE_DEPTH[u.lane];
  const scale = laneS * (u.sj || 1);
  const cvm = u.squad && u.squad.inCover ? u.squad.cover : null;
  const lift = cvm
    ? (cvm.type === 'towerpos' ? 30 : (cvm.lift || 0)) * laneS
    : 0;
  if (typeof Sprite3D !== 'undefined' && Sprite3D.enabled && Sprite3D.has(u.key)) {
    // the same state the draw used, so the flash sits on the frame being shown
    return Sprite3D.muzzle(u.key, {
      x: u.x, y: u.y + (u.yj || 0) - lift, dir: u.dir, scale,
      moving: u.moving, combat: true, pose: u.pose,
      muzzleT: u.muzzleT || 0, deadT: u.deadT, phase: u.phase,
      dist: u.dist || 0, spd: u.spd || 0,
      gaitOff: u.gaitOff || 0, gaitK: u.gaitK || 1,
      hitT: u.hitT || 0, transT: u.transT || 0, time: Renderer._time || 0,
    });
  }
  if (typeof Rig !== 'undefined' && Rig.enabled) {
    return Rig.muzzle(u.key, {
      x: u.x, y: u.y - lift, dir: u.dir, scale,
      moving: false, combat: true, pose: u.pose,
      muzzleT: u.muzzleT || 0, deadT: u.deadT, phase: u.phase,
    });
  }
  if (u.pose === 'prone') return { x: u.x + u.dir * 33 * scale, y: u.y - lift - 8 * scale };
  return { x: u.x + u.dir * 21 * scale, y: u.y - lift - 27 * scale };
}

/* original canvas-primitive soldier — the guaranteed fallback */
function drawSoldierVector(ctx, key, o) {
  const C = SOLDIER_COLORS[key], u = UNITS[key];
  const s = (o.scale || 1) * (u.small ? 0.92 : 1);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale((o.dir || 1) * s, s);
  ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
  ctx.lineCap = 'round';
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };

  if (o.deadT != null) {
    const k = Math.min(1, o.deadT / 0.4);
    ctx.rotate(-1.45 * k);
    ctx.globalAlpha *= Math.max(0, 1 - Math.max(0, o.deadT - 0.6) / 0.8);
  }

  const prone = o.pose === 'prone' && o.deadT == null;
  if (prone) {
    ctx.strokeStyle = C.pants; ctx.lineWidth = 3.4;
    line(-14, -2, -5, -3);
    ctx.strokeStyle = C.coat; ctx.lineWidth = 4.6;
    line(-6, -3, 4, -4.5);
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.arc(6.5, -6.5, 3.2, 0, 7); ctx.fill();
    drawHat(ctx, C, u.hat, 6.5, -6.5, true);
    ctx.strokeStyle = '#26251d'; ctx.lineWidth = 2;
    line(4, -5, 21, -4.2);
    if (u.sniper) { ctx.fillStyle = '#1c1b15'; ctx.fillRect(10, -7.4, 5, 2); }
  } else {
    const ph = o.phase || 0;
    const sw = o.moving ? Math.sin(ph) * 5 : 0;
    ctx.strokeStyle = C.pants; ctx.lineWidth = 3;
    line(0, -13, sw, 0);
    line(0, -13, -sw * 0.9, 0);
    ctx.strokeStyle = C.coat; ctx.lineWidth = 5;
    line(0, -12.5, 0.5, -22);
    if (u.pack) { ctx.fillStyle = '#3a4230'; ctx.fillRect(-5.5, -22, 4, 8); }
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.arc(1, -26.5, 3.6, 0, 7); ctx.fill();
    drawHat(ctx, C, u.hat, 1, -26.5, false);
    if (u.antenna) { ctx.strokeStyle = '#222'; ctx.lineWidth = 1; line(-4, -22, -7, -36); }
    if (u.sapper) { ctx.fillStyle = '#5c4a2e'; ctx.fillRect(2, -16, 6, 5); }
    ctx.strokeStyle = '#26251d';
    if (u.mg) {
      ctx.lineWidth = 2.8;
      line(-3, -19, 14, -18.4);
      ctx.lineWidth = 1.4;
      line(9, -18, 8, -14); line(12, -18, 13, -14);
    } else if (u.sniper) {
      ctx.lineWidth = 2;
      line(-3, -19, 15, -18.6);
      ctx.fillStyle = '#1c1b15'; ctx.fillRect(3, -21.4, 5, 1.8);
    } else if (!u.sapper) {
      ctx.lineWidth = 2.2;
      line(-3, -19, 11.5, -18.5);
    }
    ctx.strokeStyle = C.skin; ctx.lineWidth = 2.2;
    line(1, -20, 7, -18.8);
  }
  ctx.restore();
}

function drawHat(ctx, C, hat, hx, hy, prone) {
  ctx.fillStyle = C.hat;
  switch (hat) {
    case 'm1':
      ctx.beginPath(); ctx.ellipse(hx, hy - 2.2, 4.6, 3.1, 0, Math.PI, 0); ctx.fill();
      ctx.fillRect(hx - 4.6, hy - 2.6, 9.2, 1.4);
      break;
    case 'boonie':
      ctx.beginPath(); ctx.ellipse(hx, hy - 2.6, 3.6, 2.4, 0, Math.PI, 0); ctx.fill();
      ctx.fillRect(hx - 5.6, hy - 2.8, 11.2, 1.2);
      break;
    case 'conical':
      ctx.beginPath();
      ctx.moveTo(hx - 6.4, hy - 2);
      ctx.lineTo(hx, hy - 7.6);
      ctx.lineTo(hx + 6.4, hy - 2);
      ctx.closePath(); ctx.fill();
      break;
    case 'pith':
      ctx.beginPath(); ctx.ellipse(hx, hy - 2, 4.2, 3, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx, hy - 1.8, 5.4, 1.2, 0, 0, 7); ctx.fill();
      break;
    case 'band':
      ctx.fillRect(hx - 3.6, hy - 3.4, 7.2, 1.8);
      break;
  }
}

/* ---------- vehicle silhouettes ---------- */
function drawHuey(ctx, x, y, t, opts = {}) {
  ctx.save();
  ctx.translate(x, y);
  // the art is drawn nose-left; dir=+1 (default) means flying right, so mirror
  const dir = opts.dir != null ? opts.dir : 1;
  if (dir > 0) ctx.scale(-1, 1);
  if (opts.flip) ctx.scale(-1, 1);
  const c = opts.color || '#2c3324';
  ctx.fillStyle = c;
  ctx.beginPath(); ctx.ellipse(0, 0, 20, 7.5, 0, 0, 7); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14, -2); ctx.lineTo(40, -5); ctx.lineTo(40, -1); ctx.lineTo(16, 3); ctx.closePath(); ctx.fill();
  ctx.fillRect(37, -10, 3, 7);
  ctx.strokeStyle = c; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-10, 9); ctx.lineTo(-12, 13); ctx.moveTo(8, 9); ctx.lineTo(10, 13); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-14, 13); ctx.lineTo(14, 13); ctx.stroke();
  ctx.fillStyle = 'rgba(120,140,150,0.5)';
  ctx.beginPath(); ctx.ellipse(6, -2.5, 5, 3.5, 0, 0, 7); ctx.fill();
  const spin = Math.cos(t * 42);
  ctx.strokeStyle = 'rgba(30,34,26,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-34 * spin, -10); ctx.lineTo(34 * spin, -10); ctx.stroke();
  ctx.fillStyle = c; ctx.fillRect(-2, -11, 4, 5);
  if (opts.medevac) {
    ctx.fillStyle = '#b8b8b0'; ctx.fillRect(-6, -5, 10, 9);
    ctx.fillStyle = '#a83226';
    ctx.fillRect(-3, -3.5, 4, 6); ctx.fillRect(-5, -1.5, 8, 2);
  }
  ctx.restore();
}

function drawJet(ctx, x, y, dir) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.fillStyle = '#2a2f26';
  ctx.beginPath();
  ctx.moveTo(26, 0); ctx.lineTo(-4, -4); ctx.lineTo(-20, -2); ctx.lineTo(-24, -8); ctx.lineTo(-27, -8);
  ctx.lineTo(-24, 0); ctx.lineTo(-14, 3); ctx.lineTo(8, 4); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(2, -1); ctx.lineTo(-12, -12); ctx.lineTo(-16, -11); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawB52(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(38,42,36,0.9)';
  ctx.beginPath(); ctx.ellipse(0, 0, 26, 3.4, 0, 0, 7); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(6, -1); ctx.lineTo(-34, -9); ctx.lineTo(-36, -7); ctx.lineTo(-2, 2); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(6, -1); ctx.lineTo(46, -9); ctx.lineTo(44, -6); ctx.lineTo(8, 2); ctx.closePath(); ctx.fill();
  ctx.fillRect(-26, -8, 3, 8);
  ctx.restore();
}

/* ============================== Renderer ============================== */
const Renderer = {
  canvas: null, ctx: null,
  sky: null, farLayer: null, midLayer: null,
  laneLayers: [null, null, null], decalLayers: [null, null, null],
  dirty: [true, true, true],
  corpseCount: [0, 0, 0],
  clouds: [], menuLayer: null,
  minimapCanvas: null,

  FAR_PARA: 0.25, MID_PARA: 0.5,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fitDPR();
    if (window.ResizeObserver) new ResizeObserver(() => this.fitDPR()).observe(canvas);
    window.addEventListener('resize', () => this.fitDPR());
  },

  /* Size the backing store to the real device pixels. Without this the canvas
     is a 1280x720 image stretched over a high-DPI panel — which is exactly
     what reads as "pixelated" on a Mac or a phone. */
  /* Frame-time readout, toggled with F. Frame rate had to be argued about from
   * screenshots because there was no number anywhere; this makes it a fact. */
  showPerf: false,
  _perfSample(time) {
    const dt = time - (this._perfLast || time);
    this._perfLast = time;
    if (dt <= 0) return;
    const h = this._perfHist || (this._perfHist = []);
    h.push(dt * 1000);
    if (h.length > 120) h.shift();
  },

  _drawPerf(ctx, game) {
    const h = this._perfHist;
    if (!h || h.length < 8) return;
    const sorted = h.slice().sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const alive = game ? game.units.filter((u) => u.deadT == null).length : 0;
    const c = this.canvas;
    const lines = [
      Math.round(1000 / med) + ' FPS   ' + med.toFixed(1) + ' ms  (p95 ' + p95.toFixed(1) + ')',
      alive + ' men   ' + c.width + 'x' + c.height +
        '  scale ' + this.renderScale.toFixed(2) + '  dpr' + (window.devicePixelRatio || 1),
    ];
    ctx.save();
    ctx.font = 'bold 11px Courier New';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(6, 6, 236, 30);
    ctx.fillStyle = med > 22 ? '#ff8a6a' : med > 18 ? '#ffd98a' : '#a8d98a';
    ctx.fillText(lines[0], 12, 19);
    ctx.fillStyle = '#c8d0b4';
    ctx.fillText(lines[1], 12, 31);
    ctx.restore();
  },

  /* Draw only the slice of a wide layer that can actually be seen. */
  _blitStrip(ctx, layer, offset) {
    if (!layer) return;
    const sx = clamp(Math.floor(offset), 0, Math.max(0, layer.width - 1));
    const sw = Math.min(CANVAS_W, layer.width - sx);
    if (sw <= 0) return;
    ctx.drawImage(layer, sx, 0, sw, layer.height, 0, 0, sw, layer.height);
  },

  /* Adaptive resolution.
   *
   * A frame is ~9 full-screen layer blits (sky, parallax x2, three lanes, three
   * decal layers) plus the atmosphere fills, so cost is dominated by the size of
   * the backing store, not by draw calls. Rather than guess at any one machine,
   * measure and adjust: if frames are consistently slow, render fewer pixels and
   * let the browser scale up; if there is headroom, give the sharpness back.
   *
   * Deliberately sluggish — it only moves after a second of consistent evidence
   * and in small steps, because a resolution that visibly pumps is worse than one
   * that is simply a little soft.
   */
  renderScale: 1,
  _rsHold: 0,

  _adaptScale(dt) {
    const h = this._perfHist;
    if (!h || h.length < 45) return;
    this._rsHold -= dt;
    if (this._rsHold > 0) return;
    const sorted = h.slice(-45).sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    const before = this.renderScale;
    if (med > 21 && this.renderScale > 0.62) this.renderScale -= 0.12;
    else if (med < 13.2 && this.renderScale < 1) this.renderScale += 0.06;
    this.renderScale = clamp(this.renderScale, 0.62, 1);
    if (Math.abs(this.renderScale - before) > 0.001) {
      this._rsHold = 1.1;          // settle before judging again
      this.fitDPR();
    }
  },

  fitDPR() {
    const c = this.canvas;
    if (!c) return;
    // Capped at 2. Every full-screen parallax layer is redrawn each frame, so
    // cost scales with the backing store: dpr 3 is 2.25x the pixels of dpr 2 for
    // no visible gain at this art scale, and it is what kills frame rate on
    // phones and Retina panels.
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this._k = c.width / CANVAS_W;
  },

  markDirty(lane) { this.dirty[lane] = true; },

  _makeLayer(w, h) {
    const c = document.createElement('canvas');
    c.width = w || CANVAS_W; c.height = h || CANVAS_H;
    return c;
  },

  buildStatic(game) {
    const map = game.map;
    this.sky = this._makeLayer();
    this._drawSkyBase(this.sky.getContext('2d'), map);
    const farW = Math.ceil(CANVAS_W + (WORLD_W - CANVAS_W) * this.FAR_PARA);
    this.farLayer = this._makeLayer(farW, CANVAS_H);
    this._drawFar(this.farLayer.getContext('2d'), map, farW);
    const midW = Math.ceil(CANVAS_W + (WORLD_W - CANVAS_W) * this.MID_PARA);
    this.midLayer = this._makeLayer(midW, CANVAS_H);
    this._drawMid(this.midLayer.getContext('2d'), map, midW);
    for (let l = 0; l < 3; l++) {
      this.dirty[l] = true;
      this.decalLayers[l] = this._makeLayer(WORLD_W, CANVAS_H);
      this.decalUsed = this.decalUsed || [false, false, false];
      this.decalUsed[l] = false;
      this.corpseCount[l] = 0;
    }
    const rng = seeded(map.seed);
    this.clouds = [];
    for (let i = 0; i < 8; i++) {
      this.clouds.push({ x: rng() * WORLD_W, y: 40 + rng() * 140, w: 90 + rng() * 160, sp: 3 + rng() * 6, a: 0.05 + rng() * 0.1 });
    }
    // foreground occlusion plants along the bottom edge (fast parallax = depth)
    this.fgPlants = [];
    const kinds = ['tuft', 'fern', 'bush', 'plant', 'tuft', 'bush'];
    let px = 60 + rng() * 120;
    while (px < WORLD_W * 1.02) {
      this.fgPlants.push({
        x: px, kind: kinds[Math.floor(rng() * kinds.length)],
        i: Math.floor(rng() * 4), w: 72 + rng() * 60, flip: rng() < 0.5,
      });
      px += 170 + rng() * 240;
    }
  },

  _drawForeground(ctx, camX) {
    // drawn inside the world transform; extra 12% shift makes it float closer
    for (const p of this.fgPlants) {
      const dx = p.x * 1.12 - 0.12 * camX;
      if (dx < camX - 90 || dx > camX + CANVAS_W + 90) continue;
      drawTex(ctx, p.kind, p.i, dx, CANVAS_H - 36, p.w, { alpha: 0.96, flip: p.flip });
    }
  },

  _drawSkyBase(ctx, map) {
    const p = map.pal;
    const g = ctx.createLinearGradient(0, 0, 0, 460);
    g.addColorStop(0, p.skyTop);
    g.addColorStop(1, p.skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, 460);
    const s = p.sun;
    const sg = ctx.createRadialGradient(s.x, s.y, 4, s.x, s.y, s.r * 3);
    sg.addColorStop(0, s.color);
    sg.addColorStop(0.35, s.color);
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 3, 0, 7); ctx.fill();
  },

  _drawFar(ctx, map, w) {
    const rng = seeded(map.seed + 7);
    // painted mountain silhouettes on the horizon, then the procedural ridges
    let mx = -80 + rng() * 100;
    while (mx < w + 220) {
      const mw = 340 + rng() * 260;
      drawTex(ctx, 'mtn', Math.floor(rng() * 3), mx, 288 + rng() * 18, mw, { alpha: 0.9 });
      mx += mw * (0.55 + rng() * 0.3);
    }
    this._ridge(ctx, rng, w, 260, 70, map.pal.hillFar, 0.85);
    this._ridge(ctx, rng, w, 300, 55, map.pal.hillNear, 1);
    // pull everything into the map's light
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = map.pal.hillFar;
    ctx.fillRect(0, 0, w, CANVAS_H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },

  _drawMid(ctx, map, w) {
    // dark canopy wall behind the top lane — reads as depth when it parallaxes
    const rng = seeded(map.seed + 13);
    const col = this._shade(map.pal.tree, -10);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, 420);
    let y = 330 + rng() * 20;
    ctx.lineTo(0, y);
    for (let x = 0; x <= w; x += 26) {
      const ny = 322 + rng() * 34;
      ctx.quadraticCurveTo(x + 9, y - 14 - rng() * 16, x + 26, ny);
      y = ny;
    }
    ctx.lineTo(w, 420);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // textured jungle line riding the canopy crest + distant settlements/paddies
    let tx = -60 + rng() * 80;
    while (tx < w + 180) {
      const tw = 220 + rng() * 160;
      drawTex(ctx, 'treeline', Math.floor(rng() * 4), tx, 354 + rng() * 10, tw, { alpha: 0.85 });
      tx += tw * 0.86;
    }
    if (map.id !== 'khesanh' && map.id !== 'hill937') {
      for (let k = 0; k < 3; k++) {
        drawTex(ctx, 'villageSil', k, (0.16 + 0.3 * k + rng() * 0.1) * w, 358, 150 + rng() * 60, { alpha: 0.8 });
      }
    }
    if (map.id === 'mekong') {
      // far paddies gleaming below the treeline
      for (let k = 0; k < 5; k++) {
        const px = (0.08 + 0.19 * k + rng() * 0.06) * w;
        ctx.save();
        ctx.translate(px, 398 + (k % 2) * 9);
        ctx.scale(1, 0.55);
        drawTex(ctx, 'paddy', k, 0, 0, 130 + rng() * 50, { alpha: 0.5 });
        ctx.restore();
      }
    }
    // unify with the palette
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, w, CANVAS_H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },

  _ridge(ctx, rng, w, baseY, amp, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H);
    let y = baseY + (rng() - 0.5) * amp;
    ctx.lineTo(0, y);
    for (let x = 0; x <= w; x += 64) {
      const ny = baseY + (rng() - 0.5) * amp * 2;
      ctx.quadraticCurveTo(x + 20, y, x + 64, ny);
      y = ny;
    }
    ctx.lineTo(w, CANVAS_H);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  },

  /* ---------- lane terrain (static, WORLD_W wide) ---------- */
  _buildLane(game, lane) {
    const map = game.map, p = map.pal;
    let c = this.laneLayers[lane];
    if (!c || c.width !== WORLD_W) c = this._makeLayer(WORLD_W, CANVAS_H);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, WORLD_W, CANVAS_H);
    const rng = seeded(map.seed + lane * 131);

    // slab
    ctx.fillStyle = p.laneBody[lane];
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H);
    ctx.lineTo(0, groundY(map, lane, 0));
    for (let x = 0; x <= WORLD_W; x += 16) ctx.lineTo(x, groundY(map, lane, x));
    ctx.lineTo(WORLD_W, CANVAS_H);
    ctx.closePath(); ctx.fill();

    // soil texture: speckles + faint strata under the surface
    ctx.save();
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < WORLD_W / 6; i++) {
      const x = rng() * WORLD_W;
      const y = groundY(map, lane, x) + 6 + rng() * 60;
      ctx.fillStyle = rng() < 0.5 ? '#000' : '#fff';
      ctx.fillRect(x, y, 1.6 + rng() * 2, 1 + rng());
    }
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    for (let s = 1; s <= 3; s++) {
      ctx.beginPath();
      for (let x = 0; x <= WORLD_W; x += 32) {
        const y = groundY(map, lane, x) + 14 + s * 16 + Math.sin(x * 0.01 + s) * 3;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    /* Surface treatment driven by the ground's own slope. Now that the terrain
     * actually rolls, a single flat fill reads as cardboard: turf stands up on
     * the level, steep ground is scoured back to earth and stone, and water
     * collects in the hollows. All derived from groundY, so it tracks the
     * elevation profile exactly and costs nothing at runtime. */
    ctx.save();
    for (let x = 0; x < WORLD_W; x += 7) {
      const y0 = groundY(map, lane, x);
      const slope = (groundY(map, lane, x + 12) - y0) / 12;
      if (Math.abs(slope) > 0.14) {
        ctx.globalAlpha = 0.14 + rng() * 0.12;
        ctx.fillStyle = this._shade(p.laneBody[lane], -18);
        ctx.fillRect(x, y0 + 1, 7 + rng() * 6, 3 + rng() * 6);
        if (rng() < 0.16) {
          ctx.globalAlpha = 0.34;
          ctx.fillStyle = '#4a4a42';
          ctx.fillRect(x + rng() * 5, y0 + 2 + rng() * 6, 2 + rng() * 3, 1.5 + rng() * 2);
        }
      } else if (rng() < 0.36) {
        ctx.globalAlpha = 0.28 + rng() * 0.22;
        ctx.strokeStyle = this._shade(p.laneTop[lane], 18);
        ctx.lineWidth = 1;
        const h = 2 + rng() * 4;
        ctx.beginPath();
        ctx.moveTo(x, y0 + 1);
        ctx.lineTo(x + (rng() - 0.5) * 3, y0 + 1 - h);
        ctx.stroke();
      }
      // a hollow: ground lower here than either side, so it holds water
      const yl = groundY(map, lane, x - 26), yr = groundY(map, lane, x + 26);
      if (y0 > yl + 2.5 && y0 > yr + 2.5 && rng() < 0.5) {
        ctx.globalAlpha = 0.26;
        ctx.fillStyle = '#5c7d86';
        ctx.beginPath();
        ctx.ellipse(x, y0 + 2, 16 + rng() * 22, 2.4 + rng() * 1.8, 0, 0, 7);
        ctx.fill();
      }
    }
    ctx.restore();

    // dirt trail with wheel ruts along the lane
    ctx.save();
    const trailCol = this._shade(p.laneTop[lane], 10);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = trailCol;
    ctx.beginPath();
    ctx.moveTo(0, groundY(map, lane, 0) + 3);
    for (let x = 0; x <= WORLD_W; x += 16) ctx.lineTo(x, groundY(map, lane, x) + 3 + Math.sin(x * 0.008 + lane) * 1.5);
    for (let x = WORLD_W; x >= 0; x -= 16) ctx.lineTo(x, groundY(map, lane, x) + 11 + Math.sin(x * 0.011 + lane) * 1.5);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = this._shade(p.laneBody[lane], -18);
    ctx.lineWidth = 1.3;
    for (const off of [5.5, 8.5]) {
      ctx.beginPath();
      for (let x = 0; x <= WORLD_W; x += 20) {
        const y = groundY(map, lane, x) + off + Math.sin(x * 0.009 + lane) * 1.4;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // surface band
    ctx.strokeStyle = p.laneTop[lane];
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, groundY(map, lane, 0) + 2);
    for (let x = 0; x <= WORLD_W; x += 16) ctx.lineTo(x, groundY(map, lane, x) + 2);
    ctx.stroke();

    // water paddies with dikes and rice rows (delta)
    if (p.water) {
      for (let x = 0; x <= WORLD_W - 16; x += 16) {
        if (elevAt(map, lane, x) < 0.085) {
          const y = groundY(map, lane, x);
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = p.water;
          ctx.fillRect(x, y + 3, 17, 6);
          ctx.globalAlpha = 0.35;
          ctx.fillRect(x + rng() * 8, y + 10, 10, 1.4);
          // rice sprout rows
          ctx.globalAlpha = 0.7;
          ctx.strokeStyle = '#5f7a2e';
          ctx.lineWidth = 1;
          for (let sx = x + 3; sx < x + 16; sx += 5) {
            ctx.beginPath(); ctx.moveTo(sx, y + 6); ctx.lineTo(sx + 0.6, y + 2.5); ctx.stroke();
          }
          ctx.globalAlpha = 1;
          // dike wall where the paddy ends
          if (elevAt(map, lane, x + 16) >= 0.085) {
            ctx.fillStyle = this._shade(p.laneBody[lane], -14);
            ctx.fillRect(x + 15, y - 1, 4, 9);
          }
        }
      }
    }

    // grass tufts
    ctx.strokeStyle = p.laneTop[lane];
    ctx.lineWidth = 1.2;
    for (let x = 6; x < WORLD_W; x += 8 + rng() * 9) {
      const y = groundY(map, lane, x) + 1;
      const h = 3 + rng() * 4;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 3, y - h);
      ctx.stroke();
    }

    // concealment brush or burn scars
    const zones = game.conceal[lane];
    for (const z of zones) {
      const x0 = z.x0 * WORLD_W, x1 = z.x1 * WORLD_W;
      if (z.burned) {
        ctx.fillStyle = 'rgba(20,16,10,0.55)';
        for (let x = x0; x < x1; x += 14) {
          const y = groundY(map, lane, x);
          ctx.fillRect(x, y - 1, 12, 6);
        }
        ctx.strokeStyle = '#1a140c'; ctx.lineWidth = 1.6;
        for (let x = x0 + 4; x < x1; x += 16 + rng() * 12) {
          const y = groundY(map, lane, x);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 4, y - (4 + rng() * 6)); ctx.stroke();
        }
      } else {
        for (let x = x0; x < x1; x += 6 + rng() * 7) {
          const y = groundY(map, lane, x) + 1;
          const h = 10 + rng() * 13;
          ctx.strokeStyle = rng() < 0.6 ? p.brush : this._shade(p.brush, -14);
          ctx.lineWidth = 1.6 + rng();
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + (rng() - 0.5) * 8, y - h * 0.6, x + (rng() - 0.5) * 10, y - h);
          ctx.stroke();
          // broadleaf accents
          if (rng() < 0.18) {
            ctx.fillStyle = this._shade(p.brush, -8);
            ctx.beginPath();
            ctx.ellipse(x + (rng() - 0.5) * 6, y - h * 0.7, 4 + rng() * 3, 1.6 + rng(), (rng() - 0.5), 0, 7);
            ctx.fill();
          }
        }
      }
    }

    // trees (density scaled to the wider world)
    const density = map.treeDensity * 26 * (WORLD_W / 1280);
    for (let i = 0; i < density; i++) {
      const x = 150 + rng() * (WORLD_W - 300);
      const nearFlag = Math.abs(x - map.flags[lane] * WORLD_W) < 46;
      if (nearFlag) continue;
      /* Profile-rendered palms take priority over the painted kit. They come off
       * the same orthographic camera as the soldiers, so the treeline stops being
       * a different drawing from the men standing in it. Four variants, mirrored
       * at random, sized off each prop's authored real height. */
      if (typeof Props !== 'undefined' && Props.ready &&
          (map.trees === 'palm' || map.trees === 'jungle')) {
        // sparse: a palm is ~4x a man's height, so even a few fill the frame
        const chance = map.trees === 'palm' ? 0.20 : 0.10;
        if (rng() < chance) {
          const pick = ['palm_a', 'palm_b', 'palm_c', 'palm_d'][(rng() * 4) | 0];
          if (Props.has(pick)) {
            const gy = groundY(map, lane, x) + 2;
            // a stand of palms is not a row of clones — vary the height a little
            const h = Props.pxHeight(pick, LANE_DEPTH[lane]) * (0.72 + rng() * 0.40);
            Props.draw(ctx, pick, x, gy, LANE_DEPTH[lane],
              { fit: h, flip: rng() < 0.5, alpha: 0.92 });
            continue;
          }
        }
      }
      // painted palms/banana groves mix into the procedural treeline
      if (map.trees === 'palm' && rng() < 0.4 && drawTex(ctx, rng() < 0.6 ? 'palm' : 'banana',
          Math.floor(rng() * 3), x, groundY(map, lane, x) + 2, (34 + rng() * 22) * LANE_DEPTH[lane])) continue;
      if (map.trees === 'jungle' && rng() < 0.25 && drawTex(ctx, 'banana',
          Math.floor(rng() * 3), x, groundY(map, lane, x) + 2, (28 + rng() * 18) * LANE_DEPTH[lane])) continue;
      this._tree(ctx, map, rng, x, groundY(map, lane, x) + 2, LANE_DEPTH[lane]);
    }

    // painted ground vegetation baked into the lane
    const vegN = 10 + map.treeDensity * 14;
    for (let i = 0; i < vegN * (WORLD_W / 1280); i++) {
      const x = 120 + rng() * (WORLD_W - 240);
      if (Math.abs(x - map.flags[lane] * WORLD_W) < 60) continue;
      const kind = ['tuft', 'bush', 'fern', 'tuft'][Math.floor(rng() * 4)];
      drawTex(ctx, kind, Math.floor(rng() * 4), x, groundY(map, lane, x) + 2,
        (14 + rng() * 20) * LANE_DEPTH[lane], { alpha: 0.92, flip: rng() < 0.5 });
    }

    // base dressing: watchtower over the US end, village gate at the VC end
    if (lane === 1) {
      drawTex(ctx, 'watchtower', 0, 88, groundY(map, lane, 88) + 2, 56 * LANE_DEPTH[lane]);
      drawTex(ctx, 'gate', 0, WORLD_W - 92, groundY(map, lane, WORLD_W - 92) + 2, 48 * LANE_DEPTH[lane]);
    }

    // rock outcrops on high ground
    for (let x = 200; x < WORLD_W - 200; x += 90 + rng() * 160) {
      if (elevAt(map, lane, x) > 0.45 && rng() < 0.5) {
        const y = groundY(map, lane, x) + 2;
        const s = 4 + rng() * 7;
        ctx.fillStyle = this._shade(p.laneBody[lane], 26);
        ctx.beginPath();
        ctx.moveTo(x - s, y);
        ctx.lineTo(x - s * 0.4, y - s * 0.9);
        ctx.lineTo(x + s * 0.5, y - s * 0.7);
        ctx.lineTo(x + s, y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.moveTo(x + s * 0.5, y - s * 0.7); ctx.lineTo(x + s, y); ctx.lineTo(x - s * 0.1, y);
        ctx.closePath(); ctx.fill();
      }
    }

    // pre-battle craters on shattered ground
    if (map.trees === 'shattered') {
      for (let i = 0; i < 7; i++) {
        const x = 300 + rng() * (WORLD_W - 600);
        const y = groundY(map, lane, x);
        const s = 8 + rng() * 14;
        ctx.fillStyle = 'rgba(18,14,9,0.45)';
        ctx.beginPath(); ctx.ellipse(x, y + 2, s, s * 0.3, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(60,48,30,0.4)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(x, y + 1, s * 1.1, s * 0.34, 0, Math.PI, 0); ctx.stroke();
      }
    }

    this._usBaseWorks(ctx, map, lane, rng);
    this._vcBaseWorks(ctx, map, lane, rng);

    // near-lane depth tint
    if (lane === 2) {
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.beginPath();
      ctx.moveTo(0, CANVAS_H); ctx.lineTo(0, groundY(map, lane, 0));
      for (let x = 0; x <= WORLD_W; x += 16) ctx.lineTo(x, groundY(map, lane, x));
      ctx.lineTo(WORLD_W, CANVAS_H); ctx.closePath(); ctx.fill();
    }

    this.laneLayers[lane] = c;
    this.dirty[lane] = false;
  },

  _sandbags(ctx, x, y, rows, perRow, rng) {
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < perRow - (r % 2); i++) {
        ctx.fillStyle = r % 2 ? '#94825e' : '#8a7a58';
        ctx.beginPath();
        ctx.ellipse(x + i * 11 + (r % 2) * 5, y - 3 - r * 5.4, 6, 3.2, 0, 0, 7);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  },

  _usBaseWorks(ctx, map, lane, rng) {
    const gy = groundY(map, lane, 40);
    // sandbag emplacement
    this._sandbags(ctx, 14, gy, 3, 5, rng);
    // tent behind
    const ty = groundY(map, lane, 96);
    ctx.fillStyle = '#5a6148';
    ctx.beginPath();
    ctx.moveTo(78, ty); ctx.lineTo(96, ty - 16); ctx.lineTo(114, ty); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(96, ty - 16); ctx.lineTo(114, ty); ctx.lineTo(104, ty); ctx.closePath(); ctx.fill();
    // crates
    ctx.fillStyle = '#6b5a38';
    ctx.fillRect(120, ty - 7, 9, 7);
    ctx.fillRect(131, ty - 5, 7, 5);
    if (lane === 1) {
      // watchtower
      const tx = 62, tyy = groundY(map, lane, tx);
      ctx.strokeStyle = '#4a3f2c'; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(tx - 8, tyy); ctx.lineTo(tx - 6, tyy - 34);
      ctx.moveTo(tx + 8, tyy); ctx.lineTo(tx + 6, tyy - 34);
      ctx.moveTo(tx - 8, tyy - 12); ctx.lineTo(tx + 8, tyy - 16);
      ctx.stroke();
      ctx.fillStyle = '#55492f';
      ctx.fillRect(tx - 10, tyy - 40, 20, 7);
      ctx.fillStyle = '#3d3524';
      ctx.beginPath();
      ctx.moveTo(tx - 12, tyy - 40); ctx.lineTo(tx, tyy - 48); ctx.lineTo(tx + 12, tyy - 40);
      ctx.closePath(); ctx.fill();
    }
    if (lane === 0) {
      // radio mast
      const mx = 30, my = groundY(map, lane, mx);
      ctx.strokeStyle = '#2c2c28'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - 3, my - 42); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx - 3, my - 42); ctx.lineTo(mx + 6, my - 30); ctx.stroke();
    }
  },

  _vcBaseWorks(ctx, map, lane, rng) {
    const bx = WORLD_W - 60;
    const gy = groundY(map, lane, bx);
    // hooch on stilts with thatch roof
    ctx.strokeStyle = '#4a3c26'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx - 14, gy); ctx.lineTo(bx - 14, gy - 10);
    ctx.moveTo(bx + 14, gy); ctx.lineTo(bx + 14, gy - 10);
    ctx.stroke();
    ctx.fillStyle = '#5c4a2e';
    ctx.fillRect(bx - 17, gy - 16, 34, 7);
    ctx.fillStyle = '#8a7443';
    ctx.beginPath();
    ctx.moveTo(bx - 21, gy - 15); ctx.lineTo(bx, gy - 30); ctx.lineTo(bx + 21, gy - 15);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(bx - 21 + i * 5, gy - 15 - i * 2.8);
      ctx.lineTo(bx + 21 - i * 5, gy - 15 - i * 2.8);
      ctx.stroke();
    }
    // mound + posts (tunnel head)
    const my = groundY(map, lane, WORLD_W - 26);
    ctx.fillStyle = '#3a3222';
    ctx.beginPath(); ctx.ellipse(WORLD_W - 26, my - 2, 16, 6, 0, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = '#2c2618'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WORLD_W - 40, my); ctx.lineTo(WORLD_W - 40, my - 12);
    ctx.moveTo(WORLD_W - 12, my); ctx.lineTo(WORLD_W - 12, my - 12);
    ctx.stroke();
    // rice baskets
    ctx.fillStyle = '#7a6538';
    ctx.beginPath(); ctx.ellipse(bx - 30, gy - 3, 4, 3.4, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx - 38, gy - 2.4, 3.2, 2.8, 0, 0, 7); ctx.fill();
  },

  _shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  },

  _tree(ctx, map, rng, x, y, depth) {
    const t = map.trees, col = map.pal.tree;
    const s = depth * (0.7 + rng() * 0.55);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = col; ctx.fillStyle = col;
    if (t === 'palm') {
      const lean = (rng() - 0.5) * 16;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(lean * 0.4, -30, lean, -52); ctx.stroke();
      ctx.lineWidth = 2.4;
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i - 2.5) * 0.42;
        ctx.beginPath();
        ctx.moveTo(lean, -52);
        ctx.quadraticCurveTo(lean + Math.cos(a) * 14, -52 + Math.sin(a) * 14 - 4, lean + Math.cos(a) * 24, -52 + Math.sin(a) * 24 + 7);
        ctx.stroke();
      }
    } else if (t === 'jungle') {
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo((rng() - 0.5) * 6, -34); ctx.stroke();
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse((rng() - 0.5) * 26, -36 - rng() * 18, 13 + rng() * 12, 9 + rng() * 7, 0, 0, 7);
        ctx.fill();
      }
    } else if (t === 'shattered') {
      ctx.lineWidth = 3.4;
      const lean = (rng() - 0.5) * 22;
      const h = 20 + rng() * 26;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(lean, -h); ctx.stroke();
      if (rng() < 0.6) {
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(lean * 0.6, -h * 0.6); ctx.lineTo(lean * 0.6 + 10, -h * 0.6 - 6); ctx.stroke();
      }
    } else {
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(2, -26); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(2, -30, 18, 6, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
  },

  /* ---------- baked decals (persistent battlefield state) ---------- */
  bakeDecal(map, lane, x, type, size) {
    if (this.decalUsed) this.decalUsed[lane] = true;
    const layer = this.decalLayers[lane];
    if (!layer) return;
    const ctx = layer.getContext('2d');
    const y = groundY(map, lane, x);
    if (type === 'crater') {
      ctx.fillStyle = 'rgba(18,14,9,0.6)';
      ctx.beginPath(); ctx.ellipse(x, y + 2, size, size * 0.32, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(60,48,30,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y + 1, size * 1.1, size * 0.36, 0, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = 'rgba(40,32,20,0.5)';
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(x + rand(-size * 1.6, size * 1.6), y + rand(-2, 5), rand(1, 2.5), rand(1, 2));
      }
    } else if (type === 'scorch') {
      ctx.fillStyle = 'rgba(12,10,7,0.5)';
      ctx.beginPath(); ctx.ellipse(x, y + 2, size, size * 0.22, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(8,7,5,0.35)';
      for (let i = 0; i < 8; i++) {
        const px = x + rand(-size, size);
        ctx.beginPath(); ctx.ellipse(px, y + rand(0, 4), rand(3, 9), rand(1, 2.4), 0, 0, 7); ctx.fill();
      }
    } else if (type === 'blood') {
      ctx.fillStyle = 'rgba(90,26,16,0.5)';
      ctx.beginPath(); ctx.ellipse(x + rand(-2, 2), y + 3, size, size * 0.3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(70,18,10,0.55)';
      ctx.beginPath(); ctx.ellipse(x, y + 3, size * 0.5, size * 0.16, 0, 0, 7); ctx.fill();
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(x + rand(-size * 1.8, size * 1.8), y + rand(0, 5), rand(0.8, 2), rand(0.8, 1.6));
      }
    } else if (type === 'casing') {
      ctx.fillStyle = 'rgba(176,141,62,0.85)';
      ctx.fillRect(x, y + rand(1, 4), 1.8, 0.9);
    } else if (type === 'drip') {
      ctx.fillStyle = 'rgba(90,24,14,0.5)';
      ctx.beginPath(); ctx.ellipse(x, y + 2, rand(0.8, 1.6), rand(0.5, 0.9), 0, 0, 7); ctx.fill();
    } else if (type === 'splatter') {
      ctx.fillStyle = 'rgba(80,20,12,0.55)';
      ctx.beginPath(); ctx.ellipse(x, y + 3, size * 1.3, size * 0.4, 0, 0, 7); ctx.fill();
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = `rgba(${70 + rand(0, 30)},20,12,${rand(0.35, 0.6)})`;
        ctx.beginPath();
        ctx.ellipse(x + rand(-size * 2.4, size * 2.4), y + rand(-1, 6), rand(1, 3.4), rand(0.7, 1.6), 0, 0, 7);
        ctx.fill();
      }
      // scattered dark fragments — kept abstract
      ctx.fillStyle = 'rgba(40,34,26,0.7)';
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(x + rand(-size * 2, size * 2), y + rand(-2, 4), rand(1.4, 3), rand(1, 2));
      }
    }
  },

  bakeCorpse(map, u, opts = {}) {
    const layer = this.decalLayers[u.lane];
    if (!layer) return;
    if (this.decalUsed) this.decalUsed[u.lane] = true;
    if (this.corpseCount[u.lane] > 60) return;
    this.corpseCount[u.lane]++;
    const ctx = layer.getContext('2d');
    const scale = LANE_DEPTH[u.lane] * (u.sj || 1);
    this.bakeDecal(map, u.lane, u.x, 'blood', 7 * scale);
    if (opts.gibbed) {
      this.bakeDecal(map, u.lane, u.x, 'splatter', 6 * scale);
      return;
    }
    // rigged puppet corpse — the fallen pose, baked in place
    if (typeof Sprite3D !== 'undefined' && Sprite3D.enabled && Sprite3D.has(u.key)) {
      Sprite3D.drawCorpse(ctx, u.key,
        { x: u.x, y: u.y + 1, dir: u.dir, scale, wounded: u.wounded });
    } else if (typeof Rig !== 'undefined' && Rig.enabled) {
      Rig.drawCorpse(ctx, u.key, { x: u.x, y: u.y + 1, dir: u.dir, scale, wounded: u.wounded });
      return;
    }
    const sk = UNIT_SPRITES[u.key];
    const sheet = (typeof Assets !== 'undefined') && Assets.done && sk ? Assets.sheet(sk) : null;
    if (sheet) {
      // the corpse matches the last frame of the death sequence he just played
      const dAnim = !u.wounded && DEATH_ANIMS[sk];
      const dSeq = dAnim && Assets.anim(dAnim);
      let name = sheet.poses.fallen, s = spriteScaleFor(u.key, sheet, scale);
      if (dSeq && dSeq.length) {
        name = dSeq[dSeq.length - 1];
        const am = Assets.animMeta(dAnim);
        if (am && am.standH) s = (SPRITE_STAND_H / am.standH) * scale;
      }
      const img = Assets.img(name), m = Assets.meta(name);
      if (img && m) {
        ctx.save();
        ctx.translate(u.x, u.y + 1);
        ctx.rotate(rand(-0.05, 0.05));
        ctx.scale(u.dir * s, s);
        ctx.globalAlpha = 0.88;
        ctx.drawImage(img, -m.ax, -m.ay);
        ctx.restore();
        return;
      }
    }
    // vector fallback corpse
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = SOLDIER_COLORS[u.key] ? SOLDIER_COLORS[u.key].coat : '#3a4230';
    ctx.beginPath(); ctx.ellipse(0, -2, 11 * scale, 3.2 * scale, 0, 0, 7); ctx.fill();
    ctx.restore();
  },

  /* ---------- per-frame ---------- */
  render(game, ui, time) {
    const ctx = this.ctx, map = game.map, fx = game.fx;
    const camX = Camera.x;
    this._fdt = clamp(time - (this._lastT || time), 0, 0.05);
    this._time = time;   // muzzlePoint needs the same clock the unit draw used
    this._perfSample(time);
    this._adaptScale(this._fdt || 0.016);
    // time of day is a map property; night changes how light is composited
    this._night = map.tod === 'night';
    this._nightK = this._night ? 0.88 : 0;
    this._lights = this._night ? [] : this._lights;
    if (this._night) this._lights.length = 0;
    this._lastT = time;
    this._ui = ui;
    const K = this._k || 1;
    ctx.setTransform(K, 0, 0, K, 0, 0);
    ctx.imageSmoothingEnabled = true;
    // 'high' forces a much slower resample on every scaled blit. Sprites are
    // downscales of already-antialiased renders, so bilinear is indistinguishable
    // here and materially cheaper.
    ctx.imageSmoothingQuality = 'low';
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    /* Sky and parallax. The parallax layers are wider than the screen, and
     * blitting them whole made the driver sample ~2.5 megapixels a frame that
     * were then thrown away off-screen. Source-rect them to the visible window,
     * exactly as the lane layers already do. */
    ctx.drawImage(this.sky, 0, 0);
    this._blitStrip(ctx, this.farLayer, camX * this.FAR_PARA);
    this._drawClouds(ctx, time, camX);
    this._blitStrip(ctx, this.midLayer, camX * this.MID_PARA);

    ctx.save();
    let shx = 0, shy = 0;
    if (fx.shake > 0.2) {
      // biased along the blast direction rather than pure noise — a shell that
      // lands to your left should shove the camera left
      const b = fx.shake * 0.62, j = fx.shake * 0.38;
      shx = (fx.shakeX || 0) * b + rand(-j, j);
      shy = (fx.shakeY || 0) * b + rand(-j, j);
    }
    ctx.translate(-camX + shx, shy);

    const sx = Math.max(0, Math.floor(camX) - 8), sw = Math.min(WORLD_W - sx, CANVAS_W + 16);
    for (let lane = 0; lane < 3; lane++) {
      if (this.dirty[lane]) this._buildLane(game, lane);
      ctx.drawImage(this.laneLayers[lane], sx, 0, sw, CANVAS_H, sx, 0, sw, CANVAS_H);
      // an untouched decal layer is transparent — skip the full-screen blit
      if (this.decalUsed && this.decalUsed[lane]) {
        ctx.drawImage(this.decalLayers[lane], sx, 0, sw, CANVAS_H, sx, 0, sw, CANVAS_H);
      }
      if (ui && ui.hoverLane === lane && (ui.armedUnit || ui.armedCallin)) {
        this._laneGlow(ctx, game, lane, time, sx, sw);
      }
      this._drawStructures(ctx, game, lane, time);
      this._drawCovers(ctx, game, lane, time);
      this._drawEmplacements(ctx, game, lane, time);
      this._drawFlag(ctx, game, lane, time);
      this._drawUnits(ctx, game, lane, time);
      this._drawNades(ctx, game, lane);
      this._drawSquadMarkers(ctx, game, lane, time);
      this._drawRank(ctx, game, lane);
      this._drawFires(ctx, game, lane, time);
      this._drawSmoke(ctx, game, lane, time);
      this._laneHaze(ctx, map, lane);
    }

    this._drawStrikes(ctx, game, time);
    this._drawParticles(ctx, fx, camX);
    this._drawForeground(ctx, camX);
    this._drawNight(ctx, game, map);
    if (ui) this._drawTargeting(ctx, game, ui);
    this._drawFloaters(ctx, fx);
    ctx.restore();

    this._drawWeather(ctx, map, time);
    if (map.pal.haze) {
      ctx.fillStyle = map.pal.haze;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
    /* Colour grade. Warm lift in the highlights, cool weight in the shadows —
     * the cheapest way to make a frame read as one photograph rather than a set
     * of separately-drawn layers. Two blends, no per-pixel work. */
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = this._night ? 'rgba(150,164,200,0.10)' : 'rgba(214,206,178,0.16)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.globalCompositeOperation = 'lighter';
    const gg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    if (this._night) {
      gg.addColorStop(0, 'rgba(28,44,92,0.10)');
      gg.addColorStop(1, 'rgba(10,16,34,0.06)');
    } else {
      gg.addColorStop(0, 'rgba(96,74,36,0.13)');
      gg.addColorStop(0.55, 'rgba(40,36,22,0.04)');
      gg.addColorStop(1, 'rgba(18,26,40,0.09)');
    }
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
    if (fx.flash > 0) {
      ctx.fillStyle = `rgba(255,220,150,${fx.flash})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
    // vignette
    const v = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H * 0.46, CANVAS_H * 0.5, CANVAS_W / 2, CANVAS_H * 0.5, CANVAS_H * 1.0);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    this.drawMinimap(game);
    if (this.showPerf) this._drawPerf(ctx, game);
  },

  _drawClouds(ctx, time, camX) {
    for (const c of this.clouds) {
      const wx = (c.x + time * c.sp) % (WORLD_W + 400) - 200;
      const x = wx - camX * 0.2;
      if (x < -300 || x > CANVAS_W + 300) continue;
      ctx.fillStyle = `rgba(255,255,250,${c.a})`;
      ctx.beginPath();
      ctx.ellipse(x, c.y, c.w, c.w * 0.22, 0, 0, 7);
      ctx.ellipse(x + c.w * 0.4, c.y - 8, c.w * 0.55, c.w * 0.16, 0, 0, 7);
      ctx.fill();
    }
  },

  /* ---------- cover positions ---------- */
  _drawCovers(ctx, game, lane, time) {
    const map = game.map;
    const depth = LANE_DEPTH[lane];
    for (const c of game.covers[lane]) {
      if (!Camera.sees(c.x, c.w + 50)) continue;
      if (c.type === 'rubble' || c.type === 'towerpos' || c.type === 'nestpos') continue; // structure art carries these
      if (c.type === 'window') {
        /* A firing port cut into the building behind the man. Drawn between the
         * structures pass and the units pass, so the dark opening lands on the
         * wall and the soldier holding it stands out against it — previously a
         * squad in a building was audible but invisible. */
        const st = c.structRef;
        if (st && st.state === 2) continue;
        const y = groundY(map, lane, c.x) - (c.lift || 0) * depth;
        const w = c.w * 0.78 * depth, h = 21 * depth;
        ctx.save();
        ctx.fillStyle = 'rgba(12,10,7,0.80)';
        ctx.fillRect(c.x - w / 2, y - h - 10 * depth, w, h);
        // sill and lintel, so it reads as an opening rather than a smudge
        ctx.fillStyle = 'rgba(38,29,18,0.95)';
        ctx.fillRect(c.x - w / 2 - 1.5 * depth, y - 10 * depth, w + 3 * depth, 2.6 * depth);
        ctx.fillRect(c.x - w / 2 - 1.5 * depth, y - h - 12 * depth, w + 3 * depth, 2.2 * depth);
        if (c.occ) {
          // muzzle-lit interior while the position is manned
          ctx.fillStyle = 'rgba(255,190,110,0.10)';
          ctx.fillRect(c.x - w / 2, y - h - 10 * depth, w, h);
        }
        ctx.restore();
        continue;
      }
      if (c.type === 'hide') {
        // a prepared firing position dug into the brush
        const y = groundY(map, lane, c.x);
        ctx.save();
        ctx.translate(c.x, y);
        ctx.scale(LANE_DEPTH[lane], LANE_DEPTH[lane]);
        ctx.fillStyle = 'rgba(22,30,16,0.55)';
        ctx.beginPath(); ctx.ellipse(0, -1, c.w / 2, 4, 0, 0, 7); ctx.fill();
        if (!drawTex(ctx, 'bush', Math.floor(c.x), -4, 2, c.w * 1.15) ) {
          ctx.fillStyle = map.pal.brush;
          for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.ellipse(i * 7, -7 - (i % 2 ? 3 : 0), 8, 6, 0, 0, 7);
            ctx.fill();
          }
        }
        drawTex(ctx, 'bush', Math.floor(c.x) + 3, 12, 1, c.w * 0.8, { flip: true, alpha: 0.95 });
        ctx.restore();
        continue;
      }
      const y = groundY(map, lane, c.x);
      ctx.save();
      ctx.translate(c.x, y);
      ctx.scale(depth, depth);
      const rng = seeded((map.seed + c.x * 13) >>> 0);
      if (c.type === 'sandbag') {
        /* Profile-rendered sandbags first. Cover is on screen constantly, so it
         * is one of the loudest places the old 3/4-view kit showed next to
         * profile soldiers. Drawn at scale 1 because this context is already
         * scaled by lane depth. */
        if (typeof Props !== 'undefined' && Props.ready) {
          const pn = (Math.floor(c.x / 37) % 2) ? 'sandbag_wall' : 'sandbags_pile';
          if (Props.has(pn) &&
              Props.draw(ctx, pn, 0, 0, 1, { flip: (Math.floor(c.x / 53) % 2) === 1 })) {
            ctx.restore();
            continue;
          }
        }
        if (!drawTex(ctx, 'sandbags', Math.floor(c.x), 0, 1, c.w * 1.8)) {
          for (let r = 0; r < 2; r++) {
            for (let i = 0; i < 4 - r; i++) {
              ctx.fillStyle = (i + r) % 2 ? '#8a7a58' : '#7d6e4e';
              ctx.beginPath();
              ctx.ellipse(-12 + i * 8 + r * 4, -2.6 - r * 4.4, 4.4, 2.5, 0, 0, 7);
              ctx.fill();
            }
          }
        }
      } else if (c.type === 'log') {
        ctx.fillStyle = 'rgba(40,32,20,0.9)';
        ctx.beginPath(); ctx.ellipse(0, -1, c.w / 2, 3.4, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#4a3a24';
        ctx.fillRect(-c.w / 2, -6.5, c.w, 4.4);
        ctx.fillStyle = '#3a2d1c';
        ctx.beginPath(); ctx.ellipse(-c.w / 2, -4.3, 2.2, 2.2, 0, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(c.w / 2, -4.3, 2.2, 2.2, 0, 0, 7); ctx.fill();
      } else if (c.type === 'dike') {
        if (!drawTex(ctx, 'dike', Math.floor(c.x), 0, 1, c.w * 1.7)) {
          ctx.fillStyle = '#6d6034';
          ctx.beginPath();
          ctx.moveTo(-c.w / 2 - 5, 0);
          ctx.quadraticCurveTo(0, -9, c.w / 2 + 5, 0);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(120,130,60,0.8)'; ctx.lineWidth = 1.2;
          for (let i = -2; i <= 2; i++) {
            ctx.beginPath(); ctx.moveTo(i * 7, -5.5); ctx.lineTo(i * 7 + rng() * 2 - 1, -9); ctx.stroke();
          }
        }
      } else if (c.type === 'crater') {
        ctx.fillStyle = 'rgba(18,14,9,0.55)';
        ctx.beginPath(); ctx.ellipse(0, 0, c.w / 2, 4.2, 0, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(72,58,36,0.8)';
        ctx.beginPath(); ctx.ellipse(0, -3.4, c.w / 2 + 3, 2.4, 0, Math.PI, 0); ctx.fill();
      } else if (c.type === 'wall') {
        if (!drawTex(ctx, 'stonewall', Math.floor(c.x), 0, 1, c.w * 1.6)) {
          // low mud-brick village wall, chipped
          ctx.fillStyle = '#8a7a5c';
          ctx.fillRect(-c.w / 2, -8, c.w, 8);
          ctx.fillStyle = '#77684c';
          ctx.fillRect(-c.w / 2, -8, c.w, 2.4);
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.lineWidth = 0.8;
          for (let i = 1; i < 4; i++) {
            ctx.beginPath(); ctx.moveTo(-c.w / 2 + i * (c.w / 4), -8); ctx.lineTo(-c.w / 2 + i * (c.w / 4), 0); ctx.stroke();
          }
          ctx.fillStyle = 'rgba(20,16,10,0.3)';
          ctx.beginPath(); ctx.ellipse(rng() * c.w - c.w / 2, -8, 3, 1.6, 0, Math.PI, 0); ctx.fill();
        }
      } else if (c.type === 'trench') {
        // dug slot with a parapet toward the enemy side
        ctx.fillStyle = 'rgba(14,11,7,0.85)';
        ctx.beginPath(); ctx.ellipse(0, 0, c.w / 2, 5, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#5c4a2e';
        ctx.beginPath(); ctx.ellipse(-c.w / 2 - 4, -2.4, 9, 3.6, 0, Math.PI, 0); ctx.fill();
        ctx.beginPath(); ctx.ellipse(c.w / 2 + 4, -2.4, 9, 3.6, 0, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = '#3a2d1c'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(-c.w / 2, -0.5); ctx.lineTo(c.w / 2, -0.5); ctx.stroke();
      }
      ctx.restore();
    }
  },

  _drawNades(ctx, game, lane) {
    for (const n of game.nades) {
      if (n.lane !== lane || !Camera.sees(n.x, 30)) continue;
      ctx.save();
      ctx.translate(n.x, n.y - 2);
      ctx.rotate(n.spin);
      ctx.fillStyle = '#2e2c22';
      ctx.fillRect(-2.2, -1.4, 4.4, 2.8);
      ctx.fillStyle = 'rgba(255,255,230,0.5)';
      ctx.fillRect(-0.6, -1.4, 1.2, 1);
      ctx.restore();
      if (n.landed) {
        // sputtering fuse
        ctx.fillStyle = `rgba(255,210,120,${0.4 + 0.4 * Math.sin(n.fuse * 30)})`;
        ctx.beginPath(); ctx.arc(n.x + 2, n.y - 4, 1, 0, 7); ctx.fill();
      }
    }
  },

  /* Smoke screens. Drawn over the men in the lane, because the whole point is
   * that you cannot see through it — a screen the player can see past would be
   * lying about what the units can do. Built from a few drifting blobs so it
   * billows rather than sitting there as a disc. */
  _drawSmoke(ctx, game, lane, time) {
    for (const s of game.smokes) {
      if (s.lane !== lane || !Camera.sees(s.x, s.radius + 80)) continue;
      const grow = Math.min(1, s.age / SMOKE.build);
      const fade = Math.min(1, s.life / 2.5);
      const a = 0.80 * grow * fade;
      if (a <= 0.01) continue;
      const gy = groundY(game.map, lane, s.x);
      const r = s.radius * grow;
      ctx.save();
      for (let i = 0; i < 7; i++) {
        const p = i / 7;
        const wob = Math.sin(time * 0.55 + i * 2.1 + s.x * 0.01);
        const bx = s.x + (p - 0.5) * r * 1.7 + wob * 7;
        const by = gy - 12 - p * 26 - Math.abs(wob) * 9 - grow * 14;
        const br = r * (0.42 + 0.20 * Math.sin(i * 1.7 + s.age));
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, `rgba(214,212,203,${a * 0.55})`);
        g.addColorStop(0.6, `rgba(190,188,180,${a * 0.34})`);
        g.addColorStop(1, 'rgba(178,176,168,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, 7);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  /* Night operations.
   *
   * Multiply the world down to almost nothing, then put every light source back
   * on top: muzzle flashes, burning structures, ground fire. The additive muzzle
   * light already existed and barely registered in daylight — after dark it
   * carries the whole scene, and a firefight becomes a series of things briefly
   * lit by their own violence, which is the documentary image of this war.
   */
  _drawNight(ctx, game, map) {
    if (!this._night) return;
    const k = this._nightK;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    /* Multiply SCALES colour, it does not replace it — against a warm sunset
     * palette that just produced a brown night. Washing over with source-over
     * neutralises the daylight hue first; the cold gradient then owns the frame. */
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(11,16,33,${k})`;
    ctx.fillRect(Camera.x - 4, 0, CANVAS_W + 8, CANVAS_H);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, 'rgba(22,36,80,0.17)');
    g.addColorStop(1, 'rgba(10,18,40,0.09)');
    ctx.fillStyle = g;
    ctx.fillRect(Camera.x - 4, 0, CANVAS_W + 8, CANVAS_H);

    ctx.globalCompositeOperation = 'lighter';
    for (const L of this._lights) {
      const rg = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
      rg.addColorStop(0, `rgba(255,226,170,${0.30 * L.p})`);
      rg.addColorStop(0.35, `rgba(255,164,74,${0.12 * L.p})`);
      rg.addColorStop(1, 'rgba(255,130,50,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(L.x, L.y, L.r, 0, 7);
      ctx.fill();
    }
    // burning wreckage and ground fire keep their own glow going
    for (const st of game.structures) {
      if (!(st.burnT > 0) || !Camera.sees(st.x, 120)) continue;
      const y = groundY(map, st.lane, st.x);
      const r = 90 * LANE_DEPTH[st.lane];
      const rg = ctx.createRadialGradient(st.x, y - 14, 0, st.x, y - 14, r);
      rg.addColorStop(0, 'rgba(255,170,80,0.18)');
      rg.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(st.x, y - 14, r, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  },

  /* Aerial perspective: air between you and the far lane.
   *
   * One global haze tinted the whole scene equally, so all three lanes sat at the
   * same apparent distance and the depth had to come entirely from sprite scale.
   * Laying a little of the map's own haze colour over each lane AS IT FINISHES —
   * most on the far lane, none on the near one — separates them the way distance
   * actually does. Costs three fills. */
  _laneHaze(ctx, map, lane) {
    const a = [0.5, 0.22, 0][lane];
    if (!a || !map.pal.haze) return;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = a;
    ctx.fillStyle = map.pal.haze;
    ctx.fillRect(Camera.x - 4, 0, CANVAS_W + 8, CANVAS_H);
    ctx.globalAlpha = prev;
  },

  /* Rank chevrons over a squad. Veterancy is worth nothing to the player if it
   * is invisible — this is how you know which squad to pull back and which to
   * push. Only drawn for squads that have actually earned a rank. */
  _drawRank(ctx, game, lane) {
    for (const s of game.squads) {
      if (s.lane !== lane || !(s.rank > 0)) continue;
      const alive = game.squadAlive(s);
      if (!alive.length) continue;
      const x = game.squadAnchor(s);
      if (!Camera.sees(x, 60)) continue;
      if (s.side !== game.player && !alive.some(m => game.visibleToPlayer(m))) continue;
      const depth = LANE_DEPTH[lane];
      const y = groundY(game.map, lane, x) - 78 * depth;
      ctx.save();
      ctx.strokeStyle = s.side === 'us' ? '#cfe0a8' : '#f0a087';
      ctx.lineWidth = 1.6 * depth;
      ctx.lineCap = 'round';
      for (let i = 0; i < s.rank; i++) {
        const cy = y + i * 4.2 * depth;
        ctx.beginPath();
        ctx.moveTo(x - 4.5 * depth, cy);
        ctx.lineTo(x, cy - 3 * depth);
        ctx.lineTo(x + 4.5 * depth, cy);
        ctx.stroke();
      }
      ctx.restore();
    }
  },

  _drawSquadMarkers(ctx, game, lane, time) {
    const ui = this._ui;
    const sel = ui && ui.selectedSquad;
    // selected squad: rings under the men, free cover spots hinted downfield
    if (sel && sel.lane === lane && game.squadAlive(sel).length) {
      ctx.save();
      for (const m of game.squadAlive(sel)) {
        ctx.strokeStyle = 'rgba(255,217,138,0.85)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(m.x, m.y + 2, 9, 3.2, 0, 0, 7);
        ctx.stroke();
      }
      const pulse = 0.35 + 0.2 * Math.sin(time * 5);
      for (const c of game.covers[lane]) {
        if (c.occ && c.occ !== sel) continue;
        if (!Camera.sees(c.x, 40)) continue;
        const cy = groundY(game.map, lane, c.x);
        ctx.strokeStyle = `rgba(180,220,150,${pulse})`;
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(c.x, cy + 1, c.w / 2 + 4, 4, 0, 0, 7);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (sel.order === 'moveto') {
        const my = groundY(game.map, lane, sel.moveToX);
        ctx.strokeStyle = '#ffd98a';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(sel.moveToX, my); ctx.lineTo(sel.moveToX, my - 18);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,217,138,0.9)';
        ctx.beginPath();
        ctx.moveTo(sel.moveToX, my - 18); ctx.lineTo(sel.moveToX + 9, my - 14.5);
        ctx.lineTo(sel.moveToX, my - 11);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    for (const s of game.squads) {
      if (s.lane !== lane) continue;
      const alive = game.squadAlive(s);
      if (!alive.length) continue;
      const vis = alive.some(m => game.visibleToPlayer(m));
      if (!vis) continue;
      if (s.pinned) {
        const ax = game.squadAnchor(s);
        const ay = groundY(game.map, lane, ax) - 84 * LANE_DEPTH[lane];
        const pulse = 0.55 + 0.3 * Math.sin(time * 9);
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#d4544a';
        ctx.font = 'bold 8px Courier New';
        ctx.fillText('PINNED', ax - 14, ay);
        ctx.beginPath();
        ctx.moveTo(ax - 3, ay + 3);
        ctx.lineTo(ax + 3, ay + 3);
        ctx.lineTo(ax, ay + 7);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  },

  /* ---------- destructible structures ---------- */
  _drawStructures(ctx, game, lane, time) {
    for (const st of game.structures) {
      if (st.lane !== lane || !Camera.sees(st.x, st.w + 60)) continue;
      const y = groundY(game.map, lane, st.x);
      const rng = seeded(st.seed);
      ctx.save();
      ctx.translate(st.x, y);
      const depth = LANE_DEPTH[lane];
      ctx.scale(depth, depth);
      if (st.state === 2) this._drawRubble(ctx, st, rng);
      else this._drawBuilding(ctx, st, rng, st.state === 1, time);
      ctx.restore();
      if (st.burnT > 0 && typeof Assets !== 'undefined' && Assets.anim('groundfire')) {
        const fi = Math.floor(time * 11 + st.x * 0.7) % 7;
        Assets.drawAnimFrame(ctx, 'groundfire', fi, st.x + Math.sin(st.seed) * st.w * 0.2,
          y - (st.state === 2 ? 2 : st.kind === 'stilt' ? 18 : 12) * depth,
          (st.w * 0.9) * depth, { add: true, ground: false, alpha: 0.85 });
      }
    }
  },

  /* Village kinds that have a profile-rendered prop. These come off the same
   * orthographic side camera as the soldiers, which is the whole point: the old
   * painted kit was drawn in 3/4 view and read as a collage next to profile men.
   * Sized from the prop's authored real-world height, so a 3 m hut stands
   * correctly against a 1.8 m soldier instead of being eyeballed. */
  PROP_KINDS: {
    hooch: ['hut_a', 'hut_c'],
    longhouse: ['village_row'],
    stilt: ['hut_b'],
    stall: ['stall'],
    shrine: ['frame_c'],
    // an MG position IS a sandbag parapet — the props already model one
    mgnest: ['sandbags_pile', 'sandbag_wall'],
    tower: ['watchtower'],
    well: ['well_a'],
    cart: ['cart_a'],
  },

  _drawBuilding(ctx, st, rng, dmg, time) {
    const w = st.w;
    const alt = this.PROP_KINDS[st.kind];
    if (alt && typeof Props !== 'undefined' && Props.ready) {
      const name = alt[Math.abs(st.seed | 0) % alt.length];
      if (Props.has(name)) {
        // inside this context everything is already scaled by lane depth, so the
        // prop is asked for its height at scale 1 and inherits the depth
        Props.draw(ctx, name, 0, 0, 1, { flip: (st.seed | 0) % 2 === 1 });
        if (dmg) {
          ctx.save();
          ctx.globalAlpha = 0.42;
          ctx.fillStyle = '#150f08';
          const h = Props.pxHeight(name, 1);
          ctx.beginPath();
          ctx.ellipse(0, -h * 0.45, w * 0.62, h * 0.34, 0.15, 0, 7);
          ctx.fill();
          ctx.restore();
        }
        return;
      }
    }
    // painted sprite when the kit has one; procedural stays the fallback
    const kindMap = { hooch: 'hooch', longhouse: 'house', stilt: 'stiltH', well: 'well',
                      banana: 'banana', cart: 'cart', shrine: 'shrine', stall: 'stall' };
    if (st.kind === 'tower') {
      if (drawTex(ctx, 'watchtower', 0, 0, 2, w * 2.1)) {
        if (dmg) {
          ctx.fillStyle = 'rgba(16,13,9,0.5)';
          ctx.beginPath(); ctx.ellipse(0, -w * 1.6, w * 0.5, w * 0.3, 0.2, 0, 7); ctx.fill();
        }
        return;
      }
    }
    if (st.kind === 'mgnest') {
      // log frame + sandbag parapet
      ctx.fillStyle = '#4a3a24';
      ctx.fillRect(-w / 2, -7, w, 4.6);
      drawTex(ctx, 'sandbags', 0, 0, 1, w * 1.3);
      if (dmg) {
        ctx.fillStyle = 'rgba(16,13,9,0.5)';
        ctx.beginPath(); ctx.ellipse(w * 0.1, -5, w * 0.3, 3, 0, 0, 7); ctx.fill();
      }
      return;
    }
    const sk = kindMap[st.kind];
    if (sk && tex(sk, st.seed)) {
      const wm = { hooch: 1.5, house: 1.6, stiltH: 1.5, well: 2.1, banana: 1.35,
                   cart: 1.45, shrine: 1.8, stall: 1.55 }[sk] || 1.5;
      drawTex(ctx, sk, st.seed, 0, 2, w * wm);
      if (dmg) {
        // shell-holed and scorched
        const img = tex(sk, st.seed);
        const dw = w * wm, dh = img.height * (dw / img.width);
        ctx.fillStyle = 'rgba(16,13,9,0.55)';
        ctx.beginPath(); ctx.ellipse(-dw * 0.16, -dh * 0.62, dw * 0.14, dh * 0.1, 0.3, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(dw * 0.18, -dh * 0.34, dw * 0.11, dh * 0.09, -0.2, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(20,16,10,0.3)';
        ctx.fillRect(-dw / 2, -dh, dw, dh);
      }
      return;
    }
    const wall = '#6b5a38', wallD = '#54462a', thatch = '#98854e', thatchD = '#6e5f36';
    if (st.kind === 'hooch' || st.kind === 'longhouse') {
      const h = st.kind === 'hooch' ? 16 : 20;
      // short stilts + floor
      ctx.strokeStyle = wallD; ctx.lineWidth = 1.6;
      for (let i = 0; i <= 3; i++) {
        const px = -w / 2 + (i / 3) * w;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, -4); ctx.stroke();
      }
      // wall panel with weave lines
      ctx.fillStyle = wall;
      ctx.fillRect(-w / 2, -4 - h, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.8;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(-w / 2, -4 - (i / 4) * h); ctx.lineTo(w / 2, -4 - (i / 4) * h); ctx.stroke();
      }
      // doorway
      ctx.fillStyle = '#241f14';
      ctx.fillRect(-4, -4 - h * 0.72, 8, h * 0.72);
      // thatch roof with overhang
      const ry = -4 - h;
      ctx.fillStyle = dmg ? thatchD : thatch;
      ctx.beginPath();
      ctx.moveTo(-w / 2 - 6, ry);
      ctx.lineTo(0, ry - (st.kind === 'hooch' ? 13 : 17));
      ctx.lineTo(w / 2 + 6, ry);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        ctx.beginPath();
        ctx.moveTo((-w / 2 - 6) * (1 - t), ry - t * (st.kind === 'hooch' ? 13 : 17));
        ctx.lineTo((w / 2 + 6) * (1 - t), ry - t * (st.kind === 'hooch' ? 13 : 17));
        ctx.stroke();
      }
      if (dmg) {
        // holed roof + scorched wall
        ctx.fillStyle = 'rgba(20,16,10,0.75)';
        ctx.beginPath(); ctx.ellipse(w * 0.14, ry - 6, 7, 4, 0.3, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(16,13,9,0.5)';
        ctx.fillRect(-w / 2 + 3, -4 - h, w * 0.35, h);
      }
    } else if (st.kind === 'stilt') {
      // tall stilts over the paddy, ladder, small house
      ctx.strokeStyle = wallD; ctx.lineWidth = 2;
      for (const px of [-w / 2 + 4, -4, w / 2 - 4]) {
        ctx.beginPath(); ctx.moveTo(px, 2); ctx.lineTo(px, -13); ctx.stroke();
      }
      ctx.fillStyle = '#5c4a2e';
      ctx.fillRect(-w / 2, -16, w, 4);
      ctx.fillStyle = wall;
      ctx.fillRect(-w / 2 + 3, -16 - 11, w - 6, 11);
      ctx.fillStyle = '#241f14';
      ctx.fillRect(-3, -16 - 9, 6, 9);
      ctx.fillStyle = dmg ? thatchD : thatch;
      ctx.beginPath();
      ctx.moveTo(-w / 2 - 4, -27);
      ctx.lineTo(0, -36);
      ctx.lineTo(w / 2 + 4, -27);
      ctx.closePath(); ctx.fill();
      // ladder
      ctx.strokeStyle = wallD; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(w / 2 - 10, 2); ctx.lineTo(w / 2 - 4, -14); ctx.stroke();
      if (dmg) {
        ctx.fillStyle = 'rgba(20,16,10,0.6)';
        ctx.beginPath(); ctx.ellipse(-w * 0.15, -31, 6, 3.4, -0.2, 0, 7); ctx.fill();
      }
    } else if (st.kind === 'bunker') {
      // half-buried log-and-sandbag bunker with a firing slit
      ctx.fillStyle = '#4a4232';
      ctx.beginPath(); ctx.ellipse(0, -1, w / 2, 13, 0, Math.PI, 0); ctx.fill();
      for (let r = 0; r < 3; r++) {
        for (let i = 0; i < 6 - r; i++) {
          ctx.fillStyle = (i + r) % 2 ? '#8a7a58' : '#7d6e4e';
          ctx.beginPath();
          ctx.ellipse(-w / 2 + 7 + i * 8.5 + r * 4, -3 - r * 4.6, 4.6, 2.6, 0, 0, 7);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#3d3524';
      ctx.fillRect(-w / 2 + 4, -8, w - 8, 2.4); // timber lintel
      ctx.fillStyle = '#14120c';
      ctx.fillRect(-9, -7, 18, 3); // firing slit
      if (dmg) {
        ctx.fillStyle = 'rgba(18,14,9,0.55)';
        ctx.beginPath(); ctx.ellipse(w * 0.18, -9, 8, 4, 0, 0, 7); ctx.fill();
      }
    } else if (st.kind === 'well') {
      ctx.fillStyle = '#6e6252';
      ctx.beginPath(); ctx.ellipse(0, -2, 6, 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#14120c';
      ctx.beginPath(); ctx.ellipse(0, -2.6, 4, 1.8, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#54462a'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(-5, -12); ctx.moveTo(5, -2); ctx.lineTo(5, -12); ctx.stroke();
      ctx.fillStyle = '#8a7443';
      ctx.beginPath(); ctx.moveTo(-8, -12); ctx.lineTo(0, -16); ctx.lineTo(8, -12); ctx.closePath(); ctx.fill();
    } else if (st.kind === 'hay') {
      ctx.fillStyle = dmg ? '#6e5f36' : '#a58c52';
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.quadraticCurveTo(-7, -13, 0, -15);
      ctx.quadraticCurveTo(7, -13, 8, 0);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(-2, -12); ctx.moveTo(3, -3); ctx.lineTo(5, -10); ctx.stroke();
    }
  },

  _drawRubble(ctx, st, rng) {
    const w = st.w;
    if (st.kind === 'bunker') {
      // burst sandbags and splintered timber
      ctx.fillStyle = '#4a4232';
      ctx.beginPath(); ctx.ellipse(0, -1, w / 2, 8, 0, Math.PI, 0); ctx.fill();
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(138,122,88,0.9)' : 'rgba(110,98,72,0.9)';
        ctx.beginPath();
        ctx.ellipse(-w / 2 + rng() * w, -2 - rng() * 4, 4, 2.2, rng(), 0, 7);
        ctx.fill();
      }
      ctx.strokeStyle = '#2e2618'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(4, -10); ctx.stroke();
    } else {
      // charred frame poles over a debris mound
      ctx.fillStyle = 'rgba(26,21,14,0.85)';
      ctx.beginPath(); ctx.ellipse(0, -1, w / 2, 5, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#1c1710'; ctx.lineWidth = 1.8;
      for (let i = 0; i < 4; i++) {
        const px = -w / 2 + rng() * w;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px + (rng() - 0.5) * 14, -(5 + rng() * 11));
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(60,50,34,0.7)';
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(-w / 2 + rng() * w, -2 + rng() * 2, 3 + rng() * 3, 1.6);
      }
    }
  },

  _drawEmplacements(ctx, game, lane, time) {
    const map = game.map, player = game.player;
    for (const t of game.traps) {
      if (t.lane !== lane || !Camera.sees(t.x)) continue;
      const visible = player === t.side || t.discovered;
      if (!visible) continue;
      const y = groundY(map, lane, t.x);
      ctx.save();
      ctx.globalAlpha = t.discovered && player !== t.side ? 1 : 0.75;
      if (t.type === 'punji') {
        ctx.fillStyle = '#241c10';
        ctx.beginPath(); ctx.ellipse(t.x, y + 1, 10, 3, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = '#a89058'; ctx.lineWidth = 1.2;
        for (let i = -6; i <= 6; i += 3) {
          ctx.beginPath(); ctx.moveTo(t.x + i, y + 1); ctx.lineTo(t.x + i + 1, y - 4); ctx.stroke();
        }
      } else {
        ctx.fillStyle = '#4a4a42';
        ctx.beginPath(); ctx.ellipse(t.x, y - 1, 4.5, 2.4, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(200,200,180,0.4)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(t.x - 14, y - 2); ctx.lineTo(t.x + 14, y - 2); ctx.stroke();
      }
      if (t.discovered && player === 'us') {
        ctx.fillStyle = '#ffd98a';
        ctx.font = 'bold 10px Courier New';
        ctx.fillText('!', t.x - 2, y - 10);
      }
      ctx.restore();
    }
    for (const h of game.holes) {
      if (h.lane !== lane || !Camera.sees(h.x)) continue;
      const visible = player === 'vc' || h.revealT > 0 || h.discovered;
      if (!visible) continue;
      const y = groundY(map, lane, h.x);
      ctx.fillStyle = '#33402a';
      ctx.beginPath(); ctx.ellipse(h.x, y, 13, 5, 0, Math.PI, 0); ctx.fill();
      if (h.revealT > 0) {
        ctx.fillStyle = '#14120c';
        ctx.beginPath(); ctx.ellipse(h.x, y - 3, 7, 3.4, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = '#26251d'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(h.x, y - 4); ctx.lineTo(h.x - 14 * h.dirToTarget * -1, y - 7); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(20,18,12,0.85)';
        ctx.beginPath(); ctx.ellipse(h.x, y - 1, 6, 2.2, 0, 0, 7); ctx.fill();
      }
    }
    for (const tn of game.tunnels) {
      if (tn.lane !== lane || !Camera.sees(tn.x)) continue;
      const visible = player === 'vc' || tn.discovered;
      if (!visible) continue;
      const y = groundY(map, lane, tn.x);
      ctx.fillStyle = '#4a3c26';
      ctx.beginPath(); ctx.ellipse(tn.x, y + 1, 15, 5.5, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#0f0d08';
      ctx.beginPath(); ctx.ellipse(tn.x, y, 9, 7, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#5c4a2e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tn.x - 9, y); ctx.lineTo(tn.x - 9, y - 7); ctx.moveTo(tn.x + 9, y); ctx.lineTo(tn.x + 9, y - 7); ctx.stroke();
    }
  },

  _drawFlag(ctx, game, lane, time) {
    const map = game.map;
    const f = game.flags[lane];
    if (!Camera.sees(f.x)) return;
    const x = f.x, y = groundY(map, lane, x);
    ctx.strokeStyle = '#3a3428'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 34); ctx.stroke();
    const wave = Math.sin(time * 5 + lane) * 2;
    const fw = 18, fh = 11;
    ctx.save();
    ctx.translate(x, y - 34);
    if (f.owner === 'us') {
      ctx.fillStyle = '#d8b83a';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(fw, 1 + wave); ctx.lineTo(fw, fh + wave); ctx.lineTo(0, fh); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#b03226'; ctx.lineWidth = 1.4;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath(); ctx.moveTo(0, i * fh / 4); ctx.lineTo(fw, i * fh / 4 + wave); ctx.stroke();
      }
    } else if (f.owner === 'vc') {
      ctx.fillStyle = '#b03226';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(fw, 1 + wave); ctx.lineTo(fw, fh / 2 + wave); ctx.lineTo(0, fh / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a4a7c';
      ctx.beginPath(); ctx.moveTo(0, fh / 2); ctx.lineTo(fw, fh / 2 + wave); ctx.lineTo(fw, fh + wave); ctx.lineTo(0, fh); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8c840';
      ctx.font = '8px sans-serif';
      ctx.fillText('★', fw / 2 - 4, fh / 2 + 3 + wave / 2);
    } else {
      ctx.fillStyle = 'rgba(210,210,200,0.75)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(fw, 1 + wave); ctx.lineTo(fw, fh + wave); ctx.lineTo(0, fh); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (f.capSide && f.cap > 0.02) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - 12, y + 6, 24, 4);
      ctx.fillStyle = f.capSide === 'us' ? '#b5c98f' : '#e08767';
      ctx.fillRect(x - 12, y + 6, 24 * clamp(f.cap, 0, 1), 4);
    }
  },

  /* Soft contact shadow. Nothing sells "standing on the ground" like a shadow —
   * without one a sprite reads as a sticker pasted over the terrain. Cached as a
   * one-off blob because a radial gradient per unit per frame is pure waste. */
  _shadowBlob() {
    if (this._shadow) return this._shadow;
    const R = 64;
    const c = document.createElement('canvas');
    c.width = c.height = R * 2;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, 'rgba(24,28,16,0.62)');
    g.addColorStop(0.45, 'rgba(24,28,16,0.34)');
    g.addColorStop(1, 'rgba(24,28,16,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, R * 2, R * 2);
    this._shadow = c;
    return c;
  },

  _drawShadow(ctx, u, scale, lift) {
    // a man on his belly casts a long thin shadow; a man on his feet a small one
    const prone = u.pose === 'prone' || u.deadT != null;
    const w = (prone ? 30 : 13) * scale;
    const h = (prone ? 4.4 : 4.0) * scale;
    // it stays on the ground even when the soldier is up a tower
    const gy = u.y + (u.yj || 0) + S3_TARGET_H * scale * S3_FOOT;
    const fade = lift > 0 ? 0.45 : 1;           // elevated men cast a softer mark
    const img = this._shadowBlob();
    ctx.save();
    ctx.globalAlpha = fade * (u.deadT != null ? 0.7 : 1);
    ctx.drawImage(img, u.x - w, gy - h, w * 2, h * 2);
    ctx.restore();
  },

  /* A rifle going off throws real light. Painting a warm additive pool at the
   * muzzle is the cheapest lighting in the game and does the most work — in a
   * dusk palette it is the difference between a gunfight and a slideshow. */
  _drawMuzzleLight(ctx, game, lane) {
    let any = false;
    const night = this._night;
    for (const u of game.units) {
      if (u.lane !== lane || u.deadT != null) continue;
      const mt = u.muzzleT || 0;
      if (mt <= 0 || !Camera.sees(u.x)) continue;
      const p = Math.min(1, mt / 0.07);          // brightest at the instant of firing
      const m = muzzlePoint(u);
      const scale = LANE_DEPTH[lane] * (u.sj || 1);
      const r = (46 + 26 * p) * scale;
      if (night) {
        // after dark the flash is the only light there is, so it has to be laid
        // on top of the darkness rather than under it — collected here and
        // replayed once the night pass has gone down
        // additive light COMPOUNDS: five men firing together blew the frame to
        // white. Modest per-flash, so a firefight glows instead of flaring out.
        this._lights.push({ x: m.x, y: m.y, r: r * 1.15, p });
        continue;
      }
      if (!any) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; any = true; }
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, r);
      g.addColorStop(0, `rgba(255,214,140,${0.42 * p})`);
      g.addColorStop(0.35, `rgba(255,150,60,${0.18 * p})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, 7);
      ctx.fill();
    }
    if (any) ctx.restore();
  },

  _drawUnits(ctx, game, lane, time) {
    // shadows first, as their own pass — otherwise one man's shadow paints over
    // the soldier standing behind him
    if (typeof S3_FOOT !== 'undefined') {
      for (const u of game.units) {
        if (u.lane !== lane || !Camera.sees(u.x)) continue;
        if (u.deadT != null && u.deadT > 1.4) continue;
        if (!(game.visibleToPlayer(u) || (u.combatT || 0) > 0 || (u.muzzleT || 0) > 0 ||
              u.deadT != null)) continue;
        const sc = LANE_DEPTH[lane] * (u.sj || 1);
        const cv2 = u.squad && u.squad.inCover ? u.squad.cover : null;
        const tl = cv2
          ? (cv2.type === 'towerpos' ? 30 : (cv2.lift || 0)) * LANE_DEPTH[lane]
          : 0;
        this._drawShadow(ctx, u, sc, tl);
      }
    }
    for (const u of game.units) {
      if (u.lane !== lane || !Camera.sees(u.x)) continue;
      // visibility FADES instead of popping: a VC slipping back into the brush
      // dissolves over ~0.5s rather than blinking out between bursts
      const visible = game.visibleToPlayer(u) ||
        (u.combatT || 0) > 0 || (u.muzzleT || 0) > 0; // firing men never vanish
      // Concealed enemies never dissolve to nothing — they settle to a dim
      // shape in the brush. A soldier blinking in and out reads as a bug; a
      // half-seen man in the treeline reads as the threat it is.
      const targetVis = u.deadT != null ? 1 : (visible ? 1 : 0);
      u.visA = targetVis;
      if (!u.visA && u.deadT == null) continue;
      const scale = LANE_DEPTH[lane] * (u.sj || 1);
      const concealed = u.side === 'vc' && game.isConcealed(u);
      const alpha = (concealed && u.side === game.player ? 0.55 : 1) * Math.min(1, u.visA);
      // stance is decided by the squad-level state machine, nowhere else
      const pose = u.pose;
      // snipers on a tower platform stand above the ground line
      // a cover position can stand its holders off the ground: a tower platform,
      // or the raised floor of a stilt house seen through its window
      const cv = u.squad && u.squad.inCover ? u.squad.cover : null;
      const towerLift = cv
        ? (cv.type === 'towerpos' ? 30 : (cv.lift || 0)) * LANE_DEPTH[lane]
        : 0;
      drawSoldier(ctx, u.key, {
        x: u.x, y: u.y + (u.yj || 0) - towerLift, dir: u.dir, scale,
        moving: u.moving, phase: u.phase, dist: u.dist || 0, spd: u.spd || 0,
        gaitOff: u.gaitOff || 0, gaitK: u.gaitK || 1,
        pose, deadT: u.deadT, alpha,
        flash: u.muzzleT > 0,
        combat: (u.combatT || 0) > 0,
        hitT: u.hitT || 0,
        wounded: u.wounded,
        nadeT: u.nadeT || 0, nadeDur: u.nadeDur || 0.9,
        muzzleT: u.muzzleT || 0,
        reload: (u.fireT || 0) > 0.55,
        transT: u.transT || 0, transDir: u.transDir || 1,
        ref: u, time,
      });
      if (u.deadT == null) {
        if (concealed && u.side === game.player) {
          ctx.fillStyle = 'rgba(140,190,110,0.8)';
          ctx.font = '9px Courier New';
          ctx.fillText('▼', u.x - 3, u.y - 74 * scale);
        }
        if (u.hp < u.maxHp) {
          const w = 18 * scale;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(u.x - w / 2, u.y - 68 * scale, w, 2.5);
          ctx.fillStyle = u.side === 'us' ? '#9fc46a' : '#e08767';
          ctx.fillRect(u.x - w / 2, u.y - 68 * scale, w * (u.hp / u.maxHp), 2.5);
        }
        if (u.aiming && u.aimTarget && !u.aimTarget.deadT) {
          const prog = u.aimT / u.aimTime;
          ctx.save();
          ctx.globalAlpha = 0.12 + prog * 0.2;
          ctx.strokeStyle = '#ffd0a0';
          ctx.setLineDash([3, 6]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(u.x + u.dir * 16, u.y - 8 * scale);
          ctx.lineTo(u.aimTarget.x, u.aimTarget.y - 28 * scale);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    // last, so the flash falls ON the men and the ground rather than under them
    this._drawMuzzleLight(ctx, game, lane);
  },

  _drawFires(ctx, game, lane, time) {
    for (const f of game.fires) {
      if (f.lane !== lane) continue;
      const y0 = groundY(game.map, lane, (f.x0 + f.x1) / 2);
      const g = ctx.createLinearGradient(0, y0 - 30, 0, y0 + 8);
      g.addColorStop(0, 'rgba(255,140,40,0)');
      g.addColorStop(1, `rgba(255,120,30,${0.25 * Math.min(1, f.t)})`);
      ctx.fillStyle = g;
      ctx.fillRect(f.x0, y0 - 30, f.x1 - f.x0, 40);
      // looping flame sprites along the strip
      if (typeof Assets !== 'undefined' && Assets.anim('groundfire')) {
        const fade = Math.min(1, f.t * 2, Math.max(0, (f.dur - f.t) * 1.4));
        for (let x = f.x0 + 20; x < f.x1 - 8; x += 54) {
          if (!Camera.sees(x)) continue;
          const gy = groundY(game.map, lane, x);
          const fi = Math.floor(time * 11 + x * 0.37) % 7;
          Assets.drawAnimFrame(ctx, 'groundfire', fi, x, gy + 3, 30 + (Math.floor(x * 7.7) % 13), {
            add: true, ground: true, alpha: 0.85 * fade,
          });
        }
      }
    }
  },

  _drawStrikes(ctx, game, time) {
    const map = game.map;
    for (const s of game.strikes) {
      if (s.type === 'arty' || s.type === 'arclight') {
        for (const im of s.impacts) {
          const tt = im.t - s.age;
          if (!im.done && tt < 0.5 && tt > 0) {
            const y = groundY(map, s.lane, im.x) - tt * 700;
            ctx.strokeStyle = 'rgba(255,240,200,0.55)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(im.x + tt * 30, y - 26); ctx.lineTo(im.x, y); ctx.stroke();
          }
        }
        if (s.type === 'arclight') {
          const px = s.x + (s.age - 4.6) * 420;
          drawB52(ctx, px, 52);
          drawB52(ctx, px - 90, 64);
          drawB52(ctx, px - 180, 58);
        }
      } else if (s.type === 'napalm') {
        const px = s.x + (s.age - s.dropT) * 540;
        const py = LANE_BASE[s.lane] - 250;
        drawJet(ctx, px, py, 1);
        if (s.age > s.dropT - 0.5 && s.age < s.dropT + 0.2) {
          const k = (s.age - (s.dropT - 0.5)) / 0.7;
          ctx.fillStyle = '#33382c';
          for (let i = 0; i < 3; i++) {
            const cx = s.x - 60 + i * 60;
            const cy = lerp(py + 10, groundY(map, s.lane, cx), clamp(k + i * 0.06, 0, 1));
            ctx.beginPath(); ctx.ellipse(cx, cy, 5, 2.4, 0.5, 0, 7); ctx.fill();
          }
        }
      } else if (s.type === 'medevac') {
        const px = Camera.x + lerp(-80, CANVAS_W + 120, clamp(s.age / 5, 0, 1));
        drawHuey(ctx, px, 170, time, { medevac: true });
      } else if (s.type === 'patrol') {
        const px = s.x + s.dirX * s.age * 170;
        const py = s.y + Math.sin(time * 1.3) * 3;
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(0.65, 0.65);
        drawHuey(ctx, 0, 0, time, { color: 'rgba(44,51,36,0.85)', dir: s.dirX });
        ctx.restore();
        if (!s.heard && Camera.sees(px, 240)) {
          s.heard = true;
          Sound.chopper(3);
        }
      } else if (s.type === 'aircav') {
        let px, py;
        const hoverY = groundY(map, s.lane, s.x) - 64;
        if (s.age < 2.2) {
          const k = s.age / 2.2;
          px = lerp(s.x - 680, s.x, k);
          py = lerp(130, hoverY, k * k);
        } else if (s.age < 3.6) {
          px = s.x; py = hoverY + Math.sin(time * 3) * 2;
          ctx.strokeStyle = 'rgba(180,170,140,0.8)';
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(s.x - 4, py + 10); ctx.lineTo(s.x - 4, groundY(map, s.lane, s.x)); ctx.stroke();
        } else {
          const k = (s.age - 3.6) / 2.4;
          px = lerp(s.x, s.x + 760, k);
          py = lerp(hoverY, 110, k);
        }
        drawHuey(ctx, px, py, time);
      }
    }
  },

  _drawParticles(ctx, fx, camX) {
    const xmin = camX - 120, xmax = camX + CANVAS_W + 120;
    for (const p of fx.particles) {
      if (p.x < xmin || p.x > xmax) continue;
      const k = p.t / p.life;
      if (p.type === 'anim') {
        let fi = Math.floor(p.t * p.fps);
        if (p.loop) fi %= p.n;
        const fadeIn = Math.min(1, p.t * 18);
        const fadeOut = p.loop ? 1 : clamp((1 - k) * 4, 0, 1);
        Assets.drawAnimFrame(ctx, p.anim, fi, p.x, p.y, p.h, {
          add: p.add, flip: p.flip, ground: p.ground,
          alpha: p.alpha * fadeIn * fadeOut,
        });
      } else if (p.type === 'bullet') {
        // flying round: hot core + fading streak behind it
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const tail = Math.min(26, sp * 0.017);
        const tx = p.x - p.vx / sp * tail, ty = p.y - p.vy / sp * tail;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const grad = ctx.createLinearGradient(tx, ty, p.x, p.y);
        grad.addColorStop(0, 'rgba(255,180,90,0)');
        grad.addColorStop(1, p.color);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.fillStyle = '#fff8e0';
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.3, 0, 7); ctx.fill();
        ctx.restore();
      } else if (p.type === 'flash') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + k), 0, 7); ctx.fill();
        ctx.restore();
      } else if (p.type === 'shock') {
        ctx.strokeStyle = p.color + (0.5 * (1 - k)) + ')';
        ctx.lineWidth = 2.5 * (1 - k);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * k, 0, 7); ctx.stroke();
      } else if (p.type === 'smoke') {
        ctx.fillStyle = p.color === 'dark' ? `rgba(30,28,24,${0.4 * (1 - k)})`
          : p.color === 'blood' ? `rgba(110,26,16,${0.3 * (1 - k)})`
          : `rgba(120,115,100,${0.35 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.6 + k), 0, 7); ctx.fill();
      } else if (p.type === 'flame') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, 7); ctx.fill();
        ctx.restore();
      } else if (p.type === 'glint') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.sin(k * Math.PI);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        const r = p.size * 2;
        ctx.beginPath();
        ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y);
        ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r);
        ctx.stroke();
        ctx.restore();
      } else if (p.type === 'spark') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.restore();
      } else if (p.type === 'bird') {
        ctx.save();
        ctx.strokeStyle = 'rgba(30,30,26,0.85)';
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = clamp((1 - k) * 4, 0, 1);
        const w = Math.sin(p.t * 16 + p.flap) * p.size * 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x - p.size * 2, p.y - w);
        ctx.quadraticCurveTo(p.x, p.y + p.size * 0.5, p.x + p.size * 2, p.y - w);
        ctx.stroke();
        ctx.restore();
      } else if (p.type === 'gib') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.globalAlpha = clamp((1 - k) * 3, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        ctx.restore();
      } else {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.globalAlpha = 1;
      }
    }
  },

  _drawWeather(ctx, map, time) {
    const w = map.weather || {};
    if (w.rain) {
      ctx.save();
      ctx.strokeStyle = 'rgba(200,215,220,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 110; i++) {
        const h1 = ((i * 2654435761) >>> 8) % 1000 / 1000;
        const h2 = ((i * 1597334677) >>> 8) % 1000 / 1000;
        const x = (h1 * CANVAS_W + time * 90) % CANVAS_W;
        const y = (h2 * CANVAS_H + time * 620 * (0.7 + h1 * 0.5)) % CANVAS_H;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 3, y + 13);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (w.fog) {
      // uniform ground-mist gradient — no drifting screen-anchored blobs
      ctx.save();
      const g = ctx.createLinearGradient(0, 300, 0, CANVAS_H);
      g.addColorStop(0, 'rgba(215,222,215,0)');
      g.addColorStop(0.45, `rgba(215,222,215,${0.10 * w.fog})`);
      g.addColorStop(1, `rgba(215,222,215,${0.16 * w.fog})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 300, CANVAS_W, CANVAS_H - 300);
      ctx.restore();
    }
  },

  /* soft translucent wash over the hovered lane while deploying/targeting */
  _laneGlow(ctx, game, lane, time, sx, sw) {
    const map = game.map;
    const bot = LANE_BANDS[lane][1];
    const pulse = 0.15 + 0.04 * Math.sin(time * 4);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx, bot);
    for (let x = sx; x <= sx + sw; x += 32) ctx.lineTo(x, groundY(map, lane, x) - 30);
    ctx.lineTo(sx + sw, bot);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,232,170,${pulse})`;
    ctx.fill();
    // trace the ground line itself a touch brighter
    ctx.beginPath();
    for (let x = sx; x <= sx + sw; x += 24) {
      const y = groundY(map, lane, x) + 1;
      x === sx ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(255,225,150,${pulse * 3.2})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  },

  _drawTargeting(ctx, game, ui) {
    if (ui.armedCallin && ui.hoverLane != null) {
      const key = ui.armedCallin, def = CALLINS[key];
      const lane = ui.hoverLane, x = ui.hoverX;
      const y = groundY(game.map, lane, x);
      const R = { arty: 115, napalm: 165, arclight: 340, aircav: 46, punji: 14, mine: 16, spiderhole: 14, tunnel: 16 }[key] || 40;
      const valid = game.callinValid(game.player, key, lane, x);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = valid ? '#ffd98a' : '#d24a2e';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - R, y - 26); ctx.lineTo(x - R, y + 8);
      ctx.moveTo(x + R, y - 26); ctx.lineTo(x + R, y + 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, y - 30); ctx.lineTo(x, y + 10);
      ctx.moveTo(x - 14, y - 10); ctx.lineTo(x + 14, y - 10);
      ctx.stroke();
      ctx.font = 'bold 11px Courier New';
      ctx.fillStyle = valid ? '#ffd98a' : '#d24a2e';
      ctx.fillText(valid ? def.name.toUpperCase() : 'INVALID GRID', x - 30, y - 36);
      ctx.restore();
    } else if (ui.armedUnit && ui.hoverLane != null) {
      // clean deploy marker at the spawn point: chevron + one pip per man
      const lane = ui.hoverLane;
      const sd = SQUADS[ui.armedUnit];
      const dir = game.player === 'us' ? 1 : -1;
      const x = game.spawnX(game.player, lane);
      const y = groundY(game.map, lane, x);
      const pulse = 0.65 + 0.25 * Math.sin((ui.game ? ui.game.time : 0) * 6);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ffd98a';
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 46); ctx.lineTo(x + 7, y - 46); ctx.lineTo(x, y - 38);
      ctx.closePath(); ctx.fill();
      const n = sd ? sd.comp.length : 1;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(x - (n - 1) * 4 + i * 8, y - 54, 2.4, 0, 7);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  _drawFloaters(ctx, fx) {
    for (const f of fx.floaters) {
      const k = f.t / f.life;
      ctx.save();
      ctx.globalAlpha = 1 - k * k;
      ctx.font = f.big ? 'bold 15px Courier New' : 'bold 11px Courier New';
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, f.x - f.text.length * 3 + 1, f.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x - f.text.length * 3, f.y);
      ctx.restore();
    }
  },

  /* ---------- minimap ---------- */
  drawMinimap(game) {
    const canvas = this.minimapCanvas || document.getElementById('minimap');
    if (!canvas) return;
    this.minimapCanvas = canvas;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const kx = W / WORLD_W;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(18,20,14,0.85)';
    ctx.fillRect(0, 0, W, H);
    // terrain silhouettes per lane
    for (let l = 0; l < 3; l++) {
      const yBase = 12 + l * 14;
      ctx.strokeStyle = game.map.pal.laneTop[l];
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= WORLD_W; x += 64) {
        const y = yBase - elevAt(game.map, l, x) * 8;
        x === 0 ? ctx.moveTo(x * kx, y) : ctx.lineTo(x * kx, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // flag
      const f = game.flags[l];
      ctx.fillStyle = f.owner === 'us' ? '#b5c98f' : f.owner === 'vc' ? '#e08767' : '#999';
      ctx.fillRect(f.x * kx - 1.5, yBase - 9, 3, 5);
      // units
      for (const u of game.units) {
        if (u.lane !== l || u.deadT != null) continue;
        if (!game.visibleToPlayer(u)) continue;
        ctx.fillStyle = u.side === 'us' ? '#9fc46a' : '#e0714a';
        ctx.fillRect(u.x * kx - 1, yBase - 4, 2, 3);
      }
    }
    // camera window
    ctx.strokeStyle = 'rgba(240,230,200,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Camera.x * kx + 0.5, 1.5, CANVAS_W * kx - 1, H - 3);

    this._drawFrontline(ctx, game, W, H, kx);
  },

  /* Frontline control bar, one strip per lane.
   *
   * The minimap shows where men ARE; this shows who owns the ground between
   * them. Held territory is filled from each base to that lane's contested
   * point, so a lane being lost reads at a glance without counting dots. */
  _drawFrontline(ctx, game, W, H, kx) {
    const y0 = H - 5;
    for (let l = 0; l < 3; l++) {
      const y = y0 - (2 - l) * 4;
      // the contested point: between the deepest US push and the deepest VC push
      let usF = null, vcF = null;
      for (const u of game.units) {
        if (u.lane !== l || u.deadT != null) continue;
        if (u.side === 'us') usF = usF == null ? u.x : Math.max(usF, u.x);
        else vcF = vcF == null ? u.x : Math.min(vcF, u.x);
      }
      let cut;
      if (usF == null && vcF == null) cut = WORLD_W / 2;
      else if (usF == null) cut = Math.min(vcF, WORLD_W);
      else if (vcF == null) cut = usF;
      else cut = (usF + vcF) / 2;
      cut = clamp(cut, 0, WORLD_W);

      ctx.fillStyle = 'rgba(10,12,8,0.9)';
      ctx.fillRect(0, y, W, 3);
      ctx.fillStyle = 'rgba(159,196,106,0.85)';
      ctx.fillRect(0, y, cut * kx, 3);
      ctx.fillStyle = 'rgba(224,113,74,0.85)';
      ctx.fillRect(cut * kx, y, W - cut * kx, 3);
      // the seam itself, so the eye lands on where it is actually being decided
      ctx.fillStyle = 'rgba(255,240,205,0.95)';
      ctx.fillRect(cut * kx - 0.75, y - 1, 1.5, 5);
    }
  },

  /* ---------- menu backdrop ---------- */
  drawMenu(time) {
    const ctx = this.ctx;
    const K = this._k || 1;
    ctx.setTransform(K, 0, 0, K, 0, 0);
    if (!this.menuLayer) {
      this.menuLayer = this._makeLayer();
      const mctx = this.menuLayer.getContext('2d');
      this._drawSkyBase(mctx, MAPS.iadrang);
      const rng0 = seeded(4243);
      this._ridge(mctx, rng0, CANVAS_W, 260, 70, MAPS.iadrang.pal.hillFar, 0.85);
      this._ridge(mctx, rng0, CANVAS_W, 300, 55, MAPS.iadrang.pal.hillNear, 1);
      const rng = seeded(4242);
      mctx.fillStyle = '#2e3520';
      mctx.beginPath();
      mctx.moveTo(0, CANVAS_H);
      mctx.lineTo(0, 520);
      for (let x = 0; x <= CANVAS_W; x += 40) mctx.lineTo(x, 520 + Math.sin(x * 0.01 + 2) * 20 - rng() * 24);
      mctx.lineTo(CANVAS_W, CANVAS_H);
      mctx.closePath(); mctx.fill();
      for (let i = 0; i < 26; i++) {
        const x = rng() * CANVAS_W;
        this._tree(mctx, MAPS.cuchi, rng, x, 560 + rng() * 120, 1.4);
      }
      mctx.fillStyle = '#1c2314';
      mctx.beginPath();
      mctx.moveTo(0, CANVAS_H);
      mctx.lineTo(0, 640);
      for (let x = 0; x <= CANVAS_W; x += 30) mctx.lineTo(x, 640 + Math.sin(x * 0.02) * 12 - rng() * 18);
      mctx.lineTo(CANVAS_W, CANVAS_H);
      mctx.closePath(); mctx.fill();
    }
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.drawImage(this.menuLayer, 0, 0);
    for (let i = 0; i < 3; i++) {
      const px = ((time * 42 + i * 260) % (CANVAS_W + 700)) - 350;
      const py = 150 + i * 42 + Math.sin(time * 1.4 + i * 2) * 6;
      drawHuey(ctx, px, py, time + i, { color: 'rgba(40,46,32,0.85)' });
    }
  },
};

/* ---------- card icons ---------- */
function drawUnitIcon(canvas, key) {
  canvas.width = 88; canvas.height = 76;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 88, 76);
  const sk = UNIT_SPRITES[key];
  const sheet = (typeof Assets !== 'undefined') && Assets.done && sk ? Assets.sheet(sk) : null;
  if (sheet) {
    const name = sheet.poses.idle;
    const m = Assets.meta(name);
    if (m && Assets.drawAnchored(ctx, name, 44, 73, 64 / sheet.standH)) return;
  }
  drawSoldierVector(ctx, key, { x: 44, y: 68, dir: 1, scale: 2.0, moving: false, phase: 0 });
}

function drawCallinIcon(canvas, icon) {
  canvas.width = 88; canvas.height = 76;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 88, 76);
  ctx.save();
  ctx.translate(44, 40);
  ctx.strokeStyle = '#d8d2b0';
  ctx.fillStyle = '#d8d2b0';
  ctx.lineWidth = 3;
  switch (icon) {
    case 'shell':
      ctx.beginPath();
      ctx.moveTo(0, -22); ctx.quadraticCurveTo(9, -8, 9, 6); ctx.lineTo(9, 20); ctx.lineTo(-9, 20); ctx.lineTo(-9, 6);
      ctx.quadraticCurveTo(-9, -8, 0, -22);
      ctx.fill();
      ctx.fillStyle = '#8a2f22'; ctx.fillRect(-9, 8, 18, 5);
      break;
    case 'flame':
      ctx.beginPath();
      ctx.moveTo(0, 22);
      ctx.bezierCurveTo(-16, 12, -10, -4, -4, -10);
      ctx.bezierCurveTo(-4, -2, 2, -2, 2, -12);
      ctx.bezierCurveTo(10, -6, 14, 6, 8, 14);
      ctx.bezierCurveTo(6, 18, 4, 20, 0, 22);
      ctx.fill();
      ctx.fillStyle = '#8a2f22';
      ctx.beginPath(); ctx.ellipse(0, 12, 5, 8, 0, 0, 7); ctx.fill();
      break;
    case 'cross':
      ctx.fillRect(-6, -20, 12, 40);
      ctx.fillRect(-20, -6, 40, 12);
      break;
    case 'huey':
      drawHuey(ctx, 0, 0, 1.2, { color: '#d8d2b0' });
      break;
    case 'b52':
      ctx.scale(1.4, 1.4);
      drawB52(ctx, 0, 0);
      ctx.fillStyle = '#d8d2b0';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(-8 + i * 8, 14, 2, 4, 0, 0, 7); ctx.fill(); }
      break;
    case 'spikes':
      ctx.lineWidth = 3.4;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(i * 9, 18); ctx.lineTo(i * 9 + 3, -12 + Math.abs(i) * 5); ctx.stroke();
      }
      break;
    case 'mine':
      ctx.beginPath(); ctx.arc(0, 4, 13, 0, 7); ctx.fill();
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI + i * Math.PI / 4;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * 13, 4 + Math.sin(a) * 13);
        ctx.lineTo(Math.cos(a) * 19, 4 + Math.sin(a) * 19); ctx.stroke();
      }
      break;
    case 'hole':
      ctx.beginPath(); ctx.ellipse(0, 10, 20, 8, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#14170f';
      ctx.beginPath(); ctx.ellipse(0, 8, 11, 4.5, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#d8d2b0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-2, 6); ctx.lineTo(14, -4); ctx.stroke();
      break;
    case 'tunnel':
      ctx.beginPath(); ctx.ellipse(0, 14, 17, 6, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#14170f';
      ctx.beginPath(); ctx.arc(0, 14, 11, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#d8d2b0'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-11, 14); ctx.lineTo(-11, 2); ctx.moveTo(11, 14); ctx.lineTo(11, 2); ctx.stroke();
      break;
  }
  ctx.restore();
}

function drawMapThumb(canvas, map) {
  canvas.width = 150; canvas.height = 44;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 44);
  g.addColorStop(0, map.pal.skyTop);
  g.addColorStop(1, map.pal.skyBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 150, 44);
  for (let l = 0; l < 3; l++) {
    ctx.fillStyle = map.pal.laneBody[l];
    ctx.beginPath();
    ctx.moveTo(0, 44);
    for (let x = 0; x <= 150; x += 6) {
      const e = elevAt(map, l, (x / 150) * WORLD_W);
      ctx.lineTo(x, 20 + l * 8 - e * 16);
    }
    ctx.lineTo(150, 44);
    ctx.closePath(); ctx.fill();
  }
}
