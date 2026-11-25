// アプリ全体の制御
import { $, h, fill, dayKey, fmtDate, fmtOffset, fmtDist, loadSettings, saveSettings } from './util.js?v=202611251008';
import { loadPhotos, computePhotoTime } from './photos.js?v=202611251008';
import { loadGpxFiles, buildDays } from './gpx.js?v=202611251008';
import { renderCheckList } from './check.js?v=202611251008';
import { TripMap, photoPos } from './map.js?v=202611251008';
import { PhotoViewer } from './viewer.js?v=202611251008';
import { estimatePhotos } from './estimate.js?v=202611251008';
import { Panel } from './panel.js?v=202611251008';
import { ElevationChart } from './elevation.js?v=202611251008';
import { Replay } from './replay.js?v=202611251008';
import { PlaceEditor, applyOverrides } from './place-edit.js?v=202611251008';
import { PlaceResolver } from './places.js?v=202611251008';

const state = {
  tracks: [],
  photos: [],
  days: [],
  settings: loadSettings(),
  tz: 'device', // 解決済みの表示タイムゾーン
};

const tripMap = new TripMap($('#map'), {
  onPhotoTap: (p) => { viewer.open(state.photos, p); panel.reveal(p); },
});
const viewer = new PhotoViewer({
  getTz: () => state.tz,
  onEditPlace: (p) => placeEditor.open(p),
  onShowOnMap: (p) => {
    if (replay.active) { // 再生中は通常のピンを隠しているので、その場所へ移動するだけ
      const pos = photoPos(p);
      if (pos) { replay.setFollow(false); tripMap.focusPoint(pos[0], pos[1]); }
      return;
    }
    panel.ensureOpen(); tripMap.focusPhoto(p); panel.reveal(p);
  },
});
const panel = new Panel($('#panel'), {
  onPhoto: (p) => tripMap.focusPhoto(p),
  onPhotoOpen: (p) => viewer.open(state.photos, p),
  onPoint: (pt) => tripMap.focusPoint(pt.lat, pt.lon),
  onDay: (g) => {
    if (g.day) tripMap.fitDay(g.day);
    else tripMap.fitAll([], g.photos);
  },
  onResize: () => { tripMap.invalidate(); elevation.redraw(); },
  renderElevation: () => elevation.element(state),
});
const replay = new Replay({
  tripMap,
  getState: () => state,
  onOpenPhoto: (p) => viewer.open(state.photos, p),
  getPrefs: () => state.settings,
  setPrefs: (patch) => { Object.assign(state.settings, patch); saveSettings(state.settings); },
});
$('#btn-replay').addEventListener('click', () => replay.start());
const places = new PlaceResolver({
  onUpdate: (st) => {
    const el = $('#place-status');
    el.hidden = !st.enabled || !st.photoCount;
    el.classList.toggle('ng', !!st.failed || !st.positioned);
    el.textContent = !st.positioned
      ? '地図上の位置がわかる写真がないため、地名を調べられません(写真の位置情報か、時刻が合うGPXが必要です)。'
      : !st.total
        ? `保存済みの地名を表示しています(${st.positioned}枚)`
        : st.running
      ? `地名を取得中… ${st.done} / ${st.total}${st.failed ? `(失敗 ${st.failed})` : ''}`
      : st.failed
        ? `${st.total}地点中 ${st.failed}地点の地名を取得できませんでした。原因: ${st.lastError}`
        : `地名を取得しました(${st.total}地点)`;
    $('#place-retry').hidden = !(st.failed && !st.running);
    // 表示の更新はまとめて行う
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => {
      panel.update(state);
      viewer.refresh();
      replay.refreshCard();
    }, 300);
  },
});
let placeTimer = null;
const placeEditor = new PlaceEditor({
  getPhotos: () => state.photos,
  onChange: () => {
    applyOverrides(state.photos);
    panel.update(state);
    viewer.refresh();
    replay.refreshCard();
  },
});
const elevation = new ElevationChart({
  onCursor: (pt, color) => tripMap.setCursor(pt, color),
});

