// 写真の読み込み: EXIF(位置・撮影時刻)の取得とサムネイル作成
// すべてブラウザ内で処理し、外部へは送信しない。
import exifr from 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs';
import { parseOffset, tzOffsetAt } from './util.js';

const EXIF_OPTS = {
  ifd0: true, exif: true, gps: true,
  ifd1: false, interop: false, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false,
  makerNote: false, userComment: false,
  // 日付を Date に変換させない(端末のタイムゾーンで解釈されてしまうため)。文字列のまま受け取る。
  reviveValues: false, translateValues: false,
};

let seq = 0;

/** ファイル先頭のバイト列から実際の形式を判定(拡張子やMIMEは当てにならないことがある) */
function sniff(u) {
  if (u[0] === 0xff && u[1] === 0xd8) return 'JPEG';
  if (u[0] === 0x89 && u[1] === 0x50) return 'PNG';
  const box = String.fromCharCode(...u.slice(4, 12));
  if (box.startsWith('ftyp')) {
    const brand = box.slice(4);
    if (/heic|heix|hevc|heim|heis|mif1|msf1/.test(brand)) return 'HEIC';
    if (/avif/.test(brand)) return 'AVIF';
    return 'ISO-BMFF';
  }
  if ((u[0] === 0x49 && u[1] === 0x49) || (u[0] === 0x4d && u[1] === 0x4d)) return 'TIFF';
  return '不明';
}

/**
 * exifr が読めなかった場合の保険。
 * ファイル中の "Exif\0\0" + TIFFヘッダー(II* / MM*)を探し、その位置からTIFFとして解析する。
 * HEIC の内部構造は作成元によって差があるため用意している。
 */
async function fallbackExif(file) {
  if (file.size > 80 * 1024 * 1024) return null;
  const u = new Uint8Array(await file.arrayBuffer());
  for (let i = 0; i < u.length - 10; i++) {
    if (u[i] === 0x45 && u[i + 1] === 0x78 && u[i + 2] === 0x69 && u[i + 3] === 0x66 && u[i + 4] === 0 && u[i + 5] === 0) {
      const a = u[i + 6], b = u[i + 7];
      if ((a === 0x49 && b === 0x49) || (a === 0x4d && b === 0x4d)) {
        try {
          const r = await exifr.parse(u.slice(i + 6).buffer, EXIF_OPTS);
          if (r && !r.errors) return r;
        } catch { /* 次の候補へ */ }
      }
    }
  }
  return null;
}

function dms(arr, ref) {
  if (typeof arr === 'number') return ref === 'S' || ref === 'W' ? -arr : arr;
  if (!Array.isArray(arr) || arr.length < 1) return null;
  const [d = 0, m = 0, s = 0] = arr.map(Number);
  const v = d + m / 60 + s / 3600;
  return ref === 'S' || ref === 'W' ? -v : v;
}

/** 'YYYY:MM:DD HH:MM:SS' を要素に分解 */
function parseExifDate(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(str.trim());
  if (!m) return null;
  const [y, mo, d, hh, mi, s] = m.slice(1).map((x) => Number(x || 0));
  if (y < 1900) return null;
  return { y, mo, d, hh, mi, s };
}

/** 1枚の写真を読み込んで情報を返す */
export async function loadPhoto(file) {
  const p = {
    id: 'p' + ++seq,
    file, name: file.name, size: file.size, mime: file.type || '(なし)',
    format: '不明', raw: null, error: null,
    lat: null, lon: null, alt: null, hasGps: false,
    dateStr: null, offsetStr: null, gpsUtc: null, subSec: 0,
    time: null, timeSource: null, offsetMin: null,
    est: null, // 時刻照合による推定位置 {lat, lon, quality}
    thumbUrl: null, fullUrl: null, displayable: false, width: 0, height: 0,
  };
  try {
    p.format = sniff(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  } catch { /* 判定できなくても続行 */ }

  let raw = null;
  try {
    raw = await exifr.parse(file, EXIF_OPTS);
    if (raw && raw.errors) raw = null;
  } catch (e) {
    p.error = String(e && e.message || e);
  }
  if (!raw || (!raw.DateTimeOriginal && !raw.GPSLatitude && !raw.CreateDate)) {
    const fb = await fallbackExif(file).catch(() => null);
    if (fb) { raw = { ...(raw || {}), ...fb }; p.error = null; }
  }
  p.raw = raw || {};

  if (raw) {
    // 位置
    const lat = raw.latitude ?? dms(raw.GPSLatitude, raw.GPSLatitudeRef);
    const lon = raw.longitude ?? dms(raw.GPSLongitude, raw.GPSLongitudeRef);
    if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      p.lat = lat; p.lon = lon; p.hasGps = true;
    }
    if (Number.isFinite(Number(raw.GPSAltitude))) {
      const ref = raw.GPSAltitudeRef;
      const below = ref === 1 || (ref && ref[0] === 1);
      p.alt = Number(raw.GPSAltitude) * (below ? -1 : 1);
    }
    // 時刻
    p.dateStr = raw.DateTimeOriginal || raw.CreateDate || raw.DateTime || null;
    p.offsetStr = raw.OffsetTimeOriginal || raw.OffsetTimeDigitized || raw.OffsetTime || null;
    p.subSec = Number('0.' + String(raw.SubSecTimeOriginal ?? '0').replace(/\D/g, '')) || 0;
    const gd = parseExifDate(typeof raw.GPSDateStamp === 'string' ? raw.GPSDateStamp + ' 00:00:00' : null);
    const gt = raw.GPSTimeStamp;
    if (gd && Array.isArray(gt) && gt.length >= 3) {
      p.gpsUtc = Date.UTC(gd.y, gd.mo - 1, gd.d, Number(gt[0]), Number(gt[1]), Math.floor(Number(gt[2])));
    }
  }
  return p;
}

