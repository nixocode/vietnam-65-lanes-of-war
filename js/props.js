/* Props — scenery rendered off the SAME orthographic side camera as the soldiers.
 *
 * The world used to be drawn in a different visual language from the troops:
 * buildings in 3/4 view standing beside strictly-profile men. That collage was the
 * most obvious thing left wrong with the art, and no amount of character work
 * fixes it — the fix is to put the scenery on the same camera, which is what
 * tools/render_props.py does.
 *
 * Every prop carries its real height in metres. A soldier is 1.8 m drawn at
 * S3_TARGET_H px, so a hut is placed at its true size relative to the men rather
 * than eyeballed.
 */
const PROP_MAN_M = 1.8;                 // a soldier's height, the scale reference

const Props = {
  ready: false,
  items: {},                            // name -> { img, meta }

  load(onDone) {
    fetch('assets/props/props.json')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const list = d.props || [];
        let left = list.length;
        if (!left) { if (onDone) onDone(); return; }
        for (const p of list) {
          const img = new Image();
          img.onload = () => {
            this.items[p.name] = { img, meta: p };
            this.ready = true;
            if (--left <= 0 && onDone) onDone();
          };
          img.onerror = () => { if (--left <= 0 && onDone) onDone(); };
          img.src = 'assets/props/' + p.name + '.png';
        }
      })
      .catch(() => { if (onDone) onDone(); });
  },

  has(name) { return !!this.items[name]; },

  /* Height in on-screen pixels this prop should occupy at a given lane scale. */
  pxHeight(name, scale) {
    const it = this.items[name];
    if (!it) return 0;
    return (it.meta.realH / PROP_MAN_M) * S3_TARGET_H * (scale || 1);
  },

  /* Props render at 512px but draw at 60-200px. Sampling the full source every
   * frame cost several megapixels for nothing, so each size is pre-scaled once
   * into a small canvas and reused. Bucketed to 8px so a hundred slightly
   * different palm heights do not each mint their own texture. */
  _scaled(it, dw) {
    const b = Math.max(8, Math.round(dw / 8) * 8);
    const cache = it.cache || (it.cache = {});
    let c = cache[b];
    if (!c) {
      c = document.createElement('canvas');
      c.width = b;
      c.height = b;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(it.img, 0, 0, b, b);
      cache[b] = c;
      // a runaway cache would be its own leak; props only ever need a few sizes
      const keys = Object.keys(cache);
      if (keys.length > 14) delete cache[keys[0]];
    }
    return c;
  },

  /* Draw with its base planted on (x, groundY). `fit` overrides the authored
   * height when a map wants a specific size — the aspect ratio is kept either
   * way, so nothing ever stretches. */
  draw(ctx, name, x, groundY, scale, opts = {}) {
    const it = this.items[name];
    if (!it) return false;
    const m = it.meta;
    const h = opts.fit ? opts.fit : this.pxHeight(name, scale);
    // the rendered frame is square with the prop's base at meta.groundY
    const k = h / (m.hM * m.ppm);
    const dw = m.res * k;
    if (dw < 1) return true;
    const src = this._scaled(it, dw);
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    ctx.translate(x, groundY);
    if (opts.flip) ctx.scale(-1, 1);
    ctx.drawImage(src, -dw / 2, -m.groundY * k, dw, dw);
    ctx.restore();
    return true;
  },
};
