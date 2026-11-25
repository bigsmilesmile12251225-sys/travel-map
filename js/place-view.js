// 地名の見出し(写真カード・拡大表示で共通)
import { h } from './util.js';

/** 地名の見出し要素。地名表示がオフ・位置不明なら null */
export function placeHeading(p, cls) {
  if (p.placeState === 'waiting') {
    return h('div', { class: cls + ' loading' }, h('div', { class: 'place-title' }, '地名を取得中…'));
  }
  if (!p.place) return null;
  const est = p.est && !p.hasGps;
  return h('div', { class: cls },
    h('div', { class: 'place-title' }, '📍 ', p.place.title, est ? h('span', { class: 'place-near' }, '付近') : null),
    p.place.sub ? h('div', { class: 'place-sub' }, p.place.sub) : null,
  );
}
