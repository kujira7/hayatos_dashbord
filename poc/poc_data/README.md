# YouTube Data API PoC

## 目的

`https://www.youtube.com/@hayayabo` の公開動画データを YouTube Data API v3 から取得し、Google Drive 上の Google Sheets に保存する。

この PoC はデータ取得部分の検証用。表示側の DuckDB-Wasm 検証は `poc_spreadsheet/` を使う。

## 保存先

```text
content/drive/MyDrive/ハヤトの野望/
FOLDER_ID = '1BMLDFq1tZ7Jj69Pf0FMks80JTRTtC9S1'
```

作成する Spreadsheet:

```text
data/hayato_youtube_data
```

Sheet:

```text
videos
refresh_runs
```

## 取得方法

YouTube Data API v3 を `UrlFetchApp` から呼ぶ。

処理順:

```text
channels.list(forHandle='@hayayabo')
  -> contentDetails.relatedPlaylists.uploads
playlistItems.list(uploads playlist)
  -> video ids
videos.list(video ids)
  -> snippet / contentDetails / statistics / liveStreamingDetails / status
Google Sheets に保存
```

## API key

Apps Script の Script properties に次を設定する。

```text
YOUTUBE_API_KEY = <YouTube Data API v3 の API key>
```

API key は source code に書かない。

## 実行経路

手動実行:

```text
Web App
  -> manualRefresh()
  -> refreshDataset({ triggerType: 'manual' })
```

daily 実行:

```text
Apps Script UI の time-driven trigger
  -> scheduledRefresh()
  -> refreshDataset({ triggerType: 'daily' })
```

`manualRefresh()` と `scheduledRefresh()` は薄い wrapper にし、実処理は `refreshDataset()` に集約する。

## 取得列

```text
video_id
title
published_at
duration_iso
duration_sec
live_broadcast_content
live_type
privacy_status
view_count
like_count
comment_count
current_concurrent_viewers
scheduled_start_time
actual_start_time
actual_end_time
thumbnail_url
video_url
fetched_at
```

## 注意点

`peak_concurrent_viewers` はこの PoC では取得しない。

YouTube Data API v3 の `videos.list` で取れる `liveStreamingDetails.concurrentViewers` は現在の同時視聴者数であり、過去配信の最大同時視聴者数ではない。履歴の最大同時視聴者数が必要な場合は YouTube Analytics API など別の取得経路を検証する。

## 参照

- https://developers.google.com/youtube/v3/docs/channels/list
- https://developers.google.com/youtube/v3/docs/playlistItems/list
- https://developers.google.com/youtube/v3/docs/videos
