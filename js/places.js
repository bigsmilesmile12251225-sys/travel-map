// 撮影地点の地名・施設名の取得(設定でオンにしたときだけ)
// OpenStreetMap の Nominatim に「緯度・経度」だけを送る。写真そのものは送らない。
// 利用規約に従い、1秒に1件まで・結果はこの端末に保存して再利用する。
import { photoPos } from './map.js';

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const INTERVAL = 1100;
const CACHE_KEY = 'travel-map-places-v1';
const CACHE_MAX = 3000;

// 約10m単位にまとめて、近い写真では同じ結果を使う
const keyOf = (lat, lon) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

let cache = new Map();
try {
  cache = new Map(JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'));
} catch { /* 保存できない環境では毎回取得 */ }

function saveCache() {
  try {
    const entries = [...cache.entries()].slice(-CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch { /* 保存できなくても動作は継続 */ }
}

export function clearPlaceCache() {
  cache.clear();
  try { localStorage.removeItem(CACHE_KEY); } catch { /* なし */ }
}

/** Nominatim の結果 → { title: 大きく出す名前, sub: 補足(市区町村など) } */
export function toPlace(json) {
  if (!json || json.error) return null;
  const a = json.address || {};
  const nd = json.namedetails || {};
  const poi = nd['name:ja'] || json.name || '';
  const pref = a.province || a.state || '';
  const city = a.city || a.town || a.village || a.municipality || a.county || '';
  const ward = a.city_district || '';
  const area = a.suburb || a.quarter || a.neighbourhood || a.hamlet || '';
  const title = poi || area || ward || city || pref || '';
  const subParts = [pref, city, ward, area].filter((x, i, arr) => x && x !== title && arr.indexOf(x) === i);
  if (a.country_code && a.country_code !== 'jp' && a.country) subParts.unshift(a.country);
  if (!title) return null;
  return { title, sub: subParts.join(' ') };
}

export class PlaceResolver {
  constructor({ onUpdate }) {
    this.onUpdate = onUpdate;
    this.queue = [];
    this.running = false;
    this.enabled = false;
    this.done = 0;
    this.total = 0;
  }

  /** 写真に地名を割り当てる。キャッシュにないものだけ取得待ちに入れる */
  request(photos, enabled) {
    this.enabled = enabled;
    this.queue = [];
    const keys = new Set();
    for (const p of photos) {
      const pos = photoPos(p);
      if (!enabled || !pos) { p.place = null; p.placeState = null; continue; }
      const k = keyOf(pos[0], pos[1]);
      p.placeKey = k;
      if (cache.has(k)) { p.place = cache.get(k); p.placeState = 'done'; continue; }
      p.place = null;
      p.placeState = 'waiting';
      if (!keys.has(k)) { keys.add(k); this.queue.push({ k, lat: pos[0], lon: pos[1] }); }
    }
    this.photos = photos;
    this.done = 0;
    this.total = this.queue.length;
    this.onUpdate(this.status());
    if (this.queue.length && !this.running) this.run();
  }

  status() {
    return { enabled: this.enabled, done: this.done, total: this.total, running: this.queue.length > 0 };
  }

  async run() {
    this.running = true;
    let fails = 0;
    while (this.queue.length && this.enabled) {
      const job = this.queue[0];
      let place = null, ok = false;
      try {
        const url = `${ENDPOINT}?format=jsonv2&lat=${job.lat.toFixed(6)}&lon=${job.lon.toFixed(6)}&zoom=18&namedetails=1&accept-language=ja`;
        const res = await fetch(url, { headers: { Accept: 'application/json' }, referrerPolicy: 'strict-origin-when-cross-origin' });
        if (res.ok) { place = toPlace(await res.json()); ok = true; }
        else if (res.status === 429 || res.status >= 500) { await sleep(5000); }
        else ok = true; // 見つからない等は空で確定
      } catch {
        await sleep(3000);
      }
      if (ok || ++fails >= 3) {
        this.queue.shift();
        fails = 0;
        cache.set(job.k, place);
        this.done++;
        for (const p of this.photos) if (p.placeKey === job.k) { p.place = place; p.placeState = ok ? 'done' : 'error'; }
        if (this.done % 5 === 0 || !this.queue.length) saveCache();
        this.onUpdate(this.status());
      }
      await sleep(INTERVAL);
    }
    this.running = false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
