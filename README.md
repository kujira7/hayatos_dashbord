# ハヤトの野望DB

Google Apps Script Web App で、ハヤトの野望 YouTube チャンネルの動画データを一覧・分析する dashboard。

## 現在の構成

```text
YouTube Data API
  -> fetchYouTubeDataset()
  -> Drive CSV / metadata JSON 更新

Web App 初期表示 / 再読み込み
  -> getDatasetManifest()
  -> getDatasetCsv()
  -> Browser IndexedDB cache
  -> DuckDB-Wasm read_csv_auto()
  -> 動画一覧 / BI dashboard

Web App 手動更新
  -> manualRefresh()
  -> refreshDataset()
  -> Drive CSV / metadata JSON 更新
  -> 表示データ再読み込み

Time-driven trigger
  -> scheduledRefresh()
  -> refreshDataset()
```

## ファイル構成

```text
app/
  code.gs             # 定数、doGet、include
  youtube.gs          # YouTube Data API 取得
  refresh.gs          # manualRefresh / scheduledRefresh / refreshDataset
  spreadsheet.gs      # Drive CSV / metadata JSON 読み書き
  index.html          # Web App HTML
  styles.html         # Web App CSS
  scripts_*.html      # Browser JS partial
  appsscript.json     # Apps Script manifest
tools/
  validate-ui-contract.mjs
```

## 保存先

データは Spreadsheet ではなく、Google Drive folder 内の CSV / JSON file として保存する。

保存先 folder id は Apps Script の Script properties で設定する。

```text
DRIVE_ROOT_FOLDER_ID = <your-drive-folder-id>
VIDEO_CSV_FILE_NAME = hayato_live_videos.csv
STAGING_VIDEO_CSV_FILE_NAME = hayato_live_videos.staging.csv
METADATA_JSON_FILE_NAME = hayato_live_metadata.json
```

`getOnlyDriveFileByNameOrNull()` は同名 file が複数ある場合に失敗する。対象 folder 内では上記 file name を重複させない。

## 必須設定

Apps Script の Script properties には次を設定する。

```text
DRIVE_ROOT_FOLDER_ID
YOUTUBE_API_KEY
```

未設定の場合、該当処理は次の error で失敗する。

```text
Script property is required. name=<property-name>
```

## データ取得

対象チャンネルは `CHANNEL_HANDLE = '@hayayabo'`。

取得処理:

1. `/channels` で channel と uploads playlist を取得する。
2. `/playlistItems` で uploads playlist の video id を全件取得する。
3. `/videos` を 50 件ずつ呼び、動画詳細を取得する。
4. CSV に正規化する。
5. staging CSV を書く。
6. staging CSV を読み戻して validate する。
7. production CSV を staging CSV から置き換える。
8. metadata JSON を更新する。

同時実行は `LockService.getScriptLock()` で制御する。lock を取れない場合は待ち続けず、次の error で失敗する。

```text
Refresh is already running.
```

### CSV 更新方針

production CSV は `setContent()` で直接上書きしない。

書き込み途中の partial CSV が Web App に成功扱いで読まれることを避けるため。読み取り頻度は低く、一時的な file not found は許容する。一方で、壊れた CSV を成功として表示することは避ける。

更新は staging CSV を書き、読み戻して validate した後、production CSV を staging から置き換える。これは atomic update ではない。

## CSV schema

CSV の列は `VIDEO_COLUMNS` で定義する。

```text
video_id
title
published_at
duration_sec
live_type
visibility
peak_concurrent_viewers
thumbnail_url
duration_iso
live_broadcast_content
view_count
like_count
comment_count
current_concurrent_viewers
scheduled_start_time
actual_start_time
actual_end_time
video_url
fetched_at
```

UI が必須として検証する列は `UI_REQUIRED_COLUMNS`。

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

CSV payload は `MAX_CSV_BYTES = 9500000` bytes を超えると失敗する。

## metadata JSON

metadata JSON は次の key を持つ。

```text
last_refresh_started_at
last_refresh_finished_at
last_success_finished_at
last_refresh_status
last_refresh_trigger_type
last_refresh_error
row_count
schema_version
channel_id
channel_title
uploads_playlist_id
```

値は `normalizeMetadata()` で文字列に正規化される。

## Web App

Apps Script Web App は `doGet()` で `index.html` を返す。`styles.html` は HTML file として読み込み、Browser JS は `include('scripts')` で生成する。

画面:

- 動画一覧
- 種別 filter: `ALL` / `LIVE` / `通常動画` / `Shorts`
- page size: `50` / `100` / `200` / `500`
- sortable columns
- BI dashboard
- correlation scatter / density plot
- YouTube から全データ再取得
- CSV 再読み込みボタンは Drive CSV を再読み込み

Browser 側は `@duckdb/duckdb-wasm@1.29.0` を jsDelivr から import し、`read_csv_auto('videos.csv', header = true)` で view を作る。

Browser JS は外部 build なしで分割する。読み込み順は `code.gs` の `SCRIPT_PARTIALS` に定義し、実体は `scripts_*.html` に置く。Apps Script の template engine は script 内の `<` を escape するため、`scripts_*.html` は次の wrapper で JS 本文を保持する。

```html
<script type="application/json" data-dashboard-script-partial>
  // JS body
</script>
```

`code.gs` の `include('scripts')` は次を行う。

1. `SCRIPT_PARTIALS` の順に `scripts_*.html` を読む。
2. 各 partial の wrapper から JS 本文だけを抜く。
3. 連結した module JS を base64 encode する。
4. Browser で decode し、`<script type="module">` として注入する。

この設計は Apps Script editor へのコピペ再現性を優先する。`scripts_*.html` の wrapper と `SCRIPT_PARTIALS` は検証対象なので、変更後は UI contract を実行する。

IndexedDB cache:

```text
CACHE_DB_NAME = hayato-live-dashboard
CACHE_STORE_NAME = datasets
CACHE_KEY = videos
CACHE_SCHEMA_VERSION = 1
```

cache がある場合は先に cache から描画し、`getDatasetManifest()` で freshness を確認する。古ければ `getDatasetCsv()` で CSV を再取得する。

## Apps Script

`appsscript.json` の Web App 設定:

```text
executeAs = USER_DEPLOYING
access = ANYONE_ANONYMOUS
runtimeVersion = V8
timeZone = Asia/Tokyo
```

## 開発コマンド

UI contract の最低限の検証:

```bash
cd app
node ../tools/validate-ui-contract.mjs
```

## 検証

UI contract の最低限の検証:

```bash
cd app
node ../tools/validate-ui-contract.mjs
```

この検証は次を確認する。

- `index.html` が `styles.html` と Browser JS を include している
- `index.html` に module script / DuckDB import / inline style がない
- UI 操作に必要な id / class / data attribute が存在する
- `styles.html` に `.correlation-table-wrap` が定義されている
- `code.gs` の `SCRIPT_PARTIALS` と `scripts_*.html` が一致している
- `scripts_*.html` が JS partial wrapper 形式になっている
- partial 展開後の module script に template directive が残っていない
- partial 展開後の module script に escaped operator が混入していない
- partial 展開後の module script が構文として有効である

## 既知の制約

- production CSV の置き換えは atomic ではない。
- `peak_concurrent_viewers` は YouTube Data API から過去最大同接を取得できないため、現在は空文字になる。
- Web App は anonymous access 設定のため、表示してよい情報だけを Drive CSV に含める。
- Drive folder 内で同名 file が重複すると読み取り・更新に失敗する。
