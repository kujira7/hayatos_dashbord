# ハヤトの野望DB Web App 設計

## 目的

Google Apps Script と Google Sheets を使ってデータを定期更新し、Google Apps Script Web App 上で DuckDB-Wasm に読み込ませて動画一覧を表示する。

## 採用する構成

```text
Google Apps Script time-driven trigger
  -> scheduledRefresh()
  -> refreshDataset()
  -> Google Sheets 更新

Web App 手動更新ボタン
  -> manualRefresh()
  -> refreshDataset()
  -> Google Sheets 更新
  -> 表示データ再読み込み

Web App 初期表示 / 再読み込み
  -> getSpreadsheetCsv()
  -> DuckDB-Wasm
  -> read_csv_auto()
  -> SQL query
  -> HTML table
```

## Drive / Spreadsheet

Google Drive の保存先は次を使う。

```text
content/drive/MyDrive/ハヤトの野望/
FOLDER_ID = '1BMLDFq1tZ7Jj69Pf0FMks80JTRTtC9S1'
```

Spreadsheet はこの folder の `data/` 内に 1 つ作る。

```text
data/hayato_live_spreadsheet
```

本番用に名前を変える場合も、GAS 側では file name ではなく spreadsheet id を使うのが望ましい。

## Sheet 設計

Spreadsheet 内の sheet は次の構成にする。

```text
active
staging
metadata
```

`active` は Web App が常に読むデータ sheet。

`staging` は YouTube から再取得したデータを一時的に書き込む sheet。`staging` の書き込みと検証が成功したら、`active` に copy する。

`metadata` は更新状態を記録する。

```text
key,value
last_refresh_started_at,2026-05-30T00:00:00+09:00
last_refresh_finished_at,2026-05-30T00:01:00+09:00
last_refresh_status,success
last_refresh_trigger_type,daily
last_refresh_error,
row_count,10000
schema_version,1
```

## データ schema

最初の schema は次を想定する。

```text
video_id
title
published_at
duration_sec
live_type
visibility
view_count
like_count
comment_count
peak_concurrent_viewers
thumbnail_url
```

`published_at` は ISO 8601 文字列で保存する。DuckDB-Wasm 側で日時として扱う必要が出たら SQL で変換する。

## 更新処理

更新処理の入口は 2 つ持つ。

```javascript
function scheduledRefresh() {
  return refreshDataset({ triggerType: 'daily' });
}

function manualRefresh() {
  return refreshDataset({ triggerType: 'manual' });
}
```

データ取得と Spreadsheet 書き込みの実体は `refreshDataset()` に集約する。

```javascript
function refreshDataset(options) {
  // 1. LockService で同時実行を防ぐ
  // 2. metadata に running を記録する
  // 3. 外部 API からデータを取得する
  // 4. staging sheet に全件を書き込む
  // 5. staging sheet の required columns と row count を検証する
  // 6. staging sheet を active sheet に copy する
  // 7. active sheet を検証する
  // 8. metadata に success を記録する
}
```

`scheduledRefresh()` と `manualRefresh()` に別々の取得処理を書かない。入口だけを分け、処理本体は共通にする。

## 同時実行制御

`LockService.getScriptLock()` を使う。

手動更新と daily 実行が同時に走った場合、後から来た実行は失敗させる。

```text
Refresh is already running.
```

待ち続ける設計にはしない。Web App 側でエラーを表示する。`staging` の書き込みまたは検証で失敗した場合、古い `active` のデータを表示し続ける。

## active / staging

Spreadsheet を直接見る人の認知負荷を下げるため、読み取り対象を `active`、更新用を `staging` に固定する。

更新手順:

```text
1. staging を clear する
2. staging に header + rows を書く
3. staging の row count と required columns を検証する
4. active を clear する
5. staging の values を active に copy する
6. active の row count と required columns を検証する
7. metadata に success を記録する
```

`active` への copy は atomic ではない。このため、copy 中または copy 失敗時に Web App が空または途中状態の `active` を読む可能性はある。

