'use strict';

/* Particles, sprite-anim FX, floating text, screen shake. World-space, drawn by
   render.js. Persistent marks (craters, blood, corpses) are BAKED into
   Renderer.decalLayers via the addDecal/bakeCorpse delegates. */
class FXManager {
  constructor(map) {
    this.map = map || null;
    this.particles = [];
    this.floaters = [];
    this.decals = [[], [], []]; // legacy fallback list (used when baking unavailable)
    this.shake = 0;
    this.shakeX = 0;          // unit vector: which way the blast came from
    this.shakeY = 0;
    this.hitStop = 0;         // seconds of near-freeze, drained by App on REAL time
    this.flash = 0; // full-screen flash alpha
  }

  /* A few frames of near-freeze on a kill or a heavy blast. The cheapest way to
   * give a hit weight: the eye reads the pause as impact, not as a dropped frame.
   * Drained by App._frame against real time so it cannot slow its own recovery. */
  punch(dur, dirX, dirY) {
    this.hitStop = Math.max(this.hitStop, dur);
    if (dirX != null) {
      const m = Math.hypot(dirX, dirY) || 1;
      this.shakeX = dirX / m;
      this.shakeY = dirY / m;
    }
  }

  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 14);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.t += dt;
      if (p.t >= p.life) {
        // rounds land where they were headed
        if (p.type === 'bullet' && p.end) {
          if (p.end === 'dirt') this.dirtKick(p.x2, p.y2);
          else if (p.end === 'spark') this.add({
            x: p.x2, y: p.y2, vx: 0, vy: 0, t: 0, life: 0.08,
            size: rand(2, 3.5), color: '#ffe8b0', type: 'flash',
          });
        }
        ps.splice(i, 1); continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.g || 0) * dt;
      if (p.rotV) p.rot = (p.rot || 0) + p.rotV * dt;
      if (p.drag) { p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt; }
      if (p.floorY != null && p.y > p.floorY) { // gibs land and stick
        p.y = p.floorY;
        p.vx *= 0.3; p.vy = 0; p.g = 0; p.rotV = 0;
      }
    }
    const fs = this.floaters;
    for (let i = fs.length - 1; i >= 0; i--) {
      const f = fs[i];
      f.t += dt;
      f.y -= 14 * dt;
      if (f.t >= f.life) fs.splice(i, 1);
    }
    if (ps.length > 900) ps.splice(0, ps.length - 900);
  }

  add(p) { this.particles.push(p); }

  floater(x, y, text, color, big = false) {
    this.floaters.push({ x, y, text, color, big, t: 0, life: big ? 1.6 : 1.2 });
  }

  /* ---------- persistent marks (baked) ---------- */
  addDecal(lane, x, type, size) {
    if (this.map && typeof Renderer !== 'undefined' && Renderer.bakeDecal) {
      Renderer.bakeDecal(this.map, lane, x, type, size);
    } else {
      const d = this.decals[lane];
      d.push({ x, type, size });
      if (d.length > 40) d.shift();
    }
  }

  bakeCorpse(u, opts = {}) {
    if (this.map && typeof Renderer !== 'undefined' && Renderer.bakeCorpse) {
      Renderer.bakeCorpse(this.map, u, opts);
    }
  }

  /* ---------- sprite-anim helper ---------- */
  anim(name, x, y, opts = {}) {
    const frames = (typeof Assets !== 'undefined') && Assets.anim(name);
    if (!frames) return false;
    this.add({
      type: 'anim', anim: name, x, y, vx: opts.vx || 0, vy: opts.vy || 0, g: 0,
      t: 0, life: opts.life != null ? opts.life : frames.length / (opts.fps || 24),
      fps: opts.fps || 24, n: frames.length, h: opts.h || 64,
      add: opts.add !== false, flip: !!opts.flip, ground: !!opts.ground,
      loop: !!opts.loop, alpha: opts.alpha != null ? opts.alpha : 1,
    });
    return true;
  }

  /* ---------- weapon FX ---------- */
  muzzle(x, y, dir, scale, heavy = false) {
    const h = (heavy ? 26 : 19) * scale;
    if (!this.anim('muzzle', x + dir * 4, y, { h, fps: 55, flip: dir < 0, life: 0.09 })) {
      for (let i = 0; i < 3; i++) {
        this.add({
          x, y, vx: dir * rand(60, 160), vy: rand(-40, 40), g: 0,
          t: 0, life: rand(0.04, 0.09), size: rand(2, 4) * scale,
          color: i === 0 ? '#fff6c0' : '#ffb545', type: 'spark', drag: 4,
        });
      }
    }
    // gunsmoke wisp
    if (Math.random() < 0.5) {
      this.add({
        x: x + dir * 6, y: y - 2, vx: dir * rand(6, 18), vy: rand(-14, -6), g: -6,
        t: 0, life: rand(0.4, 0.8), size: rand(2.5, 5) * scale, color: 'smoke', type: 'smoke', drag: 1,
      });
    }
  }

  casing(x, y, dir, scale = 1) {
    this.add({
      x, y, vx: -dir * rand(18, 45), vy: rand(-70, -35), g: 420,
      t: 0, life: rand(0.35, 0.6), size: 1.6 * scale, color: '#c8a34a', type: 'dot',
    });
  }

  /* a real projectile: bright core + streak flying at 1500 px/s; impact FX
     spawn where and WHEN the round actually arrives */
  tracer(x1, y1, x2, y2, color = '#ffd98a', end = null) {
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.hypot(dx, dy) || 1;
    const sp = 1500;
    this.add({
      x: x1, y: y1, x2, y2,
      vx: dx / dist * sp, vy: dy / dist * sp,
      t: 0, life: Math.max(0.04, dist / sp),
      color, type: 'bullet', end,
    });
  }

  /* ---------- blood & gore ---------- */
  blood(x, y, scale = 1) {
    for (let i = 0; i < 6; i++) {
      this.add({
        x, y: y - 12 * scale, vx: rand(-55, 55), vy: rand(-85, -10), g: 300,
        t: 0, life: rand(0.25, 0.5), size: rand(1.5, 3) * scale, color: '#7c2418', type: 'dot',
      });
    }
    // mist
    this.add({
      x, y: y - 13 * scale, vx: rand(-8, 8), vy: rand(-18, -6), g: -4,
      t: 0, life: rand(0.3, 0.55), size: rand(4, 7) * scale, color: 'blood', type: 'smoke', drag: 1.2,
    });
  }

  gibs(x, y, scale = 1, floorY = null) {
    const fy = floorY != null ? floorY : y + 2;
    for (let i = 0; i < 9; i++) {
      const a = rand(-Math.PI, -Math.PI * 0.15), sp = rand(60, 240);
      this.add({
        x: x + rand(-4, 4), y: y - rand(6, 16) * scale,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 520,
        t: 0, life: rand(0.8, 1.6), size: rand(1.8, 3.6) * scale,
        color: Math.random() < 0.6 ? '#5c1c10' : '#7c2418', type: 'gib',
        rot: rand(0, 6), rotV: rand(-14, 14), floorY: fy + rand(-2, 5),
      });
    }
    // a couple of larger dark fragments (kept abstract, documentary register)
    for (let i = 0; i < 3; i++) {
      const a = rand(-Math.PI * 0.9, -Math.PI * 0.2), sp = rand(50, 160);
      this.add({
        x, y: y - 10 * scale, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 480,
        t: 0, life: rand(1.0, 1.7), size: rand(3.5, 5.5) * scale,
        color: '#2e2a20', type: 'gib', rot: rand(0, 6), rotV: rand(-10, 10),
        floorY: fy + rand(-2, 6),
      });
    }
    for (let i = 0; i < 8; i++) {
      this.add({
        x, y: y - 12 * scale, vx: rand(-90, 90), vy: rand(-140, -30), g: 340,
        t: 0, life: rand(0.3, 0.6), size: rand(1.5, 3) * scale, color: '#6b2014', type: 'dot',
      });
    }
    this.add({
      x, y: y - 12 * scale, vx: 0, vy: -10, g: -6,
      t: 0, life: 0.6, size: 9 * scale, color: 'blood', type: 'smoke', drag: 1,
    });
  }

  dirtKick(x, y) {
    for (let i = 0; i < 4; i++) {
      this.add({
        x: x + rand(-6, 6), y, vx: rand(-30, 30), vy: rand(-90, -30), g: 320,
        t: 0, life: rand(0.3, 0.5), size: rand(1.5, 3), color: '#8a7350', type: 'dot',
      });
    }
  }

  /* Rounds should not all kick up the same puff of dirt. What a bullet throws up
   * tells you what it just hit, and that reads at a glance. */
  splinters(x, y) {
    for (let i = 0; i < 5; i++) {
      this.add({
        x: x + rand(-5, 5), y: y + rand(-6, 6), vx: rand(-70, 70), vy: rand(-120, -20),
        g: 420, t: 0, life: rand(0.28, 0.5), size: rand(1, 2.4),
        color: i % 3 ? '#7a5a33' : '#3d2c18', type: 'dot',
      });
    }
  }

  sparks(x, y) {
    for (let i = 0; i < 6; i++) {
      this.add({
        x, y, vx: rand(-110, 110), vy: rand(-130, -10), g: 300,
        t: 0, life: rand(0.14, 0.3), size: rand(0.9, 1.8),
        color: i % 2 ? '#ffd98a' : '#ff9c4a', type: 'dot',
      });
    }
  }

  waterPlume(x, y) {
    for (let i = 0; i < 7; i++) {
      this.add({
        x: x + rand(-4, 4), y, vx: rand(-40, 40), vy: rand(-150, -60), g: 340,
        t: 0, life: rand(0.3, 0.55), size: rand(1.2, 2.8),
        color: i % 3 ? '#9fc3cc' : '#d8ecef', type: 'dot',
      });
    }
  }

  /* A boot landing lifts dust. Small, short-lived, thrown back from the stride —
   * this is most of what makes a man look like he has weight on the ground. */
  footDust(x, y, scale, dir) {
    const n = 2;
    for (let i = 0; i < n; i++) {
      this.add({
        x: x + rand(-3, 3) * scale, y: y + rand(-1, 1),
        vx: -dir * rand(6, 26) * scale, vy: rand(-26, -8) * scale, g: 90,
        t: 0, life: rand(0.26, 0.46), size: rand(1.6, 3.4) * scale,
        color: 'rgba(158,146,116,0.55)', type: 'dot',
      });
    }
  }

  /* ---------- explosions & fire ---------- */
  explosion(x, y, r, opts = {}) {
    const big = r > 70;
    this.shake = Math.min(16, this.shake + (opts.shake != null ? opts.shake : big ? 10 : 6));
    this.flash = Math.max(this.flash, big ? 0.16 : 0.06);
    const spriteOk = this.anim(big ? 'expl' : 'blast', x, y - r * 0.1, {
      h: r * 2.4, fps: big ? 13 : 11, ground: false, add: true,
    });
    if (!spriteOk) {
      this.add({ x, y, vx: 0, vy: 0, t: 0, life: 0.22, size: r * 0.95, color: '#fffcea', type: 'flash' });
      this.add({ x, y, vx: 0, vy: 0, t: 0, life: 0.16, size: r * 0.6, color: '#fff2c8', type: 'flash' });
    } else {
      this.add({ x, y, vx: 0, vy: 0, t: 0, life: 0.14, size: r * 0.7, color: '#fff2c8', type: 'flash' });
      // hand the tail to smoke as the sprite bloom ends
      for (let i = 0; i < (big ? 6 : 3); i++) {
        this.add({
          x: x + rand(-r * 0.25, r * 0.25), y: y - rand(4, r * 0.5),
          vx: rand(-12, 12), vy: rand(-46, -20), g: -12,
          t: 0, life: rand(1.2, 2.4), size: rand(10, 20), color: 'dark', type: 'smoke', drag: 0.7,
        });
      }
    }
    this.add({ x, y, vx: 0, vy: 0, t: 0, life: 0.5, size: r * 1.4, color: 'rgba(255,190,90,', type: 'shock' });
    for (let i = 0; i < (big ? 26 : 15); i++) {
      const a = rand(-Math.PI, 0), sp = rand(60, big ? 340 : 220);
      this.add({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 420,
        t: 0, life: rand(0.4, 0.9), size: rand(2, 4.5), color: Math.random() < 0.5 ? '#6b5335' : '#4a3a25', type: 'dot',
      });
    }
    for (let i = 0; i < (big ? 8 : 4); i++) {
      const a = rand(-Math.PI * 0.9, -Math.PI * 0.1), sp = rand(30, 130);
      this.add({
        x: x + rand(-r * 0.3, r * 0.3), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: -30,
        t: 0, life: rand(0.9, 2.0), size: rand(8, 18), color: 'smoke', type: 'smoke', drag: 1.2,
      });
    }
    if (big) {
      for (let i = 0; i < 7; i++) {
        this.add({
          x: x + rand(-8, 8), y: y - i * 8, vx: rand(-6, 6), vy: rand(-40, -18), g: -8,
          t: 0, life: rand(1.8, 3.2), size: rand(12, 22), color: 'dark', type: 'smoke', drag: 0.5,
        });
      }
    }
    if (!spriteOk) {
      for (let i = 0; i < (big ? 8 : 5); i++) {
        this.add({
          x: x + rand(-r * 0.4, r * 0.4), y: y - rand(0, 8), vx: rand(-30, 30), vy: rand(-140, -50), g: 120,
          t: 0, life: rand(0.2, 0.5), size: rand(3, 6), color: '#ffab3d', type: 'flame', drag: 2,
        });
      }
    }
  }

  napalmBurst(x, y, w) {
    this.shake = Math.min(14, this.shake + 7);
    this.flash = 0.35;
    let sprite = false;
    for (let i = -1; i <= 1; i++) {
      sprite = this.anim('blast', x + i * w * 0.3, y - 14, {
        h: 110, fps: 10, add: true, life: rand(0.5, 0.7),
      }) || sprite;
    }
    for (let i = 0; i < (sprite ? 14 : 30); i++) {
      const px = x + rand(-w / 2, w / 2);
      this.add({
        x: px, y, vx: rand(-40, 40), vy: rand(-220, -60), g: 160,
        t: 0, life: rand(0.5, 1.3), size: rand(6, 14), color: '#ff8a2a', type: 'flame', drag: 1.4,
      });
    }
  }

  fireTick(x0, x1, lane, map) {
    // ambient smoke over an active fire strip (flame loop drawn by renderer)
    const x = rand(x0, x1);
    const y = groundY(map, lane, x);
    if (Math.random() < 0.5) {
      this.add({
        x, y: y + 2, vx: rand(-8, 8), vy: rand(-70, -30), g: -20,
        t: 0, life: rand(0.3, 0.8), size: rand(3, 9), color: Math.random() < 0.7 ? '#ff9631' : '#ffd05a', type: 'flame', drag: 1,
      });
    }
    if (Math.random() < 0.45) {
      this.add({
        x, y: y - 6, vx: rand(-12, 12), vy: rand(-60, -25), g: -25,
        t: 0, life: rand(1.2, 2.4), size: rand(7, 15), color: 'dark', type: 'smoke', drag: 0.8,
      });
    }
  }

  glint(x, y) {
    this.add({ x, y, vx: 0, vy: 0, t: 0, life: 0.35, size: rand(2.5, 4), color: '#fff', type: 'glint' });
  }

  birds(x, y) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    const n = randi(4, 7);
    for (let i = 0; i < n; i++) {
      this.add({
        x: x + rand(-16, 16), y: y + rand(-8, 8),
        vx: dir * rand(46, 74) + rand(-8, 8), vy: rand(-34, -16), g: -2,
        t: 0, life: rand(2.2, 3.6), size: rand(1.6, 2.4),
        type: 'bird', flap: rand(0, 6),
      });
    }
  }

  smokePuffSmall(x, y) {
    this.add({
      x: x + rand(-2, 2), y: y - 2, vx: rand(-6, 6), vy: rand(-16, -8), g: -8,
      t: 0, life: rand(0.4, 0.8), size: rand(2.5, 4.5), color: 'smoke', type: 'smoke', drag: 1.2,
    });
  }

  smokePuff(x, y) {
    for (let i = 0; i < 3; i++) {
      this.add({
        x: x + rand(-4, 4), y: y + rand(-4, 4), vx: rand(-15, 15), vy: rand(-30, -10), g: -12,
        t: 0, life: rand(0.8, 1.5), size: rand(5, 10), color: 'smoke', type: 'smoke', drag: 1,
      });
    }
  }
}
