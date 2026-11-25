// ルートの一部の差し替え
// GPSがうまく取れなかった区間(例: 新幹線)を、別の日に同じ場所を通ったときのルートで置き換える。
// 修正内容は時刻(UTC)で記録して端末に保存し、同じGPXを読み込み直しても再現する。
import { h, fill, fmtDate, fmtTime, haversine } from './util.js?v=202611251019';

const L = window.L;
const KEY = 'travel-map-route-edits-v1';
const TAP_RADIUS = 44;          // タップした位置からこのピクセル以内の点を選ぶ
const SUGGEST_MAX_DIST = 2000;  // 自動で探すとき、始点・終点からこの距離(m)以内の点だけを候補にする

// ---------------- 保存 ----------------
export function loadEdits() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch { return []; }
}
function saveEdits(edits) {
  try { localStorage.setItem(KEY, JSON.stringify(edits)); } catch { /* 保存できなくても今回の表示には反映 */ }
}

/** 元のトラックの時刻付きの点を時刻順に */
function timedPoints(tracks) {
  const pts = [];
  for (const tr of tracks) for (const s of tr.segments) for (const p of s) if (p.t != null) pts.push(p);
  return pts.sort((a, b) => a.t - b.t);
}

/**
 * 修正を反映したトラックを返す(元のトラックは変更しない)。
 * edit = { id, a, b, c, d }: a〜b の区間を、c〜d の区間のルートで置き換える(c > d なら逆向きに使う)
 */
export function applyRouteEdits(tracks, edits) {
  const applied = new Set();
  if (!edits.length) return { tracks, applied };
  const src = timedPoints(tracks);
  const out = tracks.map((tr) => ({ ...tr, segments: tr.segments.map((s) => s.slice()) }));
  for (const e of edits) {
    const lo = Math.min(e.c, e.d), hi = Math.max(e.c, e.d);
    let source = src.filter((p) => p.t >= lo && p.t <= hi);
    if (source.length < 2) continue;
    if (e.c > e.d) source = source.slice().reverse();

    // 差し替える区間の点を取り除く(始点・終点は残す)
    for (const tr of out) tr.segments = tr.segments.map((s) => s.filter((p) => !(p.t != null && p.t > e.a && p.t < e.b)));
    // 始点の直後に差し込む
    let seg = null, idx = -1;
    for (const tr of out) for (const s of tr.segments) {
      const i = s.findIndex((p) => p.t === e.a);
      if (i >= 0 && !seg) { seg = s; idx = i; }
    }
    if (!seg) continue;
    const cum = [0];
    for (let i = 1; i < source.length; i++) cum.push(cum[i - 1] + haversine(source[i - 1].lat, source[i - 1].lon, source[i].lat, source[i].lon));
    const total = cum[cum.length - 1] || 1;
    const span = e.b - e.a;
    const added = source.map((p, i) => ({
      lat: p.lat, lon: p.lon, ele: p.ele,
      t: e.a + span * (0.001 + 0.998 * (cum[i] / total)), // 始点・終点の時刻とは重ならないように
      edited: true,
    }));
    seg.splice(idx + 1, 0, ...added);
    applied.add(e.id);
  }
  return { tracks: out, applied };
}

// ---------------- 画面 ----------------
export class RouteEditor {
  constructor({ tripMap, getState, onChange, onModeChange }) {
    this.tripMap = tripMap;
    this.map = tripMap.map;
    this.getState = getState;
    this.onChange = onChange;
    this.onModeChange = onModeChange;
    this.edits = loadEdits();
    this.active = false;

    this.msg = h('div', { class: 'edit-msg' });
    this.actions = h('div', { class: 'edit-actions' });
    this.bar = h('div', { class: 'edit-bar', hidden: true }, this.msg, this.actions);
    document.querySelector('.map-area').append(this.bar);
    this.map.on('click', (e) => this.onTap(e));
  }

  // ---------- 修正の一覧(パネルから使う) ----------
  list() { return this.edits; }

  remove(id) {
    this.edits = this.edits.filter((e) => e.id !== id);
    saveEdits(this.edits);
    this.onChange();
  }

  describe(e, tz) {
    const span = (x, y) => `${fmtDate(Math.min(x, y), tz)} ${fmtTime(Math.min(x, y), tz)}〜${fmtTime(Math.max(x, y), tz)}`;
    return { target: span(e.a, e.b), source: span(e.c, e.d) + (e.c > e.d ? '(逆向き)' : '') };
  }

