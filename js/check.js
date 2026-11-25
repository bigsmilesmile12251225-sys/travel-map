// 写真の読み取り結果の確認画面(段階1。以降も「読み取り確認」として利用)
import { h, fmtDateTime, fmtOffset, fmtBytes } from './util.js?v=202611251008';

export function renderCheckList(container, photos, tz) {
  container.replaceChildren();
  if (!photos.length) {
    container.append(h('p', { class: 'hint' }, 'まだ写真が読み込まれていません。'));
    return;
  }
  const n = photos.length;
  const gps = photos.filter((p) => p.hasGps).length;
  const time = photos.filter((p) => p.time != null).length;
  const withOff = photos.filter((p) => p.offsetStr).length;
  const heic = photos.filter((p) => p.format === 'HEIC').length;
  const cls = (k) => (k === n ? 'ok' : k === 0 ? 'ng' : 'warn');

  container.append(
    h('div', { class: 'panel' },
      h('h2', {}, '読み取り結果'),
      h('div', { class: 'verdict' },
        h('span', { class: 'chip ' + cls(gps) }, `位置情報 ${gps}/${n}`),
        h('span', { class: 'chip ' + cls(time) }, `撮影時刻 ${time}/${n}`),
        h('span', { class: 'chip ' + (withOff ? 'ok' : '') }, `時差情報 ${withOff}/${n}`),
        h('span', { class: 'chip' }, `HEIC ${heic} / JPEG ${photos.filter((p) => p.format === 'JPEG').length}`),
      ),
      gps < n
        ? h('p', { class: 'hint' },
          '位置情報が読めない写真があります。写真ライブラリから選んだときに位置情報が外れた可能性があります。',
          '写真アプリの共有メニュー →「オプション」で「位置情報」をオンにして「ファイル」に保存し、',
          '「ファイルから選ぶ」で読み込むと残ることがあります。')
        : null,
    ),
  );

  const list = h('div', { class: 'check-list' });
  for (const p of photos) {
    list.append(
      h('div', { class: 'check-card' },
        p.thumbUrl ? h('img', { src: p.thumbUrl, alt: '' }) : h('div', { class: 'noimg' }, 'プレビュー\nなし'),
        h('div', {},
          h('div', { class: 'name' }, p.name),
          h('dl', {},
            h('dt', {}, '形式'), h('dd', {}, `${p.format}(${p.mime}, ${fmtBytes(p.size)})`),
            h('dt', {}, '位置'), h('dd', {},
              p.hasGps
                ? h('span', { class: 'chip ok' }, `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`)
                : h('span', { class: 'chip ng' }, 'なし')),
            p.alt != null ? [h('dt', {}, '標高'), h('dd', {}, `${Math.round(p.alt)} m`)] : null,
            h('dt', {}, 'EXIF時刻'), h('dd', {}, p.dateStr || h('span', { class: 'chip ng' }, 'なし')),
            h('dt', {}, '時差'), h('dd', {}, p.offsetStr || (p.offsetMin != null ? `なし → ${fmtOffset(p.offsetMin)} を使用` : 'なし')),
            p.gpsUtc ? [h('dt', {}, 'GPS時刻'), h('dd', {}, new Date(p.gpsUtc).toISOString().replace('.000', ''))] : null,
            h('dt', {}, '撮影日時'), h('dd', {}, p.time != null ? `${fmtDateTime(p.time, tz, true)}` : '—'),
            h('dt', {}, '時刻の根拠'), h('dd', {}, p.timeSource || '—'),
            p.error ? [h('dt', {}, 'エラー'), h('dd', {}, p.error)] : null,
          ),
        ),
      ),
    );
  }
  container.append(list);
}
