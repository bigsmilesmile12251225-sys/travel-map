// 地図(Leaflet + OpenStreetMap)。L は index.html で読み込んだグローバル。
import { escapeHtml } from './util.js?v=202611251005';

const L = window.L;

export class TripMap {
  constructor(el, { onPhotoTap } = {}) {
    this.onPhotoTap = onPhotoTap;
    this.map = L.map(el, { zoomControl: false, attributionControl: true, worldCopyJump: true }).setView([36.2, 138.2], 5);
    L.control.zoom({ position: 'topright', zoomInTitle: '拡大', zoomOutTitle: '縮小' }).addTo(this.map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.map);
    this.map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(this.map);

    this.map.createPane('cursor').style.zIndex = 650; // 写真ピンより手前
    this.routes = L.layerGroup().addTo(this.map);
    this.cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 50,
      iconCreateFunction: (c) => this.clusterIcon(c),
    }).addTo(this.map);
    this.markers = new Map(); // photo.id → marker
    this.cursor = null;
    this.highlight = null;
  }

  clusterIcon(cluster) {
    const children = cluster.getAllChildMarkers().sort((a, b) => (a.photo.time ?? 0) - (b.photo.time ?? 0));
    const first = children[0].photo;
    const allEst = children.every((m) => m.photo.est && !m.photo.hasGps);
    return L.divIcon({
      className: 'pin-wrap',
      html: `<div class="pin${allEst ? ' est' : ''}" style="--c:${first.color || '#555'}">${thumbHtml(first)}<span class="pin-count">${children.length}</span></div>`,
      iconSize: [56, 64], iconAnchor: [28, 62],
    });
  }

  /** ルートと写真ピンを描き直す */
  render(days, photos) {
    this.routes.clearLayers();
    this.cluster.clearLayers();
    this.markers.clear();
    for (const d of days) {
      for (const seg of d.segments) {
        const ll = seg.map((p) => [p.lat, p.lon]);
        if (ll.length < 2) continue;
        L.polyline(ll, { color: '#fff', weight: 8, opacity: 0.85, interactive: false, className: 'route-casing' }).addTo(this.routes);
        L.polyline(ll, { color: d.color, weight: 4.5, opacity: 1, interactive: false }).addTo(this.routes);
      }
      // 日ごとの出発・到着点
      const segs = d.segments.filter((s) => s.length);
      if (segs.length) {
        const a = segs[0].find((p) => !p.carry) || segs[0][0];
        const lastSeg = segs[segs.length - 1];
        const b = lastSeg[lastSeg.length - 1];
        L.circleMarker([a.lat, a.lon], { radius: 7, color: '#fff', weight: 3, fillColor: d.color, fillOpacity: 1, interactive: false }).addTo(this.routes);
        L.circleMarker([b.lat, b.lon], { radius: 7, color: d.color, weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(this.routes);
      }
    }
    const markers = [];
    for (const p of photos) {
      const pos = photoPos(p);
      if (!pos) continue;
      const m = L.marker(pos, {
        icon: pinIcon(p),
        title: p.name,
        keyboard: true,
      });
      m.photo = p;
      m.on('click', () => this.onPhotoTap && this.onPhotoTap(p));
      this.markers.set(p.id, m);
      markers.push(m);
    }
    this.cluster.addLayers(markers);
  }

  /** すべてが収まるように表示 */
  fitAll(days, photos, padding = [40, 40]) {
    const pts = [];
    for (const d of days) for (const s of d.segments) for (const p of s) pts.push([p.lat, p.lon]);
    for (const p of photos) { const pos = photoPos(p); if (pos) pts.push(pos); }
    if (!pts.length) return;
    const b = L.latLngBounds(pts);
    this.map.fitBounds(b, { padding, maxZoom: 16 });
  }

  fitDay(day, padding = [40, 40]) {
    const pts = [];
    for (const s of day.segments) for (const p of s) pts.push([p.lat, p.lon]);
    if (pts.length) this.map.fitBounds(L.latLngBounds(pts), { padding, maxZoom: 16 });
  }

  /** 写真ピンへ移動(まとめ表示されていれば展開) */
  focusPhoto(p, cb) {
    const m = this.markers.get(p.id);
    if (!m) return false;
    const go = () => {
      this.cluster.zoomToShowLayer(m, () => {
        this.flash(m.getLatLng());
        cb && cb();
      });
    };
    if (this.map.getZoom() < 15) {
      this.map.flyTo(m.getLatLng(), 16, { duration: 0.8 });
      this.map.once('moveend', go);
    } else go();
    return true;
  }

  focusPoint(lat, lon, zoom = 16) {
    this.map.flyTo([lat, lon], Math.max(zoom, this.map.getZoom()), { duration: 0.8 });
    this.map.once('moveend', () => this.flash([lat, lon]));
  }

  /** 位置を一瞬強調表示 */
  flash(latlng) {
    if (this.highlight) this.highlight.remove();
    this.highlight = L.circleMarker(latlng, { radius: 30, color: '#ffb400', weight: 4, fill: false, className: 'flash-ring', interactive: false, pane: 'cursor' }).addTo(this.map);
    const h = this.highlight;
    setTimeout(() => h.remove(), 1600);
  }

  /** 標高グラフなどから指定位置にカーソルを出す(null で消す) */
  setCursor(pt, color) {
    if (!pt) { if (this.cursor) { this.cursor.remove(); this.cursor = null; } return; }
    if (!this.cursor) {
      this.cursor = L.circleMarker([pt.lat, pt.lon], { radius: 9, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1, interactive: false, pane: 'cursor' }).addTo(this.map);
    } else {
      this.cursor.setLatLng([pt.lat, pt.lon]);
      this.cursor.setStyle({ fillColor: color });
    }
    // 画面外なら地図を寄せる
    if (!this.map.getBounds().pad(-0.1).contains([pt.lat, pt.lon])) this.map.panTo([pt.lat, pt.lon], { animate: true, duration: 0.3 });
  }

  invalidate() { this.map.invalidateSize(); }
}

export function photoPos(p) {
  if (p.hasGps) return [p.lat, p.lon];
  if (p.est) return [p.est.lat, p.est.lon];
  return null;
}

/** 写真ピンのアイコン(推定位置は点線の枠と「推定」バッジ) */
export function pinIcon(p, extraClass = '') {
  const est = !p.hasGps;
  return L.divIcon({
    className: 'pin-wrap ' + extraClass,
    html: `<div class="pin${est ? ' est' : ''}" style="--c:${p.color || '#555'}">${thumbHtml(p)}${est ? '<span class="pin-badge">推定</span>' : ''}</div>`,
    iconSize: [56, 64], iconAnchor: [28, 62],
  });
}

function thumbHtml(p) {
  return p.thumbUrl
    ? `<img src="${escapeHtml(p.thumbUrl)}" alt="">`
    : '<span class="pin-noimg">📷</span>';
}
