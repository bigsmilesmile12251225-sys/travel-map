// 共通ユーティリティ(DOM生成・時刻・書式)

export const $ = (sel, root = document) => root.querySelector(sel);

/** 小さなDOM生成ヘルパー: h('div', {class:'x', onclick:fn}, '文字', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), sv);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** 子要素を入れ替える(null / false は無視。replaceChildren に null を渡すと "null" と表示されるため) */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------
// 時刻
// アプリ内部の時刻はすべて「UTCのエポックミリ秒」で扱う。
// 表示・日付の区切りには「表示タイムゾーン」を使う。
//   tz === 'device' : 端末のタイムゾーン(夏時間も考慮)
//   tz が数値        : UTCからのオフセット(分)。例: 日本 = 540
// ---------------------------------------------------------------

export function tzOffsetAt(t, tz) {
  return tz === 'device' ? -new Date(t).getTimezoneOffset() : Number(tz);
}

/** 表示タイムゾーンでの「壁時計」の各要素 */
export function wall(t, tz) {
  const d = new Date(t + tzOffsetAt(t, tz) * 60000);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay(),
  };
}

const pad = (n) => String(n).padStart(2, '0');
const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function fmtTime(t, tz, sec = false) {
  const w = wall(t, tz);
  return `${pad(w.h)}:${pad(w.mi)}${sec ? ':' + pad(w.s) : ''}`;
}
export function fmtDate(t, tz) {
  const w = wall(t, tz);
  return `${w.mo}/${w.d}(${WD[w.wd]})`;
}
export function fmtDateLong(t, tz) {
  const w = wall(t, tz);
  return `${w.y}年${w.mo}月${w.d}日(${WD[w.wd]})`;
}
export function fmtDateTime(t, tz, sec = false) {
  return `${fmtDate(t, tz)} ${fmtTime(t, tz, sec)}`;
}
/** 日付のキー 'YYYY-MM-DD'(表示タイムゾーン基準) */
export function dayKey(t, tz) {
  const w = wall(t, tz);
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}`;
}
/** 540 → 'UTC+09:00' */
export function fmtOffset(min) {
  const sign = min < 0 ? '−' : '+';
  const a = Math.abs(min);
  return `UTC${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
/** '+09:00' / '-05:30' / 'Z' → 分。解釈できなければ null */
export function parseOffset(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim();
  if (s === 'Z') return 0;
  const m = /^([+-])(\d{1,2}):?(\d{2})?$/.exec(s);
  if (!m) return null;
  const v = Number(m[2]) * 60 + Number(m[3] || 0);
  return m[1] === '-' ? -v : v;
}
export function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  const hh = Math.floor(min / 60), mm = min % 60;
  return hh ? `${hh}時間${mm}分` : `${mm}分`;
}

// ---------------------------------------------------------------
// 距離
// ---------------------------------------------------------------
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function fmtDist(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
export function fmtBytes(b) {
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------
// 設定(localStorage は使えない環境もあるので必ず try/catch)
// ---------------------------------------------------------------
const KEY = 'travel-map-settings-v1';
export function loadSettings() {
  const def = { tz: 'auto', shiftMin: 0, placeNames: false };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return def;
  }
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 保存できなくても動作は継続 */ }
}
