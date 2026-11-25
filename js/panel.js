// 横(iPad)/下(iPhone)のパネル: サマリーとタイムライン
import { h, fmtTime, fmtDate, fmtDist, fmtDuration, dayKey } from './util.js';
import { photoPos } from './map.js';
import { METHOD_LABEL } from './estimate.js';

/** 'YYYY-MM-DD' → '10/1(木)' */
function keyLabel(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return '日付不明';
  return fmtDate(Date.UTC(+m[1], +m[2] - 1, +m[3]), 0);
}

/** 日ごとのグループ(ルートと写真をまとめる) */
export function buildGroups(days, photos, tz) {
  const g = new Map();
  for (const d of days) g.set(d.key, { key: d.key, day: d, photos: [] });
  const unknown = [];
  for (const p of photos) {
    if (p.time == null) { unknown.push(p); continue; }
    const k = dayKey(p.time, tz);
    if (!g.has(k)) g.set(k, { key: k, day: null, photos: [] });
    g.get(k).photos.push(p);
  }
  const list = [...g.values()].sort((a, b) => {
    const na = a.key.startsWith('nodate'), nb = b.key.startsWith('nodate');
    return na !== nb ? (na ? 1 : -1) : a.key.localeCompare(b.key);
  });
  list.forEach((x, i) => { x.n = i + 1; x.color = x.day ? x.day.color : '#888'; });
  if (unknown.length) list.push({ key: 'unknown', day: null, photos: unknown, color: '#888', n: null });
  return list;
}

