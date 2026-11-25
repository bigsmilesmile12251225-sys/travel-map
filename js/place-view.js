// 地名の見出し(写真カード・拡大表示で共通)
import { placeOf } from './place-edit.js?v=202611251008';
import { h } from './util.js?v=202611251008';

/** 地名の見出し要素。地名表示がオフ・位置不明なら null */
export function placeHeading(p, cls) {
  const pl = placeOf(p);
  if (!pl && p.placeState === 'waiting') {
    return h('div', { class: cls + ' loading' }, h('div', { class: 'place-title' }, '地名を取得中…'));
  }
  if (!pl) return null;
  const est = !p.placeManual && p.est && !p.hasGps; // 手入力した地名には「付近」を付けない
  return h('div', { class: cls },
    h('div', { class: 'place-title' }, '📍 ', pl.title, est ? h('span', { class: 'place-near' }, '付近') : null),
    pl.sub ? h('div', { class: 'place-sub' }, pl.sub) : null,
  );
}
