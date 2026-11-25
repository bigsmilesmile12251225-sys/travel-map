// 旅の再生: ルートを時間順にたどり、撮影地点で写真を表示する
import { h, fill, fmtTime, fmtDate, fmtDist, haversine, dayKey } from './util.js?v=202611250937';
import { photoPos, pinIcon } from './map.js?v=202611250937';
import { placeHeading } from './place-view.js?v=202611250937';

const L = window.L;

const DAY_MS = 40000;          // ×1 のとき1日分を何ミリ秒で再生するか
const GAP_CAP = 3 * 60000;     // 記録の途切れ・長い休憩はこの長さに縮めて再生する
const MAX_POINTS = 1500;       // 1日あたりの描画点数の上限(なめらかさと速さの両立)
const TITLE_HOLD = 1800;       // 日付の見出しを表示する時間
const PHOTO_HOLD = 2600;       // 写真を表示して止まる時間(×1 のとき)
const PHOTO_HOLD_MIN = 900;    // 写真が続くときの最短表示時間
const FOLLOW_ZOOM = 15;
const SPEEDS = [0.5, 1, 2, 4];

export class Replay {
  constructor({ tripMap, getState, onOpenPhoto, onStateChange }) {
    this.tripMap = tripMap;
    this.map = tripMap.map;
    this.getState = getState;
    this.onOpenPhoto = onOpenPhoto;
    this.onStateChange = onStateChange;
    this.active = false;
    this.speed = 1;
    this.follow = true;
    this.buildUi();
  }

  // ---------------- 画面部品 ----------------
  buildUi() {
    this.playBtn = h('button', { type: 'button', class: 'btn icon replay-play', 'aria-label': '再生', onclick: () => this.toggle() }, '▶');
    this.range = h('input', { type: 'range', class: 'replay-range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': '再生位置' });
    this.speedBtn = h('button', { type: 'button', class: 'btn replay-small', 'aria-label': '再生速度', onclick: () => this.cycleSpeed() }, '×1');
    this.followBtn = h('button', { type: 'button', class: 'btn replay-small on', 'aria-pressed': 'true', onclick: () => this.setFollow(!this.follow) }, '追従');
    this.label = h('div', { class: 'replay-label' });
    this.bar = h('div', { class: 'replay-bar', hidden: true },
      this.label,
      h('div', { class: 'replay-controls' },
        this.playBtn, this.range, this.speedBtn, this.followBtn,
        h('button', { type: 'button', class: 'btn icon replay-small', 'aria-label': '再生を終了', onclick: () => this.stop() }, '✕'),
      ),
    );
    this.cardImg = h('img', { alt: '' });
    this.cardPlace = h('div', { class: 'replay-card-place' });
    this.cardCap = h('div', { class: 'replay-card-cap' });
    this.card = h('button', { type: 'button', class: 'replay-card', hidden: true, onclick: () => this.openCurrentPhoto() }, this.cardPlace, this.cardImg, this.cardCap);
    this.title = h('div', { class: 'replay-title', hidden: true });
    const area = document.querySelector('.map-area');
    area.append(this.title, this.card, this.bar);

    this.range.addEventListener('input', () => this.seek((this.range.value / 1000) * this.total));
    this.map.on('dragstart', () => { if (this.active && this.follow) this.setFollow(false); });
    // 写真の拡大表示が閉じる前に判定したいので、キャプチャ段階で受け取る
    window.addEventListener('keydown', (e) => {
      if (!this.active || document.querySelector('.viewer:not([hidden])')) return;
      if (e.target.closest && e.target.closest('input:not([type=range]), select, textarea, dialog')) return;
      if (e.key === ' ') { e.preventDefault(); this.toggle(); }
      if (e.key === 'Escape') this.stop();
    }, true);
  }

  // ---------------- データ準備 ----------------
  /** 再生できるルート(時刻付きの点が2つ以上ある日)があるか */
  static available(state) {
    return state.days.some((d) => d.segments.flat().filter((p) => p.t != null).length >= 2);
  }