/**
 * 撮影時刻(UTC)を決める。設定が変わったら再計算できるよう独立させている。
 *  1. OffsetTimeOriginal があれば「EXIF時刻 − オフセット」
 *  2. GPS日時(UTC)があれば、それとEXIF時刻の差からオフセットを推定
 *  3. どちらもなければ、設定のタイムゾーン(既定は端末)で解釈
 *  最後に、全写真共通の「時刻補正(分)」を加える。
 */
export function computePhotoTime(p, settings, fallbackTz) {
  p.time = null; p.timeSource = null; p.offsetMin = null;
  const w = parseExifDate(p.dateStr);
  const shift = (Number(settings.shiftMin) || 0) * 60000;
  if (!w) {
    if (p.gpsUtc) { p.time = p.gpsUtc + shift; p.timeSource = 'GPS時刻(UTC)'; }
    return;
  }
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.hh, w.mi, w.s) + Math.round(p.subSec * 1000);
  const off = parseOffset(p.offsetStr);
  if (off != null) {
    p.offsetMin = off; p.time = asUtc - off * 60000; p.timeSource = 'EXIF(時差情報あり)';
  } else if (p.gpsUtc && Math.abs(asUtc - p.gpsUtc) < 15 * 3600000) {
    // 15分単位に丸めたオフセット(GPSの時刻は数秒ずれることがある)
    const est = Math.round((asUtc - p.gpsUtc) / 900000) * 15;
    p.offsetMin = est; p.time = asUtc - est * 60000; p.timeSource = 'EXIF+GPS時刻から時差を推定';
  } else {
    const tz = fallbackTz;
    // 端末タイムゾーンの場合、その日時のオフセット(夏時間考慮)を求める
    const offMin = tz === 'device' ? tzOffsetAt(asUtc - tzOffsetAt(asUtc, 'device') * 60000, 'device') : Number(tz);
    p.offsetMin = offMin; p.time = asUtc - offMin * 60000; p.timeSource = '時差を仮定';
  }
  p.time += shift;
}

/** サムネイル(正方形)作成。iOS Safari は HEIC も <img> で表示できる。 */
export async function makeThumb(p, size = 240) {
  p.fullUrl = URL.createObjectURL(p.file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = p.fullUrl;
    await img.decode();
    p.width = img.naturalWidth; p.height = img.naturalHeight; p.displayable = true;
    const s = Math.min(p.width, p.height);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(img, (p.width - s) / 2, (p.height - s) / 2, s, s, 0, 0, size, size);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
    if (blob) p.thumbUrl = URL.createObjectURL(blob);
    img.src = '';
  } catch {
    // 表示できない形式(他ブラウザでのHEICなど)は埋め込みサムネイルを試す
    try {
      const tb = await exifr.thumbnail(p.file);
      if (tb) p.thumbUrl = URL.createObjectURL(new Blob([tb], { type: 'image/jpeg' }));
    } catch { /* サムネイルなし */ }
  }
}

/** 複数ファイルを少しずつ処理(iPhoneのメモリを圧迫しないよう同時2件まで) */
export async function loadPhotos(files, onProgress) {
  const list = [...files];
  const out = new Array(list.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      const p = await loadPhoto(list[i]);
      await makeThumb(p);
      out[i] = p;
      onProgress && onProgress(++done, list.length, p);
    }
  }
  await Promise.all([worker(), worker()]);
  return out;
}