  // ---------- 修正モード ----------
  start() {
    if (this.active) return;
    this.active = true;
    this.sel = {};
    this.layer = L.layerGroup().addTo(this.map);
    this.map.removeLayer(this.tripMap.cluster); // 写真ピンを誤ってタップしないよう隠す
    document.getElementById('app').classList.add('editing');
    this.bar.hidden = false;
    this.onModeChange && this.onModeChange(true);
    setTimeout(() => this.map.invalidateSize(), 300);
    this.step('a');
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.layer.remove();
    this.map.addLayer(this.tripMap.cluster);
    document.getElementById('app').classList.remove('editing');
    this.bar.hidden = true;
    this.onModeChange && this.onModeChange(false);
    setTimeout(() => this.map.invalidateSize(), 300);
  }

  /** 選べる点: 元のトラックの時刻付きの点のうち、すでに差し替えた区間に含まれないもの */
  candidates({ excludeTarget = false } = {}) {
    const st = this.getState();
    let pts = timedPoints(st.tracks).filter((p) => !this.edits.some((e) => p.t > e.a && p.t < e.b));
    if (excludeTarget && this.sel.a && this.sel.b) {
      const lo = Math.min(this.sel.a.t, this.sel.b.t), hi = Math.max(this.sel.a.t, this.sel.b.t);
      pts = pts.filter((p) => p.t < lo || p.t > hi);
    }
    return pts;
  }

