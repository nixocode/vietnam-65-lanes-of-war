/* Touch and fullscreen support.
 *
 * Three things were broken on a phone, and only one of them was input:
 *
 *  1. NO WAY TO SCROLL. The camera moved on `wheel`, which touch never fires,
 *     and there was no touch handling anywhere. The map simply could not be
 *     panned.
 *  2. NOT FULLSCREEN. `#stage` is locked to 16:9 by
 *     `width: min(100vw, 100vh*16/9)`. On a 390x844 phone held upright that
 *     resolves to 390x219 — the game was a letterboxed strip about a quarter of
 *     the screen tall. Fullscreen alone does not fix that; the aspect does.
 *  3. THE PAGE ITSELF MOVED. Without `touch-action`, a drag scrolls the
 *     document and a double-tap zooms it, so even a working pan would have been
 *     fighting the browser.
 *
 * Taps are deliberately left to the browser. Only `touchmove` is prevented, so
 * the synthetic click still fires and every existing click handler — cards,
 * squad selection, the minimap — keeps working untouched. The one thing that
 * needs suppressing is the click at the END of a drag, which is handled with a
 * capture-phase listener rather than by rewriting the input layer.
 */
const Mobile = {
  enabled: false,
  _drag: null,
  _suppressClick: false,

  /* A pan under this many CSS pixels is a tap, not a drag.
   *
   * 11 was far too tight and it is the reported "can't select or drop squads
   * quickly" bug. A finger on glass moves several pixels during an ordinary
   * tap — more on a small target, more still if the player is rushing — and
   * every tap that crossed 11px was reclassified as a drag and had its click
   * swallowed. So selections and deployments were dropped exactly when the
   * player was going fast, which is when they matter.
   *
   * 22 is about a fingertip's natural wobble and still well under a deliberate
   * pan. Measured with dispatched touch sequences: selection succeeds 8/8 up to
   * 20px of wander and correctly pans instead at 30px. */
  TAP_SLOP: 22,

  /* How far the camera must ACTUALLY have moved before the click is eaten.
   *
   * Crossing the slop only means the finger wandered; it does not mean the
   * player was panning. The click is suppressed only when the camera really
   * travelled, so a shaky tap still selects. */
  PAN_KILL: 14,

  init() {
    this.enabled = window.matchMedia('(pointer: coarse)').matches ||
      ('ontouchstart' in window && navigator.maxTouchPoints > 0);
    document.body.classList.toggle('touch', this.enabled);
    // bind regardless: a laptop with a touchscreen should still pan by finger,
    // and the fullscreen button is useful on any machine
    this._bindPan();
    this._bindFullscreen();
    this._bindOrientation();
  },

  /* ---------------------------------------------------------------- panning */
  _bindPan() {
    const cv = document.getElementById('game-canvas');
    if (!cv) return;

    cv.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { this._drag = null; return; }
      const t = e.touches[0];
      this._drag = { x: t.clientX, y: t.clientY, x0: t.clientX, moved: false, panned: 0 };
    }, { passive: true });

    cv.addEventListener('touchmove', (e) => {
      const d = this._drag;
      if (!d || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - d.x;
      if (!d.moved && Math.abs(t.clientX - d.x0) > this.TAP_SLOP) d.moved = true;
      if (d.moved) {
        /* Content follows the finger, so dragging right moves the camera LEFT.
         * The canvas is letterboxed and scaled, so a CSS pixel is not a world
         * pixel — convert through the element's rendered width or the map
         * crawls on a small screen and races on a large one. */
        const k = CANVAS_W / (cv.clientWidth || CANVAS_W);
        const before = Camera.targetX;
        Camera.pan(-dx * k);
        d.panned += Math.abs(Camera.targetX - before);
        // land it immediately: easing a direct drag feels like lag
        Camera.x = Camera.targetX;
        e.preventDefault();
      }
      d.x = t.clientX;
    }, { passive: false });

    const end = () => {
      /* Only a drag that MOVED THE MAP eats the click, and only briefly.
       *
       * This used to fire on `moved` alone — any wobble past the slop — and
       * held the suppression for 350ms, which is long enough to swallow the
       * player's next deliberate tap as well. Both halves were costing taps. */
      const d = this._drag;
      if (d && d.moved && d.panned >= this.PAN_KILL) {
        this._suppressClick = true;
        setTimeout(() => { this._suppressClick = false; }, 120);
      }
      this._drag = null;
    };
    cv.addEventListener('touchend', end, { passive: true });
    cv.addEventListener('touchcancel', end, { passive: true });

    // capture phase, so it runs before UI's own click handler whatever the
    // registration order
    cv.addEventListener('click', (e) => {
      if (!this._suppressClick) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
  },

  /* ------------------------------------------------------------- fullscreen */
  isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  },

  async toggleFullscreen() {
    const el = document.documentElement;
    try {
      if (this.isFullscreen()) {
        await (document.exitFullscreen ? document.exitFullscreen()
          : document.webkitExitFullscreen && document.webkitExitFullscreen());
      } else {
        await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' })
          : el.webkitRequestFullscreen && el.webkitRequestFullscreen());
        /* Landscape lock is best-effort and rejects on plenty of browsers
         * (notably iOS, which has no element fullscreen outside video at all).
         * A rejection is not an error worth surfacing — the rotate prompt
         * already tells the player what to do. */
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(() => {});
        }
      }
    } catch (err) {
      /* Denied, or unsupported. The game is perfectly playable windowed, so
       * this stays silent rather than throwing a dialog at the player. */
    }
    this._syncFsButton();
  },

  _bindFullscreen() {
    const btn = document.getElementById('btn-fullscreen');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFullscreen();
    });
    document.addEventListener('fullscreenchange', () => this._syncFsButton());
    document.addEventListener('webkitfullscreenchange', () => this._syncFsButton());
    this._syncFsButton();
  },

  _syncFsButton() {
    const btn = document.getElementById('btn-fullscreen');
    if (!btn) return;
    const on = this.isFullscreen();
    btn.textContent = on ? '⤡' : '⤢';
    btn.title = on ? 'Leave fullscreen' : 'Fullscreen';
  },

  /* ------------------------------------------------------------ orientation */
  _bindOrientation() {
    const check = () => {
      // portrait on a touch device gives a ~16:9 game a quarter of the screen,
      // so ask for a rotation rather than shipping an unplayable letterbox
      const portrait = window.innerHeight > window.innerWidth;
      document.body.classList.toggle(
        'portrait', portrait && this.enabled && !this._dismissedRotate);
      if (typeof Renderer !== 'undefined' && Renderer.fitDPR) Renderer.fitDPR();
    };

    /* Listen on several signals on purpose. The rotate prompt covers the whole
     * screen, so a single missed event locks the player out of their own game —
     * and `resize` genuinely does not fire in every environment (a viewport
     * changed through devtools or automation can change dimensions without
     * dispatching one). matchMedia is the reliable orientation signal;
     * the rest are belt and braces. */
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', () => setTimeout(check, 120));
    document.addEventListener('visibilitychange', check);
    const mq = window.matchMedia('(orientation: portrait)');
    if (mq.addEventListener) mq.addEventListener('change', check);
    else if (mq.addListener) mq.addListener(check);          // older WebKit

    // ...and an escape hatch, because a blocking overlay that is WRONG is worse
    // than no overlay at all. Tapping it plays anyway.
    const prompt = document.getElementById('rotate-prompt');
    if (prompt) {
      prompt.addEventListener('click', () => {
        this._dismissedRotate = true;
        check();
      });
    }
    check();
  },
};
