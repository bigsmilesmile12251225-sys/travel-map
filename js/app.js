// 段階1: 写真の読み取り確認
import { $, h, fmtOffset, loadSettings, saveSettings } from './util.js';
import { loadPhotos, computePhotoTime } from './photos.js';
import { renderCheckList } from './check.js';

const state = { photos: [], settings: loadSettings() };

/** タイムゾーン選択肢 */
export function fillTzSelect(sel, value) {
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
}

/** 'auto' を実際の値に解決: 写真の時差情報で最も多いもの、なければ端末 */
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
  // 1回目: 時差情報を確定させる(auto解決のため)
  for (const p of state.photos) computePhotoTime(p, state.settings, 'device');
  const tz = resolveTz();
  for (const p of state.photos) computePhotoTime(p, state.settings, tz);
  renderCheckList($('#result'), state.photos, tz);
}

async function addFiles(files) {
  if (!files || !files.length) return;
  const bar = $('#progress');
  bar.hidden = false;
  const photos = await loadPhotos(files, (done, total) => {
    bar.firstElementChild.style.width = `${(done / total) * 100}%`;
  });
  bar.hidden = true;
  state.photos.push(...photos);
  state.photos.sort((a, b) => (a.dateStr || '').localeCompare(b.dateStr || ''));
  recompute();
}

for (const id of ['#pick-photos', '#pick-files']) {
  $(id).addEventListener('change', async (e) => {
    await addFiles(e.target.files);
    e.target.value = '';
  });
}
$('#clear').addEventListener('click', () => {
  for (const p of state.photos) { URL.revokeObjectURL(p.fullUrl); URL.revokeObjectURL(p.thumbUrl); }
  state.photos = [];
  recompute();
});
fillTzSelect($('#tz'), state.settings.tz);
$('#tz').addEventListener('change', (e) => { state.settings.tz = e.target.value; saveSettings(state.settings); recompute(); });
$('#shift').value = state.settings.shiftMin;
$('#shift').addEventListener('change', (e) => { state.settings.shiftMin = Number(e.target.value) || 0; saveSettings(state.settings); recompute(); });
recompute();
