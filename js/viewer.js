// 写真の拡大表示(全画面)。左右スワイプ・ボタンで前後の写真へ。
import { h, fill, fmtDateTime } from './util.js?v=202611251008';
import { placeHeading } from './place-view.js?v=202611251008';

export class PhotoViewer {
  constructor({ getTz, onShowOnMap, onEditPlace }) {
    this.onEditPlace = onEditPlace;
    this.getTz = getTz;
    this.onShowOnMap = onShowOnMap;
    this.list = [];
    this.i = 0;
    this.img = h('img', { class: 'viewer-img', alt: '' });
    this.caption = h('div', { class: 'viewer-caption' });
    this.counter = h('span', { class: 'viewer-counter' });
    this.mapBtn = h('button', { class: 'btn', type: 'button', onclick: () => this.showOnMap() }, '地図で見る');
    this.el = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '写真', hidden: true },
      h('div', { class: 'viewer-top' },
        this.counter,
        h('button', { class: 'btn icon viewer-close', type: 'button', 'aria-label': '閉じる', onclick: () => this.close() }, '✕'),
      ),
      h('div', { class: 'viewer-stage' },
        this.img,
        h('button', { class: 'btn icon viewer-nav prev', type: 'button', 'aria-label': '前の写真', onclick: () => this.go(-1) }, '‹'),
        h('button', { class: 'btn icon viewer-nav next', type: 'button', 'aria-label': '次の写真', onclick: () => this.go(1) }, '›'),
      ),
      h('div', { class: 'viewer-bottom' }, this.caption,
        h('div', { class: 'viewer-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => this.onEditPlace && this.onEditPlace(this.list[this.i]) }, '✎ 地名'),
          this.mapBtn)),
    );
    document.body.append(this.el);

    // スワイプ操作
    let sx = null, sy = null;
    const stage = this.el.querySelector('.viewer-stage');
    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { sx = null; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) this.go(dx < 0 ? 1 : -1);
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (this.el.hidden) return;
      if (e.key === 'Escape') this.close();
      if (e.key === 'ArrowLeft') this.go(-1);
      if (e.key === 'ArrowRight') this.go(1);
    });
  }

  open(list, photo) {
    this.list = list;
    this.i = Math.max(0, list.indexOf(photo));
    this.el.hidden = false;
    document.documentElement.classList.add('no-scroll');
    this.render();
  }

  close() {
    this.el.hidden = true;
    this.img.removeAttribute('src');
    document.documentElement.classList.remove('no-scroll');
  }

  go(d) {
    if (!this.list.length) return;
    this.i = (this.i + d + this.list.length) % this.list.length;
    this.render();
  }

  render() {
    const p = this.list[this.i];
    if (!p) return;
    this.img.src = p.displayable ? p.fullUrl : (p.thumbUrl || '');
    const tz = this.getTz();
    const where = p.hasGps ? '位置: 写真のGPS'
      : p.est ? '位置: ルートの時刻から推定' : '位置: 不明(地図に表示できません)';
    fill(this.caption,
      placeHeading(p, 'viewer-place'),
      h('div', { class: 'viewer-title' }, p.time != null ? fmtDateTime(p.time, tz) : '撮影時刻不明'),
      h('div', { class: 'viewer-sub' + (p.est && !p.hasGps ? ' est' : '') }, where),
      !p.displayable ? h('div', { class: 'viewer-sub' }, 'このブラウザでは元の画像を表示できないため縮小画像を表示しています') : null,
    );
    this.counter.textContent = `${this.i + 1} / ${this.list.length}`;
    this.mapBtn.hidden = !(p.hasGps || p.est);
    this.el.querySelectorAll('.viewer-nav').forEach((b) => { b.hidden = this.list.length < 2; });
  }

  /** 地名の取得などで情報が変わったときに表示を更新 */
  refresh() {
    if (!this.el.hidden) this.render();
  }

  showOnMap() {
    const p = this.list[this.i];
    this.close();
    this.onShowOnMap && this.onShowOnMap(p);
  }
}
