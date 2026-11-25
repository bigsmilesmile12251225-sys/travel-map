// 地名の手入力による修正。修正内容はこの端末に保存し、同じ写真を読み込み直しても反映する。
import { h, fill } from './util.js?v=202611251005';
import { photoPos } from './map.js?v=202611251005';
import { keyOf } from './places.js?v=202611251005';

const KEY = 'travel-map-place-overrides-v1';

let overrides = {};
try { overrides = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { overrides = {}; }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(overrides)); } catch { /* 保存できなくても今回の表示には反映 */ }
}

/** 写真を見分けるキー(ファイル名+撮影日時。読み込み直しても同じになる) */
const photoKey = (p) => `photo:${p.name}|${p.dateStr || p.size}`;
/** 撮影地点のキー(約10m単位) */
function spotKey(p) {
  const pos = photoPos(p);
  return pos ? `spot:${keyOf(pos[0], pos[1])}` : null;
}

/** 手入力の地名を写真に割り当てる(写真ごとの修正 > 地点ごとの修正) */
export function applyOverrides(photos) {
  for (const p of photos) {
    const sk = spotKey(p);
    p.placeManual = overrides[photoKey(p)] || (sk && overrides[sk]) || null;
  }
}

/** 表示に使う地名(手入力があればそれを優先) */
export const placeOf = (p) => p.placeManual || p.place || null;

export class PlaceEditor {
  constructor({ getPhotos, onChange }) {
    this.getPhotos = getPhotos;
    this.onChange = onChange;
    this.titleInput = h('input', { class: 'field', type: 'text', maxlength: 60, placeholder: '例: 清水寺', enterkeyhint: 'done' });
    this.subInput = h('input', { class: 'field', type: 'text', maxlength: 80, placeholder: '例: 京都府 京都市 東山区' });
    this.scopeBox = h('div', { class: 'scope' });
    this.autoNote = h('p', { class: 'hint' });
    this.resetBtn = h('button', { type: 'button', class: 'btn danger', onclick: () => this.reset() }, '手入力をやめる');
    this.el = h('dialog', { class: 'sheet place-dialog' },
      h('div', { class: 'sheet-head' },
        h('h2', {}, '地名を修正'),
        h('button', { class: 'btn icon', type: 'button', 'aria-label': '閉じる', onclick: () => this.el.close() }, '✕'),
      ),
      h('form', { class: 'sheet-body', method: 'dialog', onsubmit: (e) => { e.preventDefault(); this.save(); } },
        h('label', { class: 'form-row' }, '名前(大きく表示)', this.titleInput),
        h('label', { class: 'form-row' }, '補足(小さく表示・空欄でも可)', this.subInput),
        this.autoNote,
        this.scopeBox,
        h('div', { class: 'form-actions' },
          this.resetBtn,
          h('button', { type: 'submit', class: 'btn primary' }, '保存'),
        ),
      ),
    );
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.el.close(); });
    document.body.append(this.el);
  }

  open(p) {
    this.photo = p;
    const cur = placeOf(p);
    this.titleInput.value = cur ? cur.title : '';
    this.subInput.value = cur ? (cur.sub || '') : '';
    fill(this.autoNote, p.place ? `自動で取得した地名: ${p.place.title}${p.place.sub ? `(${p.place.sub})` : ''}` : null);
    this.autoNote.hidden = !p.place;

    // 同じ地点(約10m以内)の写真
    const sk = spotKey(p);
    const same = sk ? this.getPhotos().filter((q) => spotKey(q) === sk) : [p];
    const usesSpot = sk && overrides[sk] && !overrides[photoKey(p)];
    const radio = (value, label, checked) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'place-scope', value, checked: checked || null }), h('span', {}, label));
    fill(this.scopeBox,
      same.length > 1 ? [
        h('div', { class: 'form-label' }, '修正する範囲'),
        radio('photo', 'この写真だけ', !usesSpot),
        radio('spot', `同じ地点の写真すべて(${same.length}枚)`, usesSpot),
      ] : null,
    );
    this.resetBtn.hidden = !(overrides[photoKey(p)] || (sk && overrides[sk]));
    this.el.showModal();
    setTimeout(() => this.titleInput.focus(), 50);
  }

  save() {
    const p = this.photo;
    const title = this.titleInput.value.trim();
    if (!title) { this.reset(); return; }
    const scope = this.el.querySelector('input[name=place-scope]:checked')?.value || 'photo';
    const val = { title, sub: this.subInput.value.trim() };
    const sk = spotKey(p);
    if (scope === 'spot' && sk) {
      overrides[sk] = val;
      delete overrides[photoKey(p)];
    } else {
      overrides[photoKey(p)] = val;
    }
    save();
    this.el.close();
    this.onChange();
  }

  /** 手入力をやめて自動の地名に戻す */
  reset() {
    const p = this.photo;
    delete overrides[photoKey(p)];
    const sk = spotKey(p);
    if (sk && overrides[sk]) delete overrides[sk];
    save();
    this.el.close();
    this.onChange();
  }
}
