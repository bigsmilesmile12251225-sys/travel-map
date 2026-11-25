// 標高グラフ(SVGで描画)。横軸は移動距離、縦軸は標高。
// グラフをなぞると地図上に現在地のカーソルを表示する。
import { h, fill, fmtTime, fmtDist, haversine } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export class ElevationChart {
  constructor({ onCursor }) {
    this.onCursor = onCursor;
    this.sel = 'all';
    this.data = null;
    window.addEventListener('resize', () => this.redraw());
  }

  /** 表示用データ: 選択した日のルートを距離順に並べる */
  build(days) {
    const use = this.sel === 'all' ? days : days.filter((d) => d.key === this.sel);
    const pts = [];
    let x = 0;
    for (const d of use) {
      if (!d.hasEle) continue;
      for (const seg of d.segments) {
        let prev = null;
        let first = true;
        for (const p of seg) {
          if (prev) x += haversine(prev.lat, prev.lon, p.lat, p.lon);
          prev = p;
          if (p.ele == null) continue;
          pts.push({ x, ele: p.ele, pt: p, color: d.color, day: d, brk: first });
          first = false;
        }
      }
    }
    return pts;
  }

  /** パネルに入れる要素を返す(標高データがなければ null) */
  element(state) {
    const days = state.days.filter((d) => d.hasEle);
    if (!days.length) { this.onCursor(null); return null; }
    if (this.sel !== 'all' && !days.some((d) => d.key === this.sel)) this.sel = 'all';
    this.tz = state.tz;
    this.data = this.build(state.days);

    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '表示する日' },
      h('button', { type: 'button', class: 'chip-btn' + (this.sel === 'all' ? ' on' : ''), onclick: () => this.select('all', state) }, '全日程'),
      ...days.map((d) => h('button', {
        type: 'button', class: 'chip-btn' + (this.sel === d.key ? ' on' : ''), style: { '--c': d.color }, onclick: () => this.select(d.key, state),
      }, h('span', { class: 'day-dot' }), `${d.index + 1}日目`)),
    );
    const eles = this.data.map((p) => p.ele);
    const use = this.sel === 'all' ? days : days.filter((d) => d.key === this.sel);
    const gain = use.reduce((a, d) => a + d.eleGain, 0), loss = use.reduce((a, d) => a + d.eleLoss, 0);
    const info = h('div', { class: 'ele-info' },
      h('span', {}, `最高 ${Math.round(Math.max(...eles))} m`),
      h('span', {}, `最低 ${Math.round(Math.min(...eles))} m`),
      h('span', {}, `累積 +${Math.round(gain)} / −${Math.round(loss)} m`),
    );
    this.tip = h('div', { class: 'ele-tip', hidden: true });
    this.box = h('div', { class: 'ele-box' }, this.tip);
    this.root = h('section', { class: 'ele' }, h('div', { class: 'ele-title' }, '標高グラフ'), chips, this.box, info,
      h('div', { class: 'hint' }, 'グラフを指でなぞると、地図にその地点が表示されます。'));
    requestAnimationFrame(() => this.redraw());
    return this.root;
  }

  select(key, state) {
    this.sel = key;
    const old = this.root;
    const el = this.element(state);
    if (el && old) old.replaceWith(el);
  }

  redraw() {
    if (!this.box || !this.box.isConnected || !this.data || !this.data.length) return;
    const W = Math.max(240, this.box.clientWidth), H = 170;
    const m = { l: 50, r: 10, t: 10, b: 24 };
    const pts = this.data;
    const xMax = pts[pts.length - 1].x || 1;
    let yMin = Math.min(...pts.map((p) => p.ele)), yMax = Math.max(...pts.map((p) => p.ele));
    if (yMax - yMin < 20) { const c = (yMax + yMin) / 2; yMin = c - 10; yMax = c + 10; }
    const yStep = niceStep(yMax - yMin, 3);
    yMin = Math.floor(yMin / yStep) * yStep; yMax = Math.ceil(yMax / yStep) * yStep;
    const X = (x) => m.l + (x / xMax) * (W - m.l - m.r);
    const Y = (e) => m.t + (1 - (e - yMin) / (yMax - yMin)) * (H - m.t - m.b);
    this.X = X; this.xMax = xMax; this.W = W; this.m = m;

    const svg = s('svg', { class: 'ele-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '標高グラフ' });
    // 目盛り(控えめに)
    for (let v = yMin; v <= yMax + 1e-6; v += yStep) {
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'grid' }));
      const t = s('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'axis' });
      t.textContent = `${Math.round(v)}${v + yStep > yMax + 1e-6 ? ' m' : ''}`;
      svg.append(t);
    }
    const xStep = niceStep(xMax / 1000, 4) * 1000;
    for (let v = 0; v <= xMax + 1; v += xStep) {
      const t = s('text', { x: X(v), y: H - 6, 'text-anchor': v === 0 ? 'start' : 'middle', class: 'axis' });
      t.textContent = v === 0 ? '0' : `${+(v / 1000).toFixed(xStep < 1000 ? 1 : 0)}km`;
      svg.append(t);
    }

    // 日ごとに色分けした線と面。描画点は幅に合わせて間引く
    const stride = Math.max(1, Math.floor(pts.length / (W * 1.5)));
    const runs = [];
    let cur = null;
    pts.forEach((p, i) => {
      if (!cur || p.day !== cur.day || p.brk) { cur = { day: p.day, color: p.color, pts: [] }; runs.push(cur); }
      if (i % stride === 0 || p.brk || i === pts.length - 1 || pts[i + 1]?.brk || pts[i + 1]?.day !== p.day) cur.pts.push(p);
    });
    for (const r of runs) {
      if (r.pts.length < 2) continue;
      const line = r.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.ele).toFixed(1)}`).join('');
      const area = `${line}L${X(r.pts[r.pts.length - 1].x).toFixed(1)},${Y(yMin)}L${X(r.pts[0].x).toFixed(1)},${Y(yMin)}Z`;
      svg.append(s('path', { d: area, fill: r.color, 'fill-opacity': 0.14 }));
      svg.append(s('path', { d: line, fill: 'none', stroke: r.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    // カーソル
    this.cross = s('line', { y1: m.t, y2: H - m.b, class: 'cross', visibility: 'hidden' });
    this.dot = s('circle', { r: 5, class: 'cross-dot', visibility: 'hidden' });
    svg.append(this.cross, this.dot);
    this.Y = Y;

    const hit = s('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent', class: 'hit' });
    svg.append(hit);
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      this.showAt(((e.clientX - r.left - m.l) / (W - m.l - m.r)) * xMax);
    };
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.hide(); });

    this.box.querySelector('svg')?.remove();
    this.box.prepend(svg);
  }

  showAt(x) {
    const pts = this.data;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].x < x) lo = mid; else hi = mid; }
    const p = Math.abs(pts[lo].x - x) < Math.abs(pts[hi].x - x) ? pts[lo] : pts[hi];
    const cx = this.X(p.x), cy = this.Y(p.ele);
    this.cross.setAttribute('x1', cx); this.cross.setAttribute('x2', cx);
    this.cross.setAttribute('visibility', 'visible');
    this.dot.setAttribute('cx', cx); this.dot.setAttribute('cy', cy);
    this.dot.setAttribute('fill', p.color);
    this.dot.setAttribute('visibility', 'visible');
    this.tip.hidden = false;
    fill(this.tip,
      h('strong', {}, `${Math.round(p.ele)} m`),
      h('span', {}, ` ${fmtDist(p.x)}地点`),
      p.pt.t != null ? h('span', {}, ` ・ ${p.day.index + 1}日目 ${fmtTime(p.pt.t, this.tz)}`) : null,
    );
    const tw = this.tip.offsetWidth;
    this.tip.style.left = `${Math.min(this.W - tw, Math.max(0, cx - tw / 2))}px`;
    this.onCursor(p.pt, p.color);
  }

  hide() {
    this.cross?.setAttribute('visibility', 'hidden');
    this.dot?.setAttribute('visibility', 'hidden');
    if (this.tip) this.tip.hidden = true;
    this.onCursor(null);
  }
}