このリスクより、Spreadsheet 上で `active` / `staging` の意味が直感的に分かることを優先する。

## Web App 読み取り

Web App は常に `active` sheet だけを読む。

```javascript
function getSpreadsheetCsv() {
  // 1. active sheet の data range を読む
  // 2. CSV 文字列に変換する
  // 3. CSV と metadata を返す
}
```

Browser 側では CSV を DuckDB-Wasm に登録する。

```javascript
await db.registerFileText('videos.csv', csv);

await conn.query(`
  CREATE OR REPLACE VIEW videos AS
  SELECT *
  FROM read_csv_auto('videos.csv', header = true)
`);
```

表示用 SQL の例:

```sql
SELECT
  video_id,
  title,
  published_at,
  live_type,
  visibility,
  peak_concurrent_viewers,
  thumbnail_url
FROM videos
ORDER BY peak_concurrent_viewers DESC
LIMIT 200;
```

## 手動更新の画面動作

Web App には手動更新ボタンを置く。

```text
1. button disabled
2. manualRefresh() を呼ぶ
3. success の場合 getSpreadsheetCsv() を呼ぶ
4. DuckDB-Wasm の view を作り直す
5. table を再描画する
6. button enabled
```

失敗時:

```text
1. エラーを表示する
2. 既存の表示データは残す
3. metadata.last_refresh_error は更新する
```

## daily 実行

Apps Script の installable time-driven trigger を使う。

トリガーは Apps Script UI から `scheduledRefresh()` を対象に設定する。Web App UI から daily trigger の作成は行わない。

Apps Script の time-driven trigger は指定時刻ちょうどではなく、一定範囲で実行時刻が決まる。厳密な実行時刻が必要な用途には使わない。

## deploy

Apps Script への反映は `clasp` を使う。

`app/.clasp.json` は次の Apps Script project を指す。

```text
SCRIPT_ID = 1jdiOHw9-1M-4aFZA5RS9qYK5FvCpYiSWq46chMEMu_-LhK6TnQQ7kN2b
```

main deployment は次を使う。

```text
DEPLOYMENT_ID = AKfycbz5NZOqMrrSRD2eq-W2tam6rcwL-bhXv6wXnW47qte7o4C9RI5swgFyJrA7bU6gDLc
```

`app/` の内容を push して main deployment を更新する。

```bash
cd app
npm run gas:release
```

release 後に Web App URL が表示される。

```text
https://script.google.com/macros/s/AKfycbz5NZOqMrrSRD2eq-W2tam6rcwL-bhXv6wXnW47qte7o4C9RI5swgFyJrA7bU6gDLc/exec
```

個別に実行する場合:

```bash
npm run gas:push
npm run gas:deploy
npm run gas:url
```

`--deploymentId` なしの `clasp deploy` は新規 deployment を作る。Apps Script は versioned deployment 数に上限があるため、通常は使わない。

## 制限

Apps Script の主な制限:

```text
Script runtime: 6 min / execution
Triggers total runtime: 90 min / day for consumer accounts, 6 hr / day for Google Workspace accounts
URL Fetch calls: 20,000 / day for consumer accounts, 100,000 / day for Google Workspace accounts
```

参照:

- https://developers.google.com/apps-script/guides/triggers/installable
- https://developers.google.com/apps-script/guides/services/quotas

## 失敗時の扱い

更新失敗時は `metadata.last_refresh_status = failed` と `metadata.last_refresh_error` を記録する。

`staging` の書き込みまたは検証で失敗した場合、`active` は前回成功時の内容を維持する。`active` への copy 中に失敗した場合は、`active` が途中状態になる可能性がある。

記録する metadata:

```text
last_refresh_status = failed
last_refresh_error = error message
last_refresh_trigger_type = daily or manual
last_refresh_finished_at = failure timestamp
```

## ディレクトリ構成

```text
app/
  appsscript.json
  code.gs
  refresh.gs
  spreadsheet.gs
  youtube.gs
  index.html
  styles.html
  scripts.html
  package.json
```