export class Panel {
  constructor(el, handlers) {
    this.el = el;
    this.handlers = handlers;
    this.tab = 'timeline';
    this.snap = 'peek'; // iPhone のシートの高さ: peek / half / full

    this.handle = h('button', { class: 'sheet-handle', type: 'button', 'aria-label': 'パネルの大きさを切り替え' }, h('span'));
    this.stats = h('div', { class: 'stats' });
    this.tabs = h('div', { class: 'tabs', role: 'tablist' },
      h('button', { type: 'button', role: 'tab', class: 'tab', dataset: { tab: 'timeline' } }, 'タイムライン'),
      h('button', { type: 'button', role: 'tab', class: 'tab', dataset: { tab: 'summary' } }, 'サマリー'),
    );
    this.body = h('div', { class: 'panel-body' });
    el.replaceChildren(this.handle, h('div', { class: 'panel-head' }, this.stats, this.tabs), this.body);

    this.tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab;
      if (this.isSheet() && this.snap === 'peek') this.setSnap('half');
      this.render();
      this.body.scrollTop = 0;
    });
    this.initSheet();
  }

  isSheet() { return matchMedia('(max-width: 699px)').matches; }

  // ---------------- iPhone 用ボトムシート ----------------
  initSheet() {
    this.setSnap(this.snap);
    const order = ['peek', 'half', 'full'];
    let startY = null, startH = 0, moved = false;
    const zones = [this.handle, this.el.querySelector('.panel-head')];
    for (const z of zones) {
      z.addEventListener('pointerdown', (e) => {
        if (!this.isSheet() || (e.target.closest('.tab') && z !== this.handle)) return;
        startY = e.clientY; startH = this.el.getBoundingClientRect().height; moved = false;
        z.setPointerCapture(e.pointerId);
        this.el.classList.add('dragging');
      });
      z.addEventListener('pointermove', (e) => {
        if (startY == null) return;
        const dy = startY - e.clientY;
        if (Math.abs(dy) > 6) moved = true;
        if (!moved) return;
        const max = window.innerHeight * 0.88;
        this.el.style.height = `${Math.min(max, Math.max(110, startH + dy))}px`;
      });
      const end = (e) => {
        if (startY == null) return;
        this.el.classList.remove('dragging');
        const hgt = startH + (startY - e.clientY);
        startY = null;
        if (!moved) {
          if (z === this.handle) this.setSnap(order[(order.indexOf(this.snap) + 1) % order.length]);
          return;
        }
        const vh = window.innerHeight;
        const targets = { peek: this.peekHeight(), half: vh * 0.48, full: vh * 0.86 };
        this.setSnap(order.reduce((b, k) => (Math.abs(targets[k] - hgt) < Math.abs(targets[b] - hgt) ? k : b), 'peek'));
      };
      z.addEventListener('pointerup', end);
      z.addEventListener('pointercancel', end);
    }
    matchMedia('(max-width: 699px)').addEventListener('change', () => this.setSnap(this.snap));
  }

  peekHeight() {
    return this.el.querySelector('.panel-head').getBoundingClientRect().height + 26;
  }

  setSnap(s) {
    this.snap = s;
    this.el.dataset.snap = s;
    if (!this.isSheet()) { this.el.style.height = ''; this.afterResize(); return; }
    const vh = window.innerHeight;
    const px = s === 'peek' ? this.peekHeight() : s === 'half' ? vh * 0.48 : vh * 0.86;
    this.el.style.height = `${Math.round(px)}px`;
    this.afterResize();
  }

  afterResize() {
    clearTimeout(this._rt);
    this._rt = setTimeout(() => this.handlers.onResize && this.handlers.onResize(), 260);
  }

  /** シートが小さいときに広げる(タイムライン操作時など) */
  ensureOpen() {
    if (this.isSheet() && this.snap === 'peek') this.setSnap('half');
  }

  // ---------------- 描画 ----------------
  update(state) {
    this.state = state;
    this.render();
  }

  render() {
    const s = this.state;
    if (!s) return;
    const total = s.days.reduce((a, d) => a + d.dist, 0);
    const groups = buildGroups(s.days, s.photos, s.tz);
    const dated = groups.filter((g) => g.key !== 'unknown' && !g.key.startsWith('nodate'));
    const nGps = s.photos.filter((p) => p.hasGps).length;
    const nEst = s.photos.filter((p) => !p.hasGps && p.est).length;
    this.groups = groups;

    this.stats.replaceChildren(
      stat('総移動距離', fmtDist(total)),
      stat('日数', dated.length ? `${dated.length}日` : '—'),
      stat('写真', `${s.photos.length}枚`, s.photos.length ? `推定 ${nEst} / 不明 ${s.photos.length - nGps - nEst}` : null),
    );
    for (const b of this.tabs.children) {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
    }
    this.body.replaceChildren(this.tab === 'timeline' ? this.renderTimeline(groups) : this.renderSummary(groups, total));
  }

  renderSummary(groups, total) {
    const s = this.state;
    const tz = s.tz;
    const frag = h('div', { class: 'summary' });
    const starts = s.days.map((d) => d.start).filter((x) => x != null);
    const ends = s.days.map((d) => d.end).filter((x) => x != null);
    if (starts.length) {
      const a = Math.min(...starts), b = Math.max(...ends);
      frag.append(h('div', { class: 'summary-period' },
        h('div', {}, h('span', { class: 'label' }, '出発'), ` ${fmtDate(a, tz)} ${fmtTime(a, tz)}`),
        h('div', {}, h('span', { class: 'label' }, '到着'), ` ${fmtDate(b, tz)} ${fmtTime(b, tz)}`),
        h('div', {}, h('span', { class: 'label' }, '総距離'), ` ${fmtDist(total)}`),
      ));
    }
    if (this.handlers.renderElevation) {
      const el = this.handlers.renderElevation();
      if (el) frag.append(el);
    }
    for (const g of groups) {
      if (g.key === 'unknown') continue;
      const d = g.day;
      frag.append(
        h('button', { type: 'button', class: 'day-card', style: { '--c': g.color }, onclick: () => { this.handlers.onDay && this.handlers.onDay(g); } },
          h('div', { class: 'day-card-head' },
            h('span', { class: 'day-dot' }),
            h('strong', {}, `${g.n}日目 ${keyLabel(g.key)}`),
            d ? h('span', { class: 'day-dist' }, fmtDist(d.dist)) : null,
          ),
          d && d.start != null
            ? h('div', { class: 'day-card-row' }, `${fmtTime(d.start, tz)} 〜 ${fmtTime(d.end, tz)}(${fmtDuration(d.end - d.start)})`)
            : h('div', { class: 'day-card-row hint' }, d ? 'ルートに時刻がありません' : 'この日のルートはありません'),
          h('div', { class: 'day-card-row hint' },
            `写真 ${g.photos.length}枚`,
            d && d.hasEle ? ` ・ 累積標高 +${Math.round(d.eleGain)} m / −${Math.round(d.eleLoss)} m` : ''),
        ),
      );
    }
    if (!groups.length) frag.append(h('p', { class: 'hint pad' }, 'GPXや写真を読み込むと、ここに日ごとの記録が表示されます。'));
    return frag;
  }

  renderTimeline(groups) {
    const tz = this.state.tz;
    const list = h('div', { class: 'timeline' });
    for (const g of groups) {
      const d = g.day;
      const title = g.key === 'unknown' ? '撮影時刻が不明な写真' : g.key.startsWith('nodate') ? '日付不明のルート' : `${g.n}日目 ${keyLabel(g.key)}`;
      list.append(h('div', { class: 'tl-day', style: { '--c': g.color } },
        h('span', { class: 'day-dot' }), h('span', {}, title),
        d ? h('span', { class: 'tl-day-dist' }, fmtDist(d.dist)) : null,
      ));
      const items = [];
      if (d && d.start != null) {
        const first = d.segments[0].find((p) => !p.carry) || d.segments[0][0];
        const lastSeg = d.segments[d.segments.length - 1];
        items.push({ t: d.start, kind: 'start', pt: first });
        items.push({ t: d.end, kind: 'end', pt: lastSeg[lastSeg.length - 1] });
      }
      for (const p of g.photos) items.push({ t: p.time ?? Infinity, kind: 'photo', p });
      items.sort((a, b) => a.t - b.t || (a.kind === 'start' ? -1 : 1));

      for (const it of items) {
        if (it.kind === 'photo') {
          const p = it.p;
          const pos = photoPos(p);
          const tag = p.hasGps ? null
            : p.est ? h('span', { class: 'tag est' }, '位置は推定')
            : h('span', { class: 'tag ng' }, '位置不明');
          list.append(h('div', { class: 'tl-item photo' + (pos ? '' : ' nopos'), style: { '--c': g.color }, dataset: { id: p.id } },
            h('button', { type: 'button', class: 'tl-main', onclick: () => (pos ? this.handlers.onPhoto(p) : this.handlers.onPhotoOpen(p)) },
              h('span', { class: 'tl-time' }, p.time != null ? fmtTime(p.time, tz) : '--:--'),
              p.thumbUrl ? h('img', { class: 'tl-thumb' + (p.est && !p.hasGps ? ' est' : ''), src: p.thumbUrl, alt: '', loading: 'lazy' }) : h('span', { class: 'tl-thumb noimg' }, '📷'),
              h('span', { class: 'tl-text' },
                h('span', { class: 'tl-name' }, p.name),
                tag,
                p.est && !p.hasGps ? h('span', { class: 'tl-sub' }, METHOD_LABEL[p.est.method]) : null),
            ),
            h('button', { type: 'button', class: 'btn icon tl-open', 'aria-label': '写真を拡大', onclick: () => this.handlers.onPhotoOpen(p) }, '⤢'),
          ));
        } else {
          list.append(h('div', { class: 'tl-item event', style: { '--c': g.color } },
            h('button', { type: 'button', class: 'tl-main', onclick: () => this.handlers.onPoint(it.pt, g) },
              h('span', { class: 'tl-time' }, fmtTime(it.t, tz)),
              h('span', { class: 'tl-mark ' + it.kind }),
              h('span', { class: 'tl-text' }, h('span', { class: 'tl-name' }, it.kind === 'start' ? 'ルートの記録開始' : 'ルートの記録終了')),
            ),
          ));
        }
      }
    }
    if (!groups.length) list.append(h('p', { class: 'hint pad' }, 'GPXや写真を読み込むと、ここに時系列で表示されます。'));
    return list;
  }

  /** 指定した写真の項目へスクロールして強調 */
  reveal(photo) {
    if (this.tab !== 'timeline') return;
    const el = this.body.querySelector(`.tl-item[data-id="${photo.id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el.classList.add('hl');
    setTimeout(() => el.classList.remove('hl'), 1500);
  }
}

function stat(label, value, sub) {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value),
    sub ? h('div', { class: 'stat-sub' }, sub) : null);
}
