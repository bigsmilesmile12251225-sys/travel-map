// 写真の撮影時刻とGPXの時刻を照合して位置を推定する
import { haversine } from './util.js?v=202611251019';

// しきい値
const MAX_INTERP_GAP = 15 * 60000; // 前後の点の間隔がこれ以内なら直線補間
const MAX_SNAP = 10 * 60000;       // 最寄りの点までの時間差がこれ以内ならその点を採用
const STAY_RADIUS = 300;           // 記録が途切れていても前後の点が近ければ(滞在中とみなし)採用

/** 時刻のある全点を時刻順に並べる */
export function timedPoints(tracks) {
  const pts = [];
  for (const t of tracks) for (const s of t.segments) for (const p of s) if (p.t != null) pts.push(p);
  pts.sort((a, b) => a.t - b.t);
  return pts;
}

/** t 以下で最大の時刻を持つ点のインデックス(なければ -1) */
function lowerIndex(pts, t) {
  let lo = 0, hi = pts.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * 時刻 t の位置を推定する。
 * 戻り値 { lat, lon, ele, method, diffMin } または null
 *   method: 'interp'(前後の点から補間) / 'nearest'(最寄りの点) / 'stay'(滞在中とみなした)
 */
export function locateAt(pts, t) {
  if (!pts.length || t == null) return null;
  const i = lowerIndex(pts, t);
  const a = i >= 0 ? pts[i] : null;
  const b = i + 1 < pts.length ? pts[i + 1] : null;
  if (a && a.t === t) return { lat: a.lat, lon: a.lon, ele: a.ele, method: 'interp', diffMin: 0 };
  if (a && b) {
    const gap = b.t - a.t;
    if (gap <= MAX_INTERP_GAP) {
      const r = (t - a.t) / gap;
      return {
        lat: a.lat + (b.lat - a.lat) * r,
        lon: a.lon + (b.lon - a.lon) * r,
        ele: a.ele != null && b.ele != null ? a.ele + (b.ele - a.ele) * r : (a.ele ?? b.ele),
        method: 'interp',
        diffMin: Math.round(Math.min(t - a.t, b.t - t) / 60000),
      };
    }
    const near = t - a.t <= b.t - t ? a : b;
    const diff = Math.abs(near.t - t);
    if (diff <= MAX_SNAP) return { lat: near.lat, lon: near.lon, ele: near.ele, method: 'nearest', diffMin: Math.round(diff / 60000) };
    if (haversine(a.lat, a.lon, b.lat, b.lon) <= STAY_RADIUS) {
      return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2, ele: a.ele, method: 'stay', diffMin: Math.round(diff / 60000) };
    }
    return null;
  }
  const edge = a || b;
  const diff = Math.abs(edge.t - t);
  if (diff <= MAX_SNAP) return { lat: edge.lat, lon: edge.lon, ele: edge.ele, method: 'nearest', diffMin: Math.round(diff / 60000) };
  return null;
}

/** GPSのない写真に推定位置を付ける */
export function estimatePhotos(photos, tracks) {
  const pts = timedPoints(tracks);
  for (const p of photos) {
    p.est = null;
    if (p.hasGps || p.time == null) continue;
    p.est = locateAt(pts, p.time);
  }
}

export const METHOD_LABEL = {
  interp: 'ルートの時刻から推定',
  nearest: 'ルートの最寄りの記録点から推定',
  stay: '記録の途切れ前後の地点から推定',
};