// ------------------------------------------------------------
// 再計算と描画
// ------------------------------------------------------------
function resolveTz() {
  const t = state.settings.tz;
  if (t !== 'auto') return t === 'device' ? 'device' : Number(t);
  const count = new Map();
  for (const p of state.photos) {
    if (p.offsetStr && p.offsetMin != null) count.set(p.offsetMin, (count.get(p.offsetMin) || 0) + 1);
  }
  if (!count.size) return 'device';
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function recompute() {
  for (const p of state.photos) computePhotoTime(p, state.settings, 'device');
  state.tz = resolveTz();
  for (const p of state.photos) computePhotoTime(p, state.settings, state.tz);
  state.photos.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  state.days = buildDays(state.tracks, state.tz);
  estimatePhotos(state.photos, state.tracks);
  places.request(state.photos, state.settings.placeNames);
  applyOverrides(state.photos);
  const colorOf = new Map(state.days.map((d) => [d.key, d.color]));
  for (const p of state.photos) p.color = (p.time != null && colorOf.get(dayKey(p.time, state.tz))) || '#666';
}

function render({ fit = false } = {}) {
  tripMap.render(state.days, state.photos);
  if (fit) tripMap.fitAll(state.days, state.photos);
  const empty = !state.tracks.length && !state.photos.length;
  $('#welcome').hidden = !empty;
  const wasHidden = $('#panel').hidden;
  $('#panel').hidden = empty;
  panel.update(state);
  if (wasHidden !== empty) { panel.setSnap(panel.snap); tripMap.invalidate(); }
  $('#trip-title').textContent = tripTitle();
  $('#btn-replay').hidden = !Replay.available(state);
  renderLoadedList();
  renderCheckList($('#check'), state.photos, state.tz);
}

function tripTitle() {
  const ts = [
    ...state.days.flatMap((d) => [d.start, d.end]),
    ...state.photos.map((p) => p.time),
  ].filter((x) => x != null);
  if (!ts.length) return '旅の地図';
  const a = fmtDate(Math.min(...ts), state.tz), b = fmtDate(Math.max(...ts), state.tz);
  return a === b ? `${a}の旅` : `${a}〜${b}の旅`;
}

function update(opts) {
  recompute();
  render(opts);
}

// ------------------------------------------------------------
// 読み込み
// ------------------------------------------------------------
const isGpx = (f) => /\.gpx$/i.test(f.name) || /gpx/i.test(f.type);
const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|heic|heif|png|tiff?)$/i.test(f.name);

let pendingPhotoReport = null;

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  closeDialogs();
  const gpx = files.filter(isGpx);
  const imgs = files.filter((f) => !isGpx(f) && isImage(f));
  const other = files.filter((f) => !isGpx(f) && !isImage(f));
  const msgs = [];

  if (gpx.length) {
    toast(`GPXを読み込み中…`);
    const { tracks, errors } = await loadGpxFiles(gpx);
    state.tracks.push(...tracks);
    msgs.push(...errors);
  }
  if (imgs.length) {
    const photos = await loadPhotos(imgs, (done, total) => toast(`写真を読み込み中… ${done}/${total}`));
    state.photos.push(...photos);
    pendingPhotoReport = photos;
  }
  if (other.length) msgs.push(`対応していないファイル: ${other.map((f) => f.name).join(', ')}`);

  update();
  if (pendingPhotoReport) {
    const ps = pendingPhotoReport;
    pendingPhotoReport = null;
    const noGps = ps.filter((p) => !p.hasGps);
    const est = noGps.filter((p) => p.est).length;
    if (noGps.length) {
      msgs.push(`写真${ps.length}枚中${noGps.length}枚に位置情報がありません。`
        + (est ? `うち${est}枚はルートの時刻から位置を推定しました。` : '')
        + (noGps.length - est ? `${noGps.length - est}枚は地図に表示できません。` : '')
        + '(詳細は設定画面)');
    }
  }
  if (state.tracks.length || state.photos.length) setTimeout(() => tripMap.fitAll(state.days, state.photos), 300);
  const route = state.days.reduce((s, d) => s + d.dist, 0);
  toast(msgs.length ? msgs.join('\n') : `読み込みました(ルート ${fmtDist(route)}・写真 ${state.photos.length}枚)`, msgs.length ? 6000 : 2500);
}

