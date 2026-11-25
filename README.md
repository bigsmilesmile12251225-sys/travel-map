# travel-map(旅の地図)

GPXファイル(ウェイログなどで記録)と写真を読み込むと、移動ルートと撮影地点を地図上に表示して旅を振り返れるWebアプリです。
写真やGPXはすべてブラウザ内で処理し、外部サーバーには送信しません。

## 主な機能
- GPXのルートを日ごとに色分けして表示(複数ファイル対応)
- 写真(JPEG / HEIC)の撮影地点にサムネイル付きピン。タップで拡大表示
- 位置情報のない写真は、撮影時刻とGPXの時刻を照合して位置を推定(点線の枠と「推定」バッジで表示)
- タイムライン(iPadは右側、iPhoneは下のシート)。項目をタップすると地図がその地点へ移動
- 総移動距離・日ごとの距離・開始/終了時刻のサマリー、標高グラフ
- ライト/ダークモード、ホーム画面への追加に対応

## 時刻の扱い
- GPXの時刻はUTCとして扱います
- 写真は `OffsetTimeOriginal` があればそれを使い、なければGPS日時、どちらもなければ「旅先のタイムゾーン」(既定: 自動 → 端末)を仮定します
- 設定画面でタイムゾーンと時刻補正(分)を変更できます

## 構成
ビルド不要の静的サイトです。

```
index.html / manifest.webmanifest / icons/
css/style.css
js/app.js        全体の制御
js/photos.js     EXIF読み取り(exifr)・サムネイル作成
js/gpx.js        GPX解析・日ごとの集計
js/estimate.js   時刻照合による位置推定
js/map.js        地図(Leaflet + OpenStreetMap)
js/panel.js      タイムライン・サマリー
js/elevation.js  標高グラフ
js/viewer.js     写真の拡大表示
js/check.js      写真の読み取り結果一覧
js/util.js       共通処理
```

外部ライブラリ(CDN・バージョン固定): Leaflet 1.9.4 / Leaflet.markercluster 1.5.3 / exifr 7.1.3

地図データ © OpenStreetMap contributors
