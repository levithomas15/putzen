import { NOZZLES } from '../player/PressureWasher.js';

/**
 * Anzeige während des Spiels.
 *
 * Die Checkliste fasst Masken nach Beschriftung zusammen: der Gartentisch
 * besteht aus Platte und Rahmen, taucht aber als ein Eintrag auf. Ein Spieler
 * denkt in Gegenständen, nicht in Meshes.
 */

const RING_CIRCUMFERENCE = 2 * Math.PI * 52;

export class HUD {
  constructor(cleanables) {
    this.root = document.getElementById('hud');
    this.ringFg = document.getElementById('ring-fg');
    this.pct = document.getElementById('pct');
    this.checklist = document.getElementById('checklist');
    this.nozzleBar = document.getElementById('nozzles');
    this.crosshair = document.getElementById('crosshair');
    this.hint = document.getElementById('hint');
    this.toastWrap = document.getElementById('toast-wrap');

    this.shown = 0;
    this.listVisible = true;
    this._lastPct = -1;

    this._buildGroups(cleanables);
    this._buildChecklist();
    this._buildNozzles();
  }

  _buildGroups(cleanables) {
    this.groups = new Map();
    for (const mask of cleanables) {
      const label = mask.label ?? mask.id;
      if (!this.groups.has(label)) this.groups.set(label, { label, masks: [], area: 0, done: false });
      const g = this.groups.get(label);
      g.masks.push(mask);
      g.area += mask.area;
    }
  }

  _buildChecklist() {
    this.checklist.innerHTML = '';
    for (const g of this.groups.values()) {
      const row = document.createElement('div');
      row.className = 'task-row';
      row.innerHTML = `
        <span class="name">${g.label}</span>
        <span class="task-bar"><i style="width:0%"></i></span>
        <span class="val">0%</span>`;
      this.checklist.appendChild(row);
      g.el = row;
      g.bar = row.querySelector('.task-bar i');
      g.value = row.querySelector('.val');
    }
    this.checklist.classList.add('show');
  }

  _buildNozzles() {
    this.nozzleBar.innerHTML = '';
    this.nozzleEls = NOZZLES.map((n, i) => {
      const el = document.createElement('div');
      el.className = 'nozzle';
      el.innerHTML = `<b>${n.angle}</b>${n.name}`;
      this.nozzleBar.appendChild(el);
      return el;
    });
  }

  setNozzle(index) {
    this.nozzleEls.forEach((el, i) => el.classList.toggle('on', i === index));
  }

  setFiring(firing) {
    this.crosshair.classList.toggle('firing', firing);
  }

  toggleChecklist() {
    this.listVisible = !this.listVisible;
    this.checklist.classList.toggle('show', this.listVisible);
  }

  showHint(text, seconds = 4) {
    this.hint.textContent = text;
    this.hint.classList.add('show');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this.hint.classList.remove('show'), seconds * 1000);
  }

  toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.toastWrap.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  /** @param {number} total 0..1 */
  update(total) {
    const pct = Math.floor(total * 100);
    if (pct !== this._lastPct) {
      this._lastPct = pct;
      this.pct.textContent = pct;
      this.ringFg.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - total));
      // Der Ring wird zum Schluss grün — die Farbe sagt "fertig", bevor man liest
      this.ringFg.style.stroke = total >= 0.999 ? 'var(--good)' : 'var(--accent)';
    }

    for (const g of this.groups.values()) {
      let num = 0;
      for (const m of g.masks) num += m.progress * m.area;
      const p = g.area > 0 ? num / g.area : 0;
      const gp = Math.floor(p * 100);
      if (g._last !== gp) {
        g._last = gp;
        g.bar.style.width = `${gp}%`;
        g.value.textContent = `${gp}%`;
      }
      const done = p >= 0.999;
      if (done !== g.done) {
        g.done = done;
        g.el.classList.toggle('done', done);
        if (done) this.toast(`${g.label} sauber!`);
      }
    }
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }
}