document.querySelectorAll('input[type=file][data-pick]').forEach((inp) => {
  inp.addEventListener('change', async () => {
    const files = [...inp.files];
    inp.value = '';
    await addFiles(files);
  });
});

function renderLoadedList() {
  const ul = $('#loaded-list');
  fill(ul,
    ...state.tracks.map((t) => h('li', {}, `🗺️ ${t.fileName || t.name}(${t.segments.reduce((s, x) => s + x.length, 0)}点)`)),
    state.photos.length ? h('li', {}, `🖼️ 写真 ${state.photos.length}枚(位置情報あり ${state.photos.filter((p) => p.hasGps).length}枚)`) : null,
  );
  if (!ul.children.length) ul.append(h('li', { class: 'hint' }, 'まだ何も読み込まれていません'));
  $('#btn-clear').hidden = !ul.querySelector('li:not(.hint)');
}

$('#btn-clear').addEventListener('click', () => {
  if (!confirm('読み込んだGPXと写真をすべて消去しますか?')) return;
  for (const p of state.photos) { URL.revokeObjectURL(p.fullUrl); if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl); }
  state.photos = [];
  state.tracks = [];
  closeDialogs();
  update();
});

// ------------------------------------------------------------
// ダイアログ・設定
// ------------------------------------------------------------
function openDialog(id) {
  const d = $(id);
  if (!d.open) d.showModal();
}
function closeDialogs() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
}
document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    // 背景タップで閉じる
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
});
$('#btn-load').addEventListener('click', () => openDialog('#load-dialog'));
$('#btn-settings').addEventListener('click', () => openDialog('#settings-dialog'));
$('#btn-fit').addEventListener('click', () => tripMap.fitAll(state.days, state.photos));

function fillTzSelect(sel, value) {
  const offs = [];
  for (let m = -12 * 60; m <= 14 * 60; m += 60) offs.push(m);
  offs.push(-570, -210, 210, 270, 330, 345, 390, 525, 570, 630, 765);
  offs.sort((a, b) => a - b);
  sel.replaceChildren(
    h('option', { value: 'auto' }, '自動(写真の時差情報 → 端末)'),
    h('option', { value: 'device' }, `端末のタイムゾーン(${fmtOffset(-new Date().getTimezoneOffset())})`),
    ...offs.map((m) => h('option', { value: String(m) }, fmtOffset(m))),
  );
  sel.value = String(value);
  if (!sel.value) sel.value = 'auto';
}
fillTzSelect($('#tz'), state.settings.tz);
$('#tz').addEventListener('change', (e) => {
  state.settings.tz = e.target.value;
  saveSettings(state.settings);
  update();
});
$('#place-names').checked = !!state.settings.placeNames;
$('#place-names').addEventListener('change', (e) => {
  state.settings.placeNames = e.target.checked;
  saveSettings(state.settings);
  places.request(state.photos, state.settings.placeNames);
  panel.update(state);
});
$('#app-version').textContent = new URL(import.meta.url).searchParams.get('v') || '開発版';
$('#place-retry').addEventListener('click', () => places.request(state.photos, state.settings.placeNames));
$('#shift').value = state.settings.shiftMin;
$('#shift').addEventListener('change', (e) => {
  state.settings.shiftMin = Number(e.target.value) || 0;
  saveSettings(state.settings);
  update();
});

// ------------------------------------------------------------
// 通知
// ------------------------------------------------------------
let toastTimer = null;
function toast(msg, ms = 0) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
$('#toast').addEventListener('click', () => { $('#toast').hidden = true; });

update();
