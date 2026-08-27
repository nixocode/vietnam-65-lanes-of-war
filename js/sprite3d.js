/* Sprite3D — soldiers drawn from sheets rendered off a rigged 3D model.
 *
 * Every frame of every clip came off one model under one locked orthographic
 * camera, so a soldier physically cannot morph between frames and every frame
 * shares the same anchor. That is the whole reason this path exists: the cutout
 * rig could only ever fake limbs, and per-frame AI sheets could never hold a
 * character still. See tools/render_model_sprites.py.
 *
 * It exposes the same three entry points as Rig (draw / muzzle / drawCorpse) and
 * takes priority over it when its atlases are loaded; Rig stays as the fallback.
 */
const S3_TARGET_H = 84;        // on-screen height of a soldier at scale 1, matches Rig
/* How far below a unit's origin the ground plane sits, in S3_TARGET_H units.
 * Measured off the rig it replaces: at scale 1 that rig drew an 84px soldier with
 * his boots 39px below the origin, so sprites must plant their ground line there
 * or every soldier would float or sink relative to cover and decals. */
const S3_FOOT = 39 / 84;

/* Gait tuning. A cycle length is given as a multiple of the soldier's drawn
 * height, which is what keeps the feet planted: a real walk covers about one
 * body height per cycle and a run nearly two. These sit slightly under those
 * figures, trading a trace of skate for a cadence that does not look like slow
 * motion at the pace units actually cross a lane. */
/* Troops advancing under fire should read as MOVING, not strolling. Units cross
 * a lane slowly by design, and sizing the cycle honestly to that distance gave a
 * parade-ground walk. So the run clip is used for any real movement and its cycle
 * is deliberately compressed — a shorter, quicker stride. That trades a little
 * foot-skate for urgency, which at 84px is the better deal. Walk survives only
 * for genuinely slow movement (suppressed, or easing into a slot). */
/* The run cycle is 1.5x quicker than it was (0.58 -> 0.387). Because the gait is
 * driven by DISTANCE, not time, a shorter cycle is exactly a faster cadence at
 * an unchanged movement speed: the same crossing now costs 1.5x the strides.
 * The cost is foot-skate — a 0.387 cycle is about a 32px stride at 84px tall,
 * shorter than a man that size really covers — but a visibly urgent run beats a
 * geometrically honest one at this scale, which is the trade the block above
 * already describes. Walk is untouched; it only ever runs at genuinely slow
 * speeds where the honest stride still reads correctly. */
// The speed the stride length is normalised against — the rifleman, the unit
// every other one is balanced around. See the stride note in _sel.
const S3_REF_SPD = 42;
const S3_WALK_CYCLE = 0.72;
const S3_RUN_CYCLE = 0.387;
const S3_WALK_SPD = 22;        // world px/s below which a soldier is picking his way

/* Seconds to cross-fade between two clips. Without this a man snaps from running
 * to aiming in a single frame with no settle, which is the single loudest "arcade"
 * tell in the game — the sim underneath is fine, the presentation just popped. */
const S3_BLEND = 0.18;

/* Minimum time a clip is held before another may replace it. Slightly longer
 * than the cross-fade, so a blend always has time to finish before the next one
 * starts — the previous behaviour let a new change begin while the last was
 * still resolving, which is what stacked up into visible chatter. */
const S3_CLIP_HOLD = 0.24;

/* Seconds to pivot when a soldier reverses. Flipping the sprite in one frame is
 * a teleport; easing the horizontal scale through zero reads as a man turning on
 * the spot, which is most of the difference between a token and a soldier. */
const S3_TURN = 0.15;
const S3_TURN_MIN = 0.17;      // never squash to nothing — that reads as a dropped frame