  nearestOnScreen(latlng, pts) {
    const tap = this.map.latLngToContainerPoint(latlng);
    let best = null, bd = Infinity;
    for (const p of pts) {
      const c = this.map.latLngToContainerPoint([p.lat, p.lon]);
      const d = (c.x - tap.x) ** 2 + (c.y - tap.y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return bd <= TAP_RADIUS ** 2 ? best : null;
  }

  onTap(e) {
    if (!this.active || !['a', 'b', 'c', 'd'].includes(this.cur)) return;
    const isSource = this.cur === 'c' || this.cur === 'd';
    const p = this.nearestOnScreen(e.latlng, this.candidates({ excludeTarget: isSource }));
    if (!p) { this.flashMsg('ルートの線の近くをタップしてください'); return; }
    this.sel[this.cur] = p;
    if (this.cur === 'a') this.step('b');
    else if (this.cur === 'b') {
      if (this.sel.a.t === this.sel.b.t) { this.sel.b = null; this.flashMsg('始まりと違う地点をタップしてください'); return; }
      this.suggest() ? this.step('confirm') : this.step('c');
    } else if (this.cur === 'c') this.step('d');
    else {
      if (this.sel.c.t === this.sel.d.t) { this.sel.d = null; this.flashMsg('始まりと違う地点をタップしてください'); return; }
      this.step('confirm');
    }
  }

  /** 差し替え区間の始点・終点の近くを通る、別の時間帯のルートを探す */
  suggest() {
    const { a, b } = this.sel;
    const lo = Math.min(a.t, b.t), hi = Math.max(a.t, b.t);
    const pts = this.candidates({ excludeTarget: true });
    // 記録のひとまとまり(3時間以上の途切れで区切る)ごとに、a と b それぞれに最も近い点を探す
    const groups = [];
    let cur = null;
    for (const p of pts) {
      if (!cur || p.t - cur[cur.length - 1].t > 3 * 3600000) { cur = []; groups.push(cur); }
      cur.push(p);
    }
    let best = null;
    for (const g of groups) {
      let c = null, dc = Infinity, d = null, dd = Infinity;
      for (const p of g) {
        const x = haversine(p.lat, p.lon, a.lat, a.lon);
        if (x < dc) { dc = x; c = p; }
        const y = haversine(p.lat, p.lon, b.lat, b.lon);
        if (y < dd) { dd = y; d = p; }
      }
      if (!c || !d || c.t === d.t || dc > SUGGEST_MAX_DIST || dd > SUGGEST_MAX_DIST) continue;
      // 差し替え区間と時間が重なるものは使わない
      if (Math.max(c.t, d.t) > lo && Math.min(c.t, d.t) < hi) continue;
      const score = dc + dd;
      if (!best || score < best.score) best = { c, d, score };
    }
    if (!best) return false;
    this.sel.c = best.c;
    this.sel.d = best.d;
    this.suggested = true;
    return true;
  }

  step(s) {
    this.cur = s;
    const tz = this.getState().tz;
    const btn = (label, fn, cls = '') => h('button', { type: 'button', class: 'btn ' + cls, onclick: fn }, label);
    const cancel = btn('キャンセル', () => this.stop());
    const restart = btn('最初から', () => { this.sel = {}; this.step('a'); });
    this.drawSelection();
    if (s === 'a') {
      this.suggested = false;
      fill(this.msg, h('strong', {}, '① 差し替えたい区間の「始まり」'), 'を、おかしくなっているルートの線の上でタップしてください(例: 敦賀駅)。');
      fill(this.actions, cancel);
    } else if (s === 'b') {
      fill(this.msg, h('strong', {}, '② 区間の「終わり」'), 'をタップしてください(例: 自宅)。', h('br'), h('span', { class: 'hint' }, `始まり: ${fmtDate(this.sel.a.t, tz)} ${fmtTime(this.sel.a.t, tz)}`));
      fill(this.actions, restart, cancel);
    } else if (s === 'c') {
      fill(this.msg, h('strong', {}, '③ 代わりに使うルート'), 'の上で、①と同じ場所をタップしてください(例: 行きの敦賀駅)。',
        this.suggested ? null : h('div', { class: 'hint' }, '同じ場所を通る別のルートが自動では見つかりませんでした。'));
      fill(this.actions, restart, cancel);
    } else if (s === 'd') {
      fill(this.msg, h('strong', {}, '④ 代わりに使うルート'), 'の上で、②と同じ場所をタップしてください(例: 行きの自宅)。');
      fill(this.actions, restart, cancel);
    } else if (s === 'confirm') {
      const pr = this.preview();
      fill(this.msg,
        h('strong', {}, '赤い破線'), `の区間(${pr.target})を、`, h('strong', {}, '緑の線'), `のルート(${pr.source})で差し替えます。`,
        this.suggested ? h('div', { class: 'hint' }, '同じ場所を通る別のルートから自動で選びました。違う場合は「代わりのルートを選び直す」を押してください。') : null,
      );
      fill(this.actions,
        btn('差し替える', () => this.commit(), 'primary'),
        btn('代わりのルートを選び直す', () => { this.sel.c = this.sel.d = null; this.suggested = false; this.step('c'); }),
        restart, cancel);
    }
  }

  /** 選択中の区間を地図に表示 */
  drawSelection() {
    this.layer.clearLayers();
    const st = this.getState();
    const all = timedPoints(st.tracks);
    const range = (x, y) => all.filter((p) => p.t >= Math.min(x.t, y.t) && p.t <= Math.max(x.t, y.t)).map((p) => [p.lat, p.lon]);
    const { a, b, c, d } = this.sel;
    if (a && b) L.polyline(range(a, b), { color: '#d0312d', weight: 6, dashArray: '8 8', opacity: 0.95, interactive: false }).addTo(this.layer);
    if (c && d) {
      L.polyline(range(c, d), { color: '#fff', weight: 11, opacity: 0.9, interactive: false }).addTo(this.layer);
      L.polyline(range(c, d), { color: '#1f9d55', weight: 7, opacity: 1, interactive: false }).addTo(this.layer);
    }
    const mark = (p, label, color) => p && L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: 'edit-mark-wrap', html: `<div class="edit-mark" style="--c:${color}">${label}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
      interactive: false, pane: 'cursor',
    }).addTo(this.layer);
    mark(a, '①', '#d0312d'); mark(b, '②', '#d0312d'); mark(c, '③', '#1f9d55'); mark(d, '④', '#1f9d55');
  }

  preview() {
    const { a, b, c, d } = this.sel;
    const pts = [a, b, c, d].filter(Boolean).map((p) => [p.lat, p.lon]);
    // 下の操作バーに隠れないよう、下側の余白を大きく取る
    this.map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [50, 50], paddingBottomRight: [50, this.bar.offsetHeight + 40], maxZoom: 15 });
    // 始まりの時刻が先になるように並べ替えたときの対応
    const [x, y, u, v] = a.t < b.t ? [a, b, c, d] : [b, a, d, c];
    return this.describe({ a: x.t, b: y.t, c: u.t, d: v.t }, this.getState().tz);
  }

  commit() {
    const { a, b, c, d } = this.sel;
    // a が b より後なら入れ替える(c, d も対応させる)
    const [x, y, u, v] = a.t < b.t ? [a, b, c, d] : [b, a, d, c];
    this.edits.push({ id: 'e' + Date.now(), a: x.t, b: y.t, c: u.t, d: v.t });
    saveEdits(this.edits);
    this.stop();
    this.onChange();
  }

  flashMsg(text) {
    const n = h('div', { class: 'edit-warn' }, text);
    this.msg.append(n);
    setTimeout(() => n.remove(), 2000);
  }
}
