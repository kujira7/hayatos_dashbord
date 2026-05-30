const DRIVE_ROOT_FOLDER_ID = '1aJKQVs4vofOl-i9qfCbdjNXwGFkZA8vq';
const CHANNEL_HANDLE = '@hayayabo';
const SPREADSHEET_FOLDER_PATH = '';
const SPREADSHEET_NAME = 'hayato_live_spreadsheet';
const METADATA_SHEET_NAME = 'metadata';
const ACTIVE_SHEET_NAME = 'active';
const STAGING_SHEET_NAME = 'staging';
const DATA_SHEET_NAMES = [ACTIVE_SHEET_NAME, STAGING_SHEET_NAME];
const MAX_SHEET_ROWS = 20000;
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const GOOGLE_SHEETS_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';
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