  prepare(state) {
    const legs = [];
    for (const d of state.days) {
      let pts = d.segments.flat().filter((p) => p.t != null && !p.carry).sort((a, b) => a.t - b.t);
      if (pts.length < 2) continue;
      const stride = Math.ceil(pts.length / MAX_POINTS);
      if (stride > 1) pts = pts.filter((p, i) => i % stride === 0 || i === pts.length - 1);
      const e = [0], dist = [0];
      for (let i = 1; i < pts.length; i++) {
        e.push(e[i - 1] + Math.min(pts[i].t - pts[i - 1].t, GAP_CAP));
        dist.push(dist[i - 1] + haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon));
      }
      legs.push({ drawnFull: false, drawnEmpty: false, day: d, pts, ll: pts.map((p) => L.latLng(p.lat, p.lon)), e, dist, dur: e[e.length - 1] || 1 });
    }
    let off = 0;
    for (const x of legs) { x.off = off; x.rate = DAY_MS / x.dur; off += DAY_MS; }
    this.legs = legs;
    this.total = off;

    // 出来事(日付の切り替わり・写真)
    const events = legs.map((x) => ({ R: x.off, type: 'day', x }));
    for (const p of state.photos) {
      if (p.time == null) continue;
      const x = legs.find((l) => l.day.key === dayKey(p.time, state.tz));
      if (!x) continue;
      events.push({ R: x.off + this.effAt(x, p.time) * x.rate, type: 'photo', p, x });
    }
    events.sort((a, b) => a.R - b.R || (b.type === 'day') - (a.type === 'day') || (a.p && b.p ? a.p.time - b.p.time : 0));
    this.events = events;
  }

  /** 実時刻 t → その日の「再生用の経過時間」 */
  effAt(x, t) {
    const { pts, e } = x;
    if (t <= pts[0].t) return 0;
    if (t >= pts[pts.length - 1].t) return e[e.length - 1];
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].t <= t) lo = m; else hi = m; }
    const span = pts[hi].t - pts[lo].t;
    return e[lo] + (span ? (e[hi] - e[lo]) * ((t - pts[lo].t) / span) : 0);
  }

  /** 再生位置 R → 地図上の位置 */
  posAt(R) {
    const legs = this.legs;
    let k = legs.findIndex((x) => R < x.off + DAY_MS);
    if (k < 0) k = legs.length - 1;
    const x = legs[k];
    const local = Math.min(x.dur, Math.max(0, (R - x.off) / x.rate));
    const { e, pts, dist } = x;
    let lo = 0, hi = e.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e[m] <= local) lo = m; else hi = m; }
    const span = e[hi] - e[lo];
    const f = span ? (local - e[lo]) / span : 0;
    const a = pts[lo], b = pts[hi];
    return {
      k, x, i: lo,
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + (b.lon - a.lon) * f,
      t: a.t + (b.t - a.t) * f,
      dist: dist[lo] + (dist[hi] - dist[lo]) * f,
    };
  }

  // ---------------- 開始・終了 ----------------
  start() {
    const state = this.getState();
    if (!Replay.available(state)) return;
    this.prepare(state);
    this.active = true;
    this.savedView = { center: this.map.getCenter(), zoom: this.map.getZoom() };
    document.getElementById('app').classList.add('replaying');
    this.onStateChange && this.onStateChange(true);

    // 通常表示のルート・ピンを隠し、再生用のレイヤーを用意
    this.map.removeLayer(this.tripMap.routes);
    this.map.removeLayer(this.tripMap.cluster);
    this.layer = L.layerGroup().addTo(this.map);
    this.pinLayer = L.layerGroup().addTo(this.map);
    for (const x of this.legs) {
      L.polyline(x.ll, { color: x.day.color, weight: 4, opacity: 0.25, interactive: false }).addTo(this.layer);
      x.casing = L.polyline([], { color: '#fff', weight: 9, opacity: 0.9, interactive: false, className: 'route-casing' }).addTo(this.layer);
      x.line = L.polyline([], { color: x.day.color, weight: 5, opacity: 1, interactive: false }).addTo(this.layer);
    }
    this.marker = L.marker(this.legs[0].ll[0], {
      icon: L.divIcon({ className: 'replay-dot-wrap', html: '<div class="replay-dot"></div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
      interactive: false, pane: 'cursor',
    }).addTo(this.map);
    this.pins = new Map();

    this.bar.hidden = false;
    this.speed = 1;
    this.speedBtn.textContent = '×1';
    this.setFollow(true);
    this.seek(0);
    setTimeout(() => {
      this.map.invalidateSize();
      this.play();
    }, 300);
  }

  stop() {
    if (!this.active) return;
    this.pause();
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.layer.remove();
    this.pinLayer.remove();
    this.marker.remove();
    this.map.addLayer(this.tripMap.routes);
    this.map.addLayer(this.tripMap.cluster);
    this.bar.hidden = true;
    this.card.hidden = true;
    this.title.hidden = true;
    document.getElementById('app').classList.remove('replaying');
    this.onStateChange && this.onStateChange(false);
    setTimeout(() => {
      this.map.invalidateSize();
      this.map.setView(this.savedView.center, this.savedView.zoom, { animate: false });
    }, 300);
  }

  // ---------------- 操作 ----------------
  toggle() { this.playing ? this.pause() : this.play(); }

  play() {
    if (this.R >= this.total) this.seek(0);
    this.playing = true;
    this.playBtn.textContent = '❚❚';
    this.playBtn.setAttribute('aria-label', '一時停止');
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  pause() {
    this.playing = false;
    this.holdUntil = 0;
    this.playBtn.textContent = this.R >= this.total ? '↺' : '▶';
    this.playBtn.setAttribute('aria-label', this.R >= this.total ? '最初から再生' : '再生');
    cancelAnimationFrame(this.raf);
  }

  cycleSpeed() {
    this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length];
    this.speedBtn.textContent = `×${this.speed}`;
  }

  setFollow(on) {
    this.follow = on;
    this.followBtn.classList.toggle('on', on);
    this.followBtn.setAttribute('aria-pressed', String(on));
    if (on && this.active && this.cur) this.map.setView([this.cur.lat, this.cur.lon], Math.max(this.map.getZoom(), FOLLOW_ZOOM - 2), { animate: true });
  }

  /** 再生位置を移動(写真や見出しは表示しない) */
  seek(R) {
    this.R = Math.max(0, Math.min(this.total, R));
    this.holdUntil = 0;
    this.card.hidden = true;
    this.title.hidden = true;
    this.ei = this.events.findIndex((ev) => ev.R > this.R || (this.R === 0 && ev.R === 0));
    if (this.ei < 0) this.ei = this.events.length;
    // 通過済みの写真ピンをそろえる
    this.pinLayer.clearLayers();
    this.pins.clear();
    for (let j = 0; j < this.ei; j++) if (this.events[j].type === 'photo') this.addPin(this.events[j].p);
    this.render(true);
    if (this.follow) this.map.setView([this.cur.lat, this.cur.lon], this.R === 0 ? FOLLOW_ZOOM : this.map.getZoom(), { animate: false });
    if (!this.playing) this.pause();
  }

  // ---------------- 再生ループ ----------------
  tick(now) {
    if (!this.active || !this.playing) return;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    if (this.holdUntil) {
      if (now < this.holdUntil) { this.raf = requestAnimationFrame((t) => this.tick(t)); return; }
      this.holdUntil = 0;
      this.card.hidden = true;
      this.title.hidden = true;
    }
    let R = this.R + dt * this.speed;
    const ev = this.events[this.ei];
    if (ev && ev.R <= R) {
      R = ev.R;
      this.ei++;
      this.R = R;
      this.render();
      this.fire(ev, now);
    } else {
      if (R >= this.total) {
        this.R = this.total;
        this.render();
        this.pause();
        this.label.append(h('span', { class: 'replay-end' }, ' ・ おしまい'));
        return;
      }
      this.R = R;
      this.render();
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  fire(ev, now) {
    if (ev.type === 'day') {
      const d = ev.x.day;
      this.title.replaceChildren(
        h('div', { class: 'replay-title-day', style: { '--c': d.color } }, `${d.index + 1}日目`),
        h('div', { class: 'replay-title-date' }, fmtDate(ev.x.pts[0].t, this.getState().tz)),
        h('div', { class: 'replay-title-sub' }, `${fmtDist(d.dist)}`),
      );
      this.title.hidden = false;
      this.card.hidden = true;
      const p0 = ev.x.pts[0];
      if (this.follow) this.map.flyTo([p0.lat, p0.lon], FOLLOW_ZOOM, { duration: 1.2 });
      this.holdUntil = now + TITLE_HOLD;
    } else {
      const p = ev.p;
      this.currentPhoto = p;
      this.cardImg.src = p.displayable ? p.fullUrl : (p.thumbUrl || '');
      this.refreshCard();
      fill(this.cardCap,
        h('span', {}, fmtTime(p.time, this.getState().tz)),
        p.est && !p.hasGps ? h('span', { class: 'tag est' }, '位置は推定') : null,
        !photoPos(p) ? h('span', { class: 'tag ng' }, '位置不明') : null,
      );
      this.card.hidden = false;
      this.card.classList.remove('pop');
      void this.card.offsetWidth; // アニメーションをやり直す
      this.card.classList.add('pop');
      this.addPin(p);
      // 次の写真がすぐ続くなら表示時間を短く
      const next = this.events[this.ei];
      const soon = next && next.type === 'photo' && next.R - ev.R < 400;
      const hold = soon ? PHOTO_HOLD_MIN : Math.max(PHOTO_HOLD_MIN, PHOTO_HOLD / Math.sqrt(this.speed));
      this.holdUntil = now + hold;
    }
  }

  addPin(p) {
    const pos = photoPos(p);
    if (!pos || this.pins.has(p.id)) return;
    const m = L.marker(pos, { icon: pinIcon(p, 'replay-pin') }).addTo(this.pinLayer);
    m.on('click', () => { this.pause(); this.onOpenPhoto(p); });
    this.pins.set(p.id, m);
  }

  /** 写真カードの地名欄を更新(地名は後から届くことがある) */
  refreshCard() {
    const p = this.currentPhoto;
    if (!p) return;
    const head = placeHeading(p, 'replay-place');
    fill(this.cardPlace, head);
    this.cardPlace.hidden = !head;
  }

  openCurrentPhoto() {
    if (!this.currentPhoto) return;
    this.pause();
    this.onOpenPhoto(this.currentPhoto);
  }

  /** 現在位置に合わせて線・印・表示を更新 */
  render(full = false) {
    const c = this.posAt(this.R);
    this.cur = c;
    // 通過した部分の線
    for (let k = 0; k < this.legs.length; k++) {
      const x = this.legs[k];
      let ll;
      if (k < c.k) { if (!full && x.drawnFull) continue; ll = x.ll; x.drawnFull = true; }
      else if (k > c.k) { if (!full && x.drawnEmpty) continue; ll = []; x.drawnEmpty = true; x.drawnFull = false; }
      else { ll = x.ll.slice(0, c.i + 1); ll.push(L.latLng(c.lat, c.lon)); x.drawnFull = false; }
      if (k <= c.k) x.drawnEmpty = false;
      x.line.setLatLngs(ll);
      x.casing.setLatLngs(ll);
    }
    this.marker.setLatLng([c.lat, c.lon]);
    this.marker.getElement()?.style.setProperty('--c', c.x.day.color);
    if (this.follow && this.playing && !this.holdUntil) this.map.setView([c.lat, c.lon], this.map.getZoom(), { animate: false });
    this.range.value = String(Math.round((this.R / (this.total || 1)) * 1000));
    const tz = this.getState().tz;
    this.label.replaceChildren(
      h('span', { class: 'day-dot', style: { '--c': c.x.day.color } }),
      h('strong', {}, `${c.x.day.index + 1}日目`),
      ` ${fmtDate(c.t, tz)} ${fmtTime(c.t, tz)}`,
      h('span', { class: 'replay-dist' }, ` ・ ${fmtDist(c.dist)}`),
    );
  }
}
