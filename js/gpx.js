// GPXファイルの解析と、日ごとのルートへの整理
import { dayKey, haversine } from './util.js';

let seq = 0;

/** GPXテキスト → { id, name, fileName, segments: [[{lat, lon, ele, t}]] } */
export function parseGpx(text, fileName = '') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('GPXとして読み込めませんでした');
  const byTag = (el, tag) => el.getElementsByTagNameNS('*', tag);
  const childText = (el, tag) => {
    for (const c of el.children) if (c.localName === tag) return c.textContent.trim();
    return null;
  };
  const toPt = (el) => {
    const lat = parseFloat(el.getAttribute('lat'));
    const lon = parseFloat(el.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const e = childText(el, 'ele');
    const ts = childText(el, 'time');
    const t = ts ? Date.parse(ts) : NaN; // GPXの時刻はUTC(末尾Z)。ISO 8601 として解釈
    return { lat, lon, ele: e != null && e !== '' && Number.isFinite(+e) ? +e : null, t: Number.isFinite(t) ? t : null };
  };

  const segments = [];
  for (const seg of byTag(doc, 'trkseg')) {
    const pts = [...byTag(seg, 'trkpt')].map(toPt).filter(Boolean);
    if (pts.length) segments.push(pts);
  }
  if (!segments.length) {
    for (const rte of byTag(doc, 'rte')) {
      const pts = [...byTag(rte, 'rtept')].map(toPt).filter(Boolean);
      if (pts.length) segments.push(pts);
    }
  }
  if (!segments.length) throw new Error('GPXにルートの点がありません');

  const nameEl = byTag(doc, 'name')[0];
  return {
    id: 'g' + ++seq,
    fileName,
    name: (nameEl && nameEl.textContent.trim()) || fileName.replace(/\.gpx$/i, ''),
    segments,
  };
}

export async function loadGpxFiles(files) {
  const tracks = [], errors = [];
  for (const f of files) {
    try {
      tracks.push(parseGpx(await f.text(), f.name));
    } catch (e) {
      errors.push(`${f.name}: ${e.message}`);
    }
  }
  return { tracks, errors };
}

/** 日ごとの色(地図上で見分けやすく、ライト/ダークどちらの地図でも見える色) */
// 色覚の多様性を考慮して隣り合う色の差が大きくなる順に並べている(色だけでなく「N日目」の表記も併記する)
export const DAY_COLORS = ['#e03a3e', '#2f6fd6', '#f08c00', '#0b9a8d', '#8e44ad', '#5c940d', '#d6336c', '#1098ad'];

/**
 * すべてのトラックを、表示タイムゾーンでの日付ごとにまとめる。
 * 日付をまたぐセグメントは日付の境目で分割する。時刻のない点は直前の日に含める。
 */
export function buildDays(tracks, tz) {
  const map = new Map();
  const get = (key) => {
    if (!map.has(key)) map.set(key, { key, segments: [], dist: 0, start: null, end: null, eleGain: 0, eleLoss: 0, hasEle: false, points: 0 });
    return map.get(key);
  };
  for (const tr of tracks) {
    for (const seg of tr.segments) {
      let curKey = null, cur = null;
      const firstT = seg.find((p) => p.t != null);
      const fallbackKey = firstT ? dayKey(firstT.t, tz) : 'nodate:' + tr.id;
      for (const p of seg) {
        const k = p.t != null ? dayKey(p.t, tz) : (curKey || fallbackKey);
        if (k !== curKey) {
          // 新しい日の線は前の点から始めて途切れないようにする
          const prev = cur && cur[cur.length - 1];
          cur = prev ? [{ ...prev, carry: true }] : [];
          get(k).segments.push(cur);
          curKey = k;
        }
        cur.push(p);
      }
    }
  }
  const days = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  days.forEach((d, i) => {
    d.index = i;
    d.color = DAY_COLORS[i % DAY_COLORS.length];
    d.segments.sort((a, b) => (a[0].t ?? 0) - (b[0].t ?? 0));
    for (const seg of d.segments) {
      d.points += seg.length;
      // 累積標高: GPSの標高は揺れるため、5m以上の変化だけを数える
      let ref = null;
      for (const p of seg) {
        if (p.ele == null) continue;
        if (ref == null) { ref = p.ele; continue; }
        const diff = p.ele - ref;
        if (diff >= 5) { d.eleGain += diff; ref = p.ele; } else if (diff <= -5) { d.eleLoss -= diff; ref = p.ele; }
      }
      for (let j = 0; j < seg.length; j++) {
        const p = seg[j];
        if (p.t != null && !p.carry) {
          if (d.start == null || p.t < d.start) d.start = p.t;
          if (d.end == null || p.t > d.end) d.end = p.t;
        }
        if (p.ele != null) d.hasEle = true;
        if (j > 0) {
          const q = seg[j - 1];
          d.dist += haversine(q.lat, q.lon, p.lat, p.lon);
        }
      }
    }
  });
  return days;
}
