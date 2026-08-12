'use strict';

/* ============================================================================
   SKELETAL RIG — one jointed puppet per soldier, animated by interpolated joint
   rotation. This is the Warfare-1944 approach: because there is exactly ONE
   drawing of each character, he can never morph, boil, or swap between frames,
   and the motion is smooth at any framerate.

   Art comes from tools/cut_figures.py as five painted cut-outs per unit —
   head, torso, arm(+weapon), thigh, shin — each with a pivot. Far-side limbs
   are the same art drawn darker, so only near-side pieces are needed.

   If the cut-outs are missing the vector puppet below runs instead, so the
   game always draws something.
   ========================================================================== */

const RIG_TARGET_H = 84;   // on-screen height of a standing soldier at depth 1

/* draw order: far limbs, body, near limbs, weapon arm on top */
const RIG_ORDER = ['farThigh', 'farShin', 'torso', 'head', 'nearThigh', 'nearShin', 'arm'];

function _lerp(a, b, t) { return a + (b - a) * t; }
function _ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }

const Rig = {
  enabled: true,
  images: {},      // "rifleman.head" -> Image
  ready: {},       // unit -> bool

  /* ---------------- art loading ---------------- */
  load(onDone) {
    if (typeof RIG_MANIFEST === 'undefined') { if (onDone) onDone(); return; }
    let pending = 0, started = false;
    for (const unit in RIG_MANIFEST) {
      const m = RIG_MANIFEST[unit];
      for (const part of ['head', 'torso', 'arm', 'thigh', 'shin']) {
        if (!m[part]) continue;
        pending++;
        const img = new Image();
        img.onload = img.onerror = () => {
          this.images[unit + '.' + part] = img.naturalWidth ? img : null;
          if (--pending === 0 && started && onDone) onDone();
        };
        img.src = m[part].src;
      }
    }
    started = true;
    if (pending === 0 && onDone) onDone();
  },

  /* darkened copy of a limb, cached — tinting inside its own canvas keeps the
     composite from bleeding across the frame */
  _dark(id, img) {
    if (this._darkCache && this._darkCache[id]) return this._darkCache[id];
    this._darkCache = this._darkCache || {};
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(18,24,16,0.38)';
    g.fillRect(0, 0, c.width, c.height);
    this._darkCache[id] = c;
    return c;
  },

  art(key) {
    if (typeof RIG_MANIFEST === 'undefined') return null;
    const m = RIG_MANIFEST[key];
    if (!m || !m.torso) return null;
    return this.images[key + '.torso'] ? m : null;
  },

  /* ---------------- pose library ----------------
     Angles are RADIANS about each joint. 0 = the painted rest pose, so the
     weapon arm only needs the delta that brings the barrel where we want it. */
  _wpnTo(m, want) {
    const painted = (m._wpn && m._wpn.angle) || 0;
    return want - painted;
  },

  _idle(o, m) {
    const t = o.time || 0;
    const br = Math.sin(t * 1.9 + (o.x || 0) * 0.05);
    return {
      root: { x: 0, y: -Math.abs(br) * 0.5 },
      b: {
        torso: br * 0.014, head: -br * 0.012,
        nearThigh: 0.05, nearShin: 0.06, farThigh: -0.05, farShin: 0.10,
        arm: this._wpnTo(m, 0.62) * 0.35,       // relaxed, muzzle low
      },
    };
  },

  _aim(o, m) {
    const rec = (o.muzzleT || 0) > 0 ? Math.min(1, o.muzzleT / 0.07) : 0;
    // between bursts the muzzle drops — the beat that reads as working the weapon
    const rest = o.reload ? 0.30 : 0;
    return {
      root: { x: -rec * 1.6, y: 0.5 },
      b: {
        torso: 0.10 - rec * 0.04 + rest * 0.10, head: -0.10 + rest * 0.06,
        nearThigh: 0.34, nearShin: -0.16, farThigh: -0.40, farShin: 0.48,
        arm: this._wpnTo(m, -0.02 + rec * 0.16 + rest),  // level, kicks on the shot
      },
    };
  },

  _run(o, m) {
    // game.js advances `phase` by distance travelled (~11 rad/s at full speed),
    // which is ~1.75 strides a second — read it straight as radians
    const f = (o.phase || 0);
    const bob = Math.abs(Math.sin(f)) * 2.4;
    const kneeN = Math.max(0, Math.sin(f - 1.1)) * 0.95;
    const kneeF = Math.max(0, Math.sin(f + Math.PI - 1.1)) * 0.95;
    return {
      root: { x: 0, y: -bob },
      b: {
        torso: 0.22 + Math.sin(f * 2) * 0.03, head: -0.16,
        nearThigh: Math.sin(f) * 0.78, nearShin: 0.22 + kneeN,
        farThigh: Math.sin(f + Math.PI) * 0.78, farShin: 0.22 + kneeF,
        // weapon at high port, swinging a little with the stride
        arm: this._wpnTo(m, 0.30) + Math.sin(f) * 0.06,
      },
    };
  },

  _prone(o, m) {
    return {
      root: { x: -3, y: 22 },
      b: {
        torso: 1.30, head: -1.16,
        nearThigh: 1.52, nearShin: 0.12, farThigh: 1.64, farShin: 0.16,
        arm: this._wpnTo(m, -1.30),   // rifle forward along the ground
      },
    };
  },

  _death(o, m) {
    const p = _ease(Math.min(1, (o.deadT || 0) / 0.75));
    const A = o.combat ? this._aim(o, m) : this._idle(o, m);
    const B = {
      root: { x: -7, y: 24 },
      b: {
        torso: 1.52, head: 0.26,
        nearThigh: 1.32, nearShin: 0.46, farThigh: 1.12, farShin: 0.66,
        arm: this._wpnTo(m, -1.5) * 0.4,
      },
    };
    return this._blend(A, B, p);
  },

  _blend(A, B, t) {
    const out = { root: {}, b: {} };
    for (const k of ['x', 'y']) out.root[k] = _lerp(A.root[k] || 0, B.root[k] || 0, t);
    const names = new Set([...Object.keys(A.b), ...Object.keys(B.b)]);
    for (const n of names) out.b[n] = _lerp(A.b[n] || 0, B.b[n] || 0, t);
    return out;
  },

  _pose(o, m) {
    if (o.deadT != null) return this._death(o, m);
    const upright = o.combat ? this._aim(o, m)
      : (o.moving ? this._run(o, m) : this._idle(o, m));
    if ((o.transT || 0) > 0) {
      const p = _ease(1 - Math.min(1, o.transT / 0.45));
      const pr = this._prone(o, m);
      return o.transDir > 0 ? this._blend(upright, pr, p) : this._blend(pr, upright, p);
    }
    if (o.pose === 'prone') return this._prone(o, m);
    let pose = upright;
    if ((o.hitT || 0) > 0) {
      const h = Math.min(1, o.hitT / 0.16);
      pose = this._blend(pose, {
        root: { x: -h * 2.5, y: 0 },
        b: { torso: -h * 0.14, head: -h * 0.12, arm: 0 },
      }, 0.55);
    }
    return pose;
  },

  /* ---------------- drawing ---------------- */
  draw(ctx, key, o) {
    const m = this.art(key);
    if (!m) { this._vector(ctx, key, o); return; }

    const s = ((o.scale || 1) * RIG_TARGET_H) / m._bodyH;
    let alpha = o.alpha != null ? o.alpha : 1;
    if (o.deadT != null) {
      alpha *= Math.max(0, 1 - Math.max(0, o.deadT - (o.wounded ? 2.4 : 1.5)) / 0.5);
    }
    if (alpha <= 0) return;

    const P = this._pose(o, m);
    const J = m._joints;
    const dir = o.dir || 1;

    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(dir * s, s);
    ctx.globalAlpha = alpha;
    // everything hangs off the hip
    ctx.translate((P.root.x || 0), (P.root.y || 0));

    const hip = J.hip, neck = J.neck, knee = J.knee, sh = J.shoulder;
    const rel = (j, from) => [j[0] - from[0], j[1] - from[1]];

    const drawPiece = (part, angle, at, far) => {
      const im = this.images[key + '.' + part];
      const pm = m[part];
      if (!im || !pm) return;
      ctx.save();
      ctx.translate(at[0], at[1]);
      ctx.rotate(angle);
      // far limbs use a pre-darkened copy so the near side reads in front
      ctx.drawImage(far ? this._dark(key + '.' + part, im) : im, -pm.px, -pm.py);
      ctx.restore();
    };

    for (const bone of RIG_ORDER) {
      const b = P.b;
      if (bone === 'torso') {
        drawPiece('torso', b.torso || 0, [0, 0]);
      } else if (bone === 'head') {
        const d = rel(neck, hip);
        const a = (b.torso || 0);
        const c = Math.cos(a), sn = Math.sin(a);
        drawPiece('head', a + (b.head || 0),
          [d[0] * c - d[1] * sn, d[0] * sn + d[1] * c]);
      } else if (bone === 'arm') {
        const d = rel(sh, hip);
        const a = (b.torso || 0);
        const c = Math.cos(a), sn = Math.sin(a);
        drawPiece('arm', a + (b.arm || 0),
          [d[0] * c - d[1] * sn, d[0] * sn + d[1] * c]);
      } else if (bone === 'nearThigh' || bone === 'farThigh') {
        drawPiece('thigh', b[bone] || 0, [0, 0], bone[0] === 'f');
      } else {
        const th = bone === 'nearShin' ? (b.nearThigh || 0) : (b.farThigh || 0);
        const d = rel(knee, hip);
        const c = Math.cos(th), sn = Math.sin(th);
        drawPiece('shin', th + (b[bone] || 0),
          [d[0] * c - d[1] * sn, d[0] * sn + d[1] * c], bone[0] === 'f');
      }
    }
    ctx.restore();
  },

  /* world-space barrel tip, so muzzle flash and tracers start at the gun */
  muzzle(key, o) {
    const m = this.art(key);
    if (!m || !m._wpn) {
      const sc = (o.scale || 1);
      return { x: o.x + (o.dir || 1) * 20 * sc, y: o.y - 26 * sc };
    }
    const s = ((o.scale || 1) * RIG_TARGET_H) / m._bodyH;
    const P = this._pose(o, m);
    const J = m._joints;
    const ta = P.b.torso || 0;
    const dsh = [J.shoulder[0] - J.hip[0], J.shoulder[1] - J.hip[1]];
    const c = Math.cos(ta), sn = Math.sin(ta);
    const shx = dsh[0] * c - dsh[1] * sn, shy = dsh[0] * sn + dsh[1] * c;
    const wa = ta + (P.b.arm || 0) + m._wpn.angle;
    const lx = (P.root.x || 0) + shx + Math.cos(wa) * m._wpn.len;
    const ly = (P.root.y || 0) + shy + Math.sin(wa) * m._wpn.len;
    return { x: o.x + (o.dir || 1) * s * lx, y: o.y + s * ly };
  },

  drawCorpse(ctx, key, o) {
    this.draw(ctx, key, Object.assign({}, o, {
      deadT: 0.8, alpha: 0.92, moving: false, combat: false,
    }));
  },

  /* ---------------- vector fallback (art missing) ---------------- */
  _vector(ctx, key, o) {
    const C = (typeof SOLDIER_COLORS !== 'undefined' && SOLDIER_COLORS[key]) ||
      { coat: '#4d5a3c', pants: '#414c34', hat: '#3d4830', skin: '#c9a37d' };
    const s = (o.scale || 1) * 1.6;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale((o.dir || 1) * s, s);
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    const ph = (o.phase || 0) * Math.PI * 2;
    const sw = o.moving ? Math.sin(ph) * 5 : 0;
    ctx.strokeStyle = C.pants; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(sw, 0);
    ctx.moveTo(0, -13); ctx.lineTo(-sw * 0.9, 0); ctx.stroke();
    ctx.strokeStyle = C.coat; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, -12.5); ctx.lineTo(0.5, -22); ctx.stroke();
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.arc(1, -26.5, 3.6, 0, 7); ctx.fill();
    ctx.fillStyle = C.hat;
    ctx.beginPath(); ctx.ellipse(1, -28.6, 4.6, 3.1, 0, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = '#26251d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-3, -19); ctx.lineTo(11.5, -18.5); ctx.stroke();
    ctx.restore();
  },
};
