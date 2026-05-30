const DRIVE_ROOT_FOLDER_ID = '1aJKQVs4vofOl-i9qfCbdjNXwGFkZA8vq';
const CHANNEL_HANDLE = '@hayayabo';
const DATA_FOLDER_PATH = '';
const VIDEO_CSV_FILE_NAME = 'hayato_live_videos.csv';
const STAGING_VIDEO_CSV_FILE_NAME = 'hayato_live_videos.staging.csv';
const METADATA_JSON_FILE_NAME = 'hayato_live_metadata.json';
const MAX_DATA_ROWS = 20000;
const MAX_CSV_BYTES = 9500000;
const CSV_MIME_TYPE = MimeType.CSV;
const JSON_MIME_TYPE = 'application/json';
const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_API_KEY_PROPERTY = 'YOUTUBE_API_KEY';

const UI_REQUIRED_COLUMNS = [
  'video_id',
  'title',
  'published_at',
  'duration_sec',
  'live_type',
  'visibility',
  'view_count',
  'like_count',
  'comment_count',
  'peak_concurrent_viewers',
  'thumbnail_url'
];

const VIDEO_COLUMNS = [
  'video_id',
  'title',
  'published_at',
  'duration_sec',
  'live_type',
  'visibility',
  'peak_concurrent_viewers',
  'thumbnail_url',
  'duration_iso',
  'live_broadcast_content',
  'view_count',
  'like_count',
  'comment_count',
  'current_concurrent_viewers',
  'scheduled_start_time',
  'actual_start_time',
  'actual_end_time',
  'video_url',
  'fetched_at'
];

function doGet() {
  return HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle('ハヤトの野望DB')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