const Sprite3D = {
  enabled: false,
  units: {},                   // unit key -> { img, meta }
  _pending: 0,

  load(onDone) {
    const done = () => { if (--this._pending <= 0 && onDone) onDone(); };
    fetch('assets/sprites3d/manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m) => {
        const list = m.units || [];
        if (!list.length) { if (onDone) onDone(); return; }
        this._pending = list.length;
        for (const u of list) this._loadUnit(u, done);
      })
      .catch(() => { if (onDone) onDone(); });
  },

  _loadUnit(u, done) {
    const base = 'assets/sprites3d/' + u + '/';
    fetch(base + 'atlas.json')
      .then((r) => r.json())
      .then((meta) => new Promise((res) => {
        const img = new Image();
        img.onload = () => { this.units[u] = { img, meta }; this.enabled = true; res(); };
        img.onerror = () => res();
        img.src = base + 'atlas.png';
      }))
      .catch(() => {})
      .then(done);
  },

  has(key) { return !!this.units[key]; },

  /* ---------------- clip + frame selection ---------------- */

  /* Which clip a unit is in, and how far through it — the only place game state
   * is translated into animation, so every draw of a given unit agrees. */
  _sel(key, o) {
    const U = this.units[key];
    const C = U.meta.clips;
    const pick = (...names) => names.find((n) => C[n] && C[n].length);

    if (o.deadT != null) {
      const c = pick('death');
      const f = C[c];
      // play once over 0.75s then hold the last frame — matches Rig's death blend
      const p = Math.min(1, (o.deadT || 0) / 0.75);
      return [c, Math.min(f.length - 1, Math.floor(p * (f.length - 1) + 0.0001))];
    }
    if (o.pose === 'prone' && (o.transT || 0) <= 0) {
      /* DOWN, not flat on his face.
       *
       * The rendered `prone` clip is broken and has been since it was made. It
       * is synthesised by pitching the whole body 84 degrees about the pelvis,
       * but the arms hang off the chest and the rifle rides the right wrist, so
       * the tip-over carries the weapon into the ground behind him and folds the
       * legs back through the torso. At game size it reads as a tangle of limbs
       * with the barrel pointing at the dirt and no head to be seen — which is
       * what "firing while prone looks awful" is describing.
       *
       * Three attempts to fix it in Blender each made it worse. Counter-rotating
       * the shoulders slid the rifle off the hands entirely, because the weapon
       * is bound to the wrist by a Child-Of whose inverse was captured at the
       * original pose. A shallower 58-degree pitch just produced a diagonal
       * version of the same tangle. And the donor has no prone or crouch action
       * to borrow — all 24 of its clips are upright.
       *
       * So: use the AIM pose, which is clean, and drop the man toward the
       * ground (see PRONE_DROP in render). He reads as hunkered down behind his
       * weapon rather than lying in it, using art that is known good. The sim is
       * untouched — `prone` is still the protection state, it just looks like a
       * man who has gone to ground instead of a heap.
       */
      const c = pick('aim', 'idle');
      if (c) {
        // slow breathing, offset per man — a frozen frame reads as a bug
        const n = C[c].length;
        const t = (o.time || 0) * 0.5 + (o.gaitOff || 0);
        return [c, Math.floor(((t % 1) + 1) % 1 * n) % n];
      }
    }
    if ((o.nadeT || 0) > 0) {
      // an overhand arc, played once across the wind-up and release
      const c = pick('throw');
      if (c) {
        const p = 1 - Math.min(1, (o.nadeT || 0) / (o.nadeDur || 0.9));
        return [c, Math.min(C[c].length - 1, Math.floor(p * C[c].length))];
      }
    }
    if ((o.transT || 0) > 0 && C.dive && C.dive.length) {
      /* Going to ground is a dive rather than a pop between standing and prone.
       *
       * Getting up is that same dive PLAYED BACKWARDS. This used to run the clip
       * forward in both directions, so a man standing up threw himself at the
       * floor to do it — which, cross-faded against the standing pose he was
       * heading for, is what read as soldiers spinning in firefights. The vector
       * fallback in render.js had the direction term all along; the sprite path
       * never got it. transDir: +1 dropping, -1 rising. */
      const p = 1 - Math.min(1, (o.transT || 0) / STANCE_TRANS);
      const q = (o.transDir || 1) > 0 ? p : 1 - p;
      const n = C.dive.length;
      return ['dive', Math.min(n - 1, Math.max(0, Math.floor(q * n)))];
    }
    if ((o.hitT || 0) > 0) {
      // two flinches, chosen per soldier, so a squad taking fire is not one loop
      const c = ((o.gaitOff || 0) < 0.5 ? pick('hit', 'hit2') : pick('hit2', 'hit'));
      if (c) {
        // game.js sets hitT to 0.16 on a hit; matching that plays the whole
        // flinch instead of starting a quarter of the way in
        const p = 1 - Math.min(1, (o.hitT || 0) / 0.16);
        return [c, Math.min(C[c].length - 1, Math.floor(p * C[c].length))];
      }
    }
    if (o.moving) {
      // Foot-skate is the main thing that reads as "janky", so the gait cycle is
      // sized to the ground actually covered rather than to a fixed rate. Units
      // cross the lane slowly relative to their own height, so a walk is the
      // honest cycle for a normal advance; only genuinely quick movement runs.
      /* Hysteresis on the gait threshold. A bare `spd > S3_WALK_SPD` chattered
       * for anyone advancing at close to that speed — which is most of a squad
       * most of the time — giving `walk>run run>walk` over and over. Break into
       * a run a little above the line and drop back to a walk a little below
       * it, so a man hovering on the boundary keeps whichever gait he is in. */
      const sp = o.spd || 0;
      const r = o.ref;
      const wasRun = r ? !!r._runV : sp > S3_WALK_SPD;
      const running = wasRun ? sp > S3_WALK_SPD * 0.86 : sp > S3_WALK_SPD * 1.14;
      if (r) r._runV = running;
      const c = running ? pick(o.combat ? 'runfire' : 'run', 'run', 'walk')
        : pick('walk', 'run');
      const n = C[c].length;
      const h = S3_TARGET_H * (o.scale || 1);
      // each man carries his own stride length and where in the cycle he starts,
      // so a squad moving together never lands its feet on the same beat
      /* STRIDE SCALES WITH THE UNIT'S SPEED, so cadence stays even.
       *
       * The frame index comes off distance travelled, so with a FIXED cycle
       * length animation fps is directly proportional to how fast a unit moves:
       * a sapper at 56 px/s played 25.9 walk fps and a sniper at 30 played 13.9.
       * The sniper animated 1.87x choppier than the sapper, and the slowest
       * units — the ones you watch creeping into position — were the worst.
       *
       * That is also backwards from how walking works. People change speed
       * mostly by changing STRIDE LENGTH; cadence stays in a narrow band. A slow
       * man takes short steps, he does not take the same long stride in slow
       * motion. Scaling the cycle with speed is therefore both the fix and the
       * more honest gait: fps = spd*n / (h*C*spd/REF) cancels to n*REF/(h*C),
       * the same for every unit.
       *
       * Off the unit's BASE speed from UNITS, never the instantaneous `spd` —
       * `dist/cycle` would jump the moment the cycle changed, popping the frame
       * index every time a man accelerated out of cover.
       *
       * Result: 19.3-20.7 fps across all twelve, against 13.9-25.9 before. */
      const ud = typeof UNITS !== 'undefined' && UNITS[key];
      const strideK = ud && ud.speed
        ? clamp(ud.speed / S3_REF_SPD, 0.72, 1.25) : 1;
      const cycle = h * (running ? S3_RUN_CYCLE : S3_WALK_CYCLE)
        * (o.gaitK || 1) * strideK;
      const f = ((o.dist || 0) / cycle + (o.gaitOff || 0)) % 1;
      return [c, Math.floor((f < 0 ? f + 1 : f) * n) % n];
    }
    if (o.combat) {
      // the shot itself is a short one-shot; between shots the soldier holds aim
      const rec = o.muzzleT || 0;
      const cf = pick('fire');
      if (rec > 0 && cf) {
        const p = 1 - Math.min(1, rec / 0.12);
        return [cf, Math.min(C[cf].length - 1, Math.floor(p * C[cf].length))];
      }
      // Between bursts the man works his weapon rather than holding a rigid aim.
      // game.js already flags this; the art never used it. Blending carries the
      // rifle down and back up, which is the beat a firefight was missing.
      const c = (o.reload ? pick('idle', 'aim') : pick('aim', 'idle'));
      const n = C[c].length;
      const t = (o.time || 0) * 1.4 + (o.gaitOff || 0);
      return [c, Math.floor(((t % 1) + 1) % 1 * n) % n];
    }
    /* Two at-rest poses, and men DRIFT between them rather than being assigned
     * one for life.
     *
     * The split was a fixed `gaitOff < 0.45`, so a given man played the same
     * idle from spawn to death: a squad holding a position showed two poses,
     * frozen in whatever proportion the spawn rolls happened to give. Men
     * standing about shift their weight, and a line of troops is exactly where
     * identical animation is most obvious.
     *
     * The oscillator is slow (a ~19s period, prime-ish against the clip lengths)
     * and offset per man, so switches are rare, unsynchronised, and land inside
     * the existing `holdT` guard rather than thrashing the clip machine. */
    const drift = Math.sin((o.time || 0) * 0.33 + (o.gaitOff || 0) * 6.283) * 0.5 + 0.5;
    const c = (((o.gaitOff || 0) * 0.65 + drift * 0.35) < 0.45
      ? pick('idle', 'idle2') : pick('idle2', 'idle'));
    const n = C[c].length;
    // a per-soldier offset so a squad never breathes in lockstep
    const t = (o.time || 0) * 0.9 + (o.gaitOff || 0);
    return [c, Math.floor(((t % 1) + 1) % 1 * n) % n];
  },

  /* ---------------- drawing ---------------- */

  /* Per-soldier animation state, kept on the unit itself. Only clip CHANGES
   * blend — stepping frame to frame inside a cycle is the animation working, and
   * cross-fading those would read as double-exposure rather than motion. */
  _anim(o, clip, fi) {
    const u = o.ref;
    if (!u) return { clip, fi, prev: null, t: 1 };
    let st = u._s3;
    if (!st) {
      st = u._s3 = { clip, fi, prev: null, prevFi: 0, t: 1, dirV: o.dir || 1 };
      return st;
    }
    // pivot rather than teleport when he reverses
    const want = o.dir || 1;
    if (st.dirV !== want) {
      const step = ((Renderer._fdt || 0.016) / S3_TURN) * 2;
      st.dirV += Math.sign(want - st.dirV) * step;
      if (Math.abs(st.dirV - want) < step) st.dirV = want;
    }
    /* MINIMUM DWELL. Every input that picks a clip is a hard threshold with no
     * hysteresis — `moving` on/off, `spd > S3_WALK_SPD` for run-vs-walk, combat
     * for runfire, pose for prone — and in a firefight all of them sit right on
     * their boundary and chatter. Measured, that produced sequences like
     * `run>walk walk>idle2 idle2>walk walk>run` and clip changes 60-80 times a
     * minute on the worst men. A cross-fade of 0.18s cannot resolve a change
     * every 0.7s, so the blend never lands and the man looks like he is
     * vibrating between poses. That is the "jank".
     *
     * Debouncing each input separately was whack-a-mole — fixing `moving` just
     * moved the chatter onto the speed threshold. One dwell here covers all of
     * them at once, because this is the single point they all funnel through.
     *
     * Clips that MUST interrupt still do: getting shot, hitting the dirt,
     * throwing, and dying are all events the player must see on the frame they
     * happen. Everything else waits its turn. */
    const URGENT = st._urgent || (st._urgent = {
      death: 1, hit: 1, hit2: 1, dive: 1, throw: 1, melee: 1,
    });
    st.holdT = Math.max(0, (st.holdT || 0) - (Renderer._fdt || 0.016));
    const maySwitch = st.holdT <= 0 || URGENT[clip] || URGENT[st.clip];
    if (clip !== st.clip && maySwitch) {
      st.prev = st.clip;
      st.prevFi = st.fi;
      st.t = 0;
      st.clip = clip;
      st.holdT = S3_CLIP_HOLD;
    }
    // while holding, keep advancing the clip we are actually showing rather than
    // freezing on a stale frame index from the clip we declined to switch to
    if (clip !== st.clip) return st;
    st.fi = fi;
    if (st.t < 1) st.t = Math.min(1, st.t + (Renderer._fdt || 0.016) / S3_BLEND);
    return st;
  },

  _blit(ctx, U, clip, fi, o, alpha, dirV, swayY) {
    const M = U.meta;
    const frames = M.clips[clip];
    if (!frames || !frames.length) return;
    const idx = frames[Math.min(frames.length - 1, Math.max(0, fi))];
    /* Cells are no longer square. The figure occupied about three quarters of a
     * 128x128 cell — a quarter of every one was empty air above the head and
     * below the boots, and the browser held all of it across twelve atlases.
     * The packer now trims a fixed band (see tools/pack_sprites3d.py) and the
     * same band came off `groundY` and the muzzle points, so nothing here needs
     * to know the offset; it only needs to stop assuming width == height.
     * `cell` is still written as the WIDTH, so an atlas packed before this
     * change degrades to a stretched sprite rather than throwing. */
    const cw = M.cellW || M.cell;
    const ch = M.cellH || M.cell;
    const sx = (idx % M.cols) * cw;
    const sy = ((idx / M.cols) | 0) * ch;
    // scale so the model's reference height lands on S3_TARGET_H
    const s = ((o.scale || 1) * S3_TARGET_H) / M.figH;
    ctx.save();
    ctx.globalAlpha = alpha;
    /* PER-MAN COLOUR. Five men in a squad were five identical blits.
     *
     * `gaitK` already varies each man's animation SPEED and `gaitOff` his clip
     * PHASE, so a squad has never marched in lockstep — but every man was the
     * same pixels in the same colours, and at squad size that reads as one
     * soldier stamped five times. Uniforms fade differently, men tan
     * differently, and kit is issued at different times.
     *
     * Keyed off `gaitOff`, which is a per-man `Math.random()` fixed at spawn, so
     * a man's colour never changes frame to frame. Kept narrow deliberately:
     * this has to break up a rank without breaking the side's identity, and the
     * player reads US from VC by colour before anything else. */
    const v = o.gaitOff;
    if (v != null) {
      ctx.filter = 'brightness(' + (0.94 + v * 0.12).toFixed(3) + ') ' +
        'hue-rotate(' + ((v - 0.5) * 10).toFixed(1) + 'deg)';
    }
    // o.y is the hip line the rig drew from; the ground sits S3_FOOT below it
    ctx.translate(o.x, o.y + (swayY || 0) + S3_TARGET_H * (o.scale || 1) * S3_FOOT);
    const dv = dirV == null ? (o.dir || 1) : dirV;
    ctx.scale(Math.abs(dv) < S3_TURN_MIN ? (dv < 0 ? -S3_TURN_MIN : S3_TURN_MIN) : dv, 1);
    // the cell's x centre is the model's centreline; groundY is its ground plane
    ctx.drawImage(U.img, sx, sy, cw, ch,
      -cw * s / 2, -M.groundY * s, cw * s, ch * s);
    ctx.restore();
  },

  draw(ctx, key, o) {
    const U = this.units[key];
    if (!U) return false;
    let alpha = o.alpha != null ? o.alpha : 1;
    if (o.deadT != null) {
      alpha *= Math.max(0, 1 - Math.max(0, o.deadT - (o.wounded ? 2.4 : 1.5)) / 0.5);
    }
    if (alpha <= 0) return true;

    const [clip, fi] = this._sel(key, o);
    const st = this._anim(o, clip, fi);
    const dirV = st.dirV != null ? st.dirV : (o.dir || 1);
    // a man holding a sight picture is never perfectly still
    const sway = (clip === 'aim' || clip === 'prone')
      ? Math.sin((o.time || 0) * 2.1 + (o.gaitOff || 0) * 6.3) * 0.9 * (o.scale || 1)
      : 0;
    if (st.t < 1 && st.prev && U.meta.clips[st.prev]) {
      // outgoing pose stays at FULL alpha underneath and the incoming one fades
      // in over it, so total coverage never dips and the man cannot go see-through
      // halfway through a transition
      this._blit(ctx, U, st.prev, st.prevFi, o, alpha, dirV, sway);
      this._blit(ctx, U, clip, fi, o, alpha * st.t, dirV, sway);
    } else {
      this._blit(ctx, U, clip, fi, o, alpha, dirV, sway);
    }
    return true;
  },

  drawCorpse(ctx, key, o) {
    return this.draw(ctx, key, Object.assign({}, o, {
      deadT: 0.8, alpha: 0.92, moving: false, combat: false,
    }));
  },

  /* World-space barrel tip. Blender tracked an empty on the muzzle through every
   * frame, so this is the actual gun rather than a guess from the body. It must
   * use the same clip and frame the draw picked, or flashes lag the animation. */
  muzzle(key, o) {
    const U = this.units[key];
    const sc = o.scale || 1;
    if (!U) return { x: o.x + (o.dir || 1) * 20 * sc, y: o.y - 26 * sc };
    const M = U.meta;
    const [clip, fi] = this._sel(key, o);
    const p = M.muzzle && M.muzzle[clip] && M.muzzle[clip][fi];
    if (!p) return { x: o.x + (o.dir || 1) * 24 * sc, y: o.y - 27 * sc };
    const s = (sc * S3_TARGET_H) / M.figH;
    return {
      x: o.x + (o.dir || 1) * (p[0] - (M.cellW || M.cell) / 2) * s,
      y: o.y + S3_TARGET_H * sc * S3_FOOT + (p[1] - M.groundY) * s,
    };
  },
};
