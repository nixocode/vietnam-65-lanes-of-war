'use strict';

const UI = {
  game: null,
  active: false,
  armedUnit: null,
  armedCallin: null,
  hoverLane: null,
  hoverX: null,
  tickerItems: [],
  bannerT: 0,
  unitKeys: [],
  callinKeys: [],

  els: {},

  mouseX: null, // screen-space, for edge scrolling
  mouseY: null,

  init(canvas) {
    this.canvas = canvas;
    const el = id => document.getElementById(id);
    this.els = {
      hud: el('hud'),
      cpValue: el('cp-value'),
      moraleUs: el('morale-fill-us'),
      moraleVc: el('morale-fill-vc'),
      flagPips: el('flag-pips'),
      objective: el('objective-line'),
      unitCards: el('unit-cards'),
      callinCards: el('callin-cards'),
      ticker: el('ticker'),
      banner: el('banner'),
      targetHint: el('target-hint'),
      minimap: el('minimap'),
    };

    canvas.addEventListener('mousemove', e => this._onMove(e));
    canvas.addEventListener('click', e => this._onClick(e));
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.disarm(); });
    canvas.addEventListener('mouseleave', () => { this.hoverLane = null; this.hoverX = null; this.mouseX = null; });
    canvas.addEventListener('wheel', e => {
      if (!this.active) return;
      e.preventDefault();
      Camera.pan((e.deltaX + e.deltaY) * 1.4);
    }, { passive: false });
    if (this.els.minimap) {
      this.els.minimap.addEventListener('click', e => {
        if (!this.active) return;
        const r = this.els.minimap.getBoundingClientRect();
        const wx = ((e.clientX - r.left) / r.width) * WORLD_W;
        Camera.center(wx);
      });
    }
  },

  bind(game) {
    this.game = game;
    this.armedUnit = null;
    this.armedCallin = null;
    this.selectedSquad = null;
    this._refreshSquadPanel();
    this.tickerItems = [];
    this.els.ticker.innerHTML = '';
    this.els.banner.className = '';
    this.bannerT = 0;
    document.body.classList.toggle('side-vc', game.player === 'vc');
    this._buildCards();
    this._buildPips();
  },

  _buildCards() {
    const g = this.game;
    this.els.unitCards.innerHTML = '';
    this.els.callinCards.innerHTML = '';
    this.unitKeys = ROSTERS[g.player];
    this.callinKeys = CALLIN_ROSTERS[g.player];
    this.cardEls = {};

    this.unitKeys.forEach((key, i) => {
      const d = SQUADS[key];
      const card = document.createElement('div');
      card.className = 'card';
      card.title = `${d.name} (${d.sub}) — ${d.cost} CP`;
      const ic = document.createElement('canvas');
      const port = typeof Assets !== 'undefined' ? Assets.img(d.portrait) : null;
      if (port) {
        ic.width = 88; ic.height = 76;
        const ictx = ic.getContext('2d');
        const s = Math.max(88 / port.width, 76 / port.height);
        ictx.drawImage(port, 44 - port.width * s / 2, 38 - port.height * s / 2,
          port.width * s, port.height * s);
      } else {
        drawUnitIcon(ic, d.comp[0]);
      }
      card.appendChild(ic);
      card.insertAdjacentHTML('beforeend',
        `<div class="card-name">${d.name.toUpperCase()}</div>
         <div class="card-cost">${d.cost}</div>
         <div class="card-key">${i + 1}</div>
         <div class="card-men">×${d.comp.length}</div>
         <div class="card-cd"></div>`);
      card.addEventListener('click', () => this.armUnit(key));
      this.els.unitCards.appendChild(card);
      this.cardEls[key] = card;
    });

    this.callinKeys.forEach(key => {
      const d = CALLINS[key];
      const card = document.createElement('div');
      card.className = 'card callin';
      card.title = `${d.name} — ${d.cost} CP`;
      const ic = document.createElement('canvas');
      drawCallinIcon(ic, d.icon);
      card.appendChild(ic);
      card.insertAdjacentHTML('beforeend',
        `<div class="card-name">${d.name.toUpperCase()}</div>
         <div class="card-cost">${d.cost}</div>
         <div class="card-key">${d.key}</div>
         <div class="card-cd"></div>`);
      card.addEventListener('click', () => this.armCallin(key));
      this.els.callinCards.appendChild(card);
      this.cardEls[key] = card;
    });
  },

  _buildPips() {
    this.els.flagPips.innerHTML = '';
    this.pipEls = [];
    for (let i = 0; i < 3; i++) {
      const p = document.createElement('div');
      p.className = 'flag-pip';
      this.els.flagPips.appendChild(p);
      this.pipEls.push(p);
    }
  },

  armUnit(key) {
    if (!this.active) return;
    const g = this.game, d = SQUADS[key];
    if ((g.cool[g.player][key] || 0) > 0 || g.cp[g.player] < d.cost) { Sound.deny(); return; }
    Sound.click();
    this.armedCallin = null;
    this.armedUnit = this.armedUnit === key ? null : key;
    this._hint(this.armedUnit ? 'SELECT LANE TO DEPLOY' : null);
    this._refreshArmed();
  },

  armCallin(key) {
    if (!this.active) return;
    const g = this.game, d = CALLINS[key];
    if ((g.cool[g.player][key] || 0) > 0 || g.cp[g.player] < d.cost) { Sound.deny(); return; }
    Sound.click();
    this.armedUnit = null;
    if (d.target === 'none') {
      this.armedCallin = null;
      g.tryCallin(g.player, key, null, null);
      this._refreshArmed();
      return;
    }
    this.armedCallin = this.armedCallin === key ? null : key;
    this._hint(this.armedCallin ? d.hint : null);
    this._refreshArmed();
  },

  disarm() {
    this.armedUnit = null;
    this.armedCallin = null;
    this._hint(null);
    this._refreshArmed();
  },

  _hint(text) {
    if (text) {
      this.els.targetHint.textContent = text;
      this.els.targetHint.classList.remove('hidden');
    } else {
      this.els.targetHint.classList.add('hidden');
    }
  },

  _refreshArmed() {
    for (const k in this.cardEls) {
      this.cardEls[k].classList.toggle('armed', k === this.armedUnit || k === this.armedCallin);
    }
  },

  _canvasPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (CANVAS_W / r.width),
      y: (e.clientY - r.top) * (CANVAS_H / r.height),
    };
  },

  _laneAt(y) {
    for (let i = 0; i < 3; i++) {
      if (y >= LANE_BANDS[i][0] && y < LANE_BANDS[i][1]) return i;
    }
    return y >= LANE_BANDS[2][1] ? 2 : null;
  },

  _onMove(e) {
    const p = this._canvasPos(e);
    this.mouseX = p.x;
    this.mouseY = p.y;
    if (!this.active) return;
    this.hoverLane = this._laneAt(p.y);
    this.hoverX = clamp(p.x + Camera.x, 10, WORLD_W - 10);
  },

  _onClick(e) {
    if (!this.active) return;
    const p = this._canvasPos(e);
    const lane = this._laneAt(p.y);
    if (lane == null) { this.disarm(); this.selectSquad(null); return; }
    const g = this.game;
    const wx = clamp(p.x + Camera.x, 10, WORLD_W - 10);
    if (this.armedUnit) {
      if (g.trySpawn(g.player, this.armedUnit, lane)) {
        Sound.click();
        const d = SQUADS[this.armedUnit];
        if ((g.cool[g.player][this.armedUnit] || 0) > 0 || g.cp[g.player] < d.cost) this.disarm();
      } else {
        Sound.deny();
      }
    } else if (this.armedCallin) {
      if (g.tryCallin(g.player, this.armedCallin, lane, wx)) {
        this.disarm();
      } else {
        Sound.deny();
      }
    } else {
      // squad selection & move orders
      let best = null, bd = 1e9;
      for (const s of g.squads) {
        if (s.side !== g.player || s.lane !== lane) continue;
        if (!g.squadAlive(s).length) continue;
        const d = Math.abs(g.squadAnchor(s) - wx);
        if (d < 46 && d < bd) { bd = d; best = s; }
      }
      if (best) {
        this.selectSquad(best);
        Sound.click();
      } else if (this.selectedSquad && this.selectedSquad.lane === lane &&
                 g.squadAlive(this.selectedSquad).length) {
        g.orderSquad(this.selectedSquad, 'moveto', wx);
        Sound.click();
      } else {
        this.selectSquad(null);
      }
    }
  },

  selectSquad(s) {
    this.selectedSquad = s;
    this._refreshSquadPanel();
  },

  orderSel(order) {
    const g = this.game, s = this.selectedSquad;
    if (!s || !g) return;
    if (g.orderSquad(s, order)) Sound.click();
    else Sound.deny();
    this._refreshSquadPanel();
  },

  _refreshSquadPanel() {
    const el = document.getElementById('squad-panel');
    if (!el) return;
    const g = this.game, s = this.selectedSquad;
    if (!s || !g || !g.squadAlive(s).length) {
      el.classList.add('hidden');
      this._panelSquad = null;
      return;
    }
    const sd = SQUADS[s.key];
    el.classList.remove('hidden');
    // rebuild the DOM only when the selection changes — otherwise clicks land on
    // buttons that were just destroyed by an innerHTML refresh
    if (this._panelSquad !== s) {
      this._panelSquad = s;
      let html = `<span class="sp-name"></span>`;
      html += `<button data-o="advance">ADVANCE <i>A</i></button>`;
      html += `<button data-o="hold">HOLD <i>H</i></button>`;
      html += `<button data-o="fallback">FALL BACK <i>B</i></button>`;
      if (sd.grenades) html += `<button data-o="grenade"><span class="sp-cd"></span> <i>G</i></button>`;
      html += `<button data-o="smoke" title="Pop smoke (S)"><i>S</i></button>`;
      if (sd.suppressive) html += `<button data-o="suppress"><span class="sp-cd"></span> <i>S</i></button>`;
      el.innerHTML = html;
      el.querySelectorAll('button').forEach(b => {
        b.addEventListener('pointerdown', ev => ev.stopPropagation());
        b.addEventListener('click', ev => { ev.stopPropagation(); this.orderSel(b.dataset.o); });
      });
    }
    // cheap in-place updates every tick
    el.querySelector('.sp-name').textContent = `${sd.name.toUpperCase()} ×${g.squadAlive(s).length}`;
    const nb = el.querySelector('button[data-o="grenade"]');
    if (nb) {
      const cd = Math.ceil(s.nadeCd || 0);
      nb.disabled = cd > 0;
      nb.querySelector('.sp-cd').textContent = cd ? `GRENADES ${cd}` : 'GRENADES';
    }
    const sb = el.querySelector('button[data-o="suppress"]');
    if (sb) {
      const cd = Math.ceil(s.suppCd || 0);
      sb.disabled = cd > 0;
      sb.querySelector('.sp-cd').textContent = cd ? `SUPPRESS ${cd}` : 'SUPPRESS';
    }
  },

  handleKey(key) {
    if (!this.active) return false;
    const g = this.game;
    if (key === 'Tab') {
      // cycle own squads
      const own = g.squads.filter(s => s.side === g.player && g.squadAlive(s).length);
      if (!own.length) return true;
      const i = own.indexOf(this.selectedSquad);
      const next = own[(i + 1) % own.length];
      this.selectSquad(next);
      Camera.center(g.squadAnchor(next));
      return true;
    }
    if (this.selectedSquad && g.squadAlive(this.selectedSquad).length) {
      const up = key.toUpperCase();
      if (up === 'A') { this.orderSel('advance'); return true; }
      if (up === 'H') { this.orderSel('hold'); return true; }
      if (up === 'B') { this.orderSel('fallback'); return true; }
      if (up === 'G') { this.orderSel('grenade'); return true; }
      if (up === 'S') { this.orderSel('smoke'); return true; }
      if (up === 'S') { this.orderSel('suppress'); return true; }
    }
    const n = parseInt(key, 10);
    if (n >= 1 && n <= this.unitKeys.length) { this.armUnit(this.unitKeys[n - 1]); return true; }
    const up = key.toUpperCase();
    const ck = this.callinKeys.find(k => CALLINS[k].key === up);
    if (ck) { this.armCallin(ck); return true; }
    if (key === 'Escape') {
      if (this.selectedSquad) { this.selectSquad(null); return true; }
      this.disarm(); return true;
    }
    return false;
  },

  update(dt) {
    const g = this.game;
    if (!g) return;

    // keep world-space hover in sync while the camera pans under a still mouse
    if (this.active && this.mouseX != null) {
      this.hoverLane = this._laneAt(this.mouseY);
      this.hoverX = clamp(this.mouseX + Camera.x, 10, WORLD_W - 10);
    }

    this.els.cpValue.textContent = Math.floor(g.cp[g.player]);
    this.els.moraleUs.style.width = `${clamp(g.morale.us, 0, 100)}%`;
    this.els.moraleVc.style.width = `${clamp(g.morale.vc, 0, 100)}%`;
    this.els.objective.textContent = g.objectiveText();

    g.flags.forEach((f, i) => {
      this.pipEls[i].className = 'flag-pip' + (f.owner ? ' ' + f.owner : '');
    });

    // card states
    for (const k of this.unitKeys) {
      const d = SQUADS[k], card = this.cardEls[k];
      const cd = g.cool[g.player][k] || 0;
      card.querySelector('.card-cd').style.height = cd > 0 ? `${(cd / d.cd) * 100}%` : '0%';
      card.classList.toggle('unaffordable', g.cp[g.player] < d.cost);
    }
    for (const k of this.callinKeys) {
      const d = CALLINS[k], card = this.cardEls[k];
      const cd = g.cool[g.player][k] || 0;
      card.querySelector('.card-cd').style.height = cd > 0 ? `${(cd / d.cd) * 100}%` : '0%';
      card.classList.toggle('unaffordable', g.cp[g.player] < d.cost);
    }

    // ticker
    while (g.events.length) {
      const ev = g.events.shift();
      const div = document.createElement('div');
      div.className = `tk-${ev.cls}`;
      div.textContent = `▸ ${ev.text}`;
      this.els.ticker.appendChild(div);
      this.tickerItems.push({ el: div, t: 0 });
      Sound.radio && ev.cls === 'sys';
    }
    for (let i = this.tickerItems.length - 1; i >= 0; i--) {
      const it = this.tickerItems[i];
      it.t += dt;
      if (it.t > 6 || this.tickerItems.length - i > 4) {
        it.el.remove();
        this.tickerItems.splice(i, 1);
      } else if (it.t > 4.5) {
        it.el.style.opacity = String(1 - (it.t - 4.5) / 1.5);
      }
    }

    // squad panel upkeep: cooldown counters, deselect the dead
    this._panelT = (this._panelT || 0) + dt;
    if (this.selectedSquad && !g.squadAlive(this.selectedSquad).length) {
      this.selectSquad(null);
    } else if (this._panelT > 0.4 && this.selectedSquad) {
      this._panelT = 0;
      this._refreshSquadPanel();
    }

    // banner
    if (g.banner && g.banner.fresh) {
      g.banner.fresh = false;
      this.els.banner.textContent = g.banner.text;
      this.els.banner.className = 'show' + (g.banner.danger ? ' danger' : '');
      this.bannerT = 2.0;
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.els.banner.className = '';
    }
  },
};
