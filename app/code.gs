const CHANNEL_HANDLE = '@hayayabo';
const VIDEO_CSV_FILE_NAME = 'hayato_live_videos.csv';
const STAGING_VIDEO_CSV_FILE_NAME = 'hayato_live_videos.staging.csv';
const METADATA_JSON_FILE_NAME = 'hayato_live_metadata.json';
const MAX_CSV_BYTES = 9500000;
const CSV_MIME_TYPE = MimeType.CSV;
const JSON_MIME_TYPE = 'application/json';
const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const DRIVE_ROOT_FOLDER_ID_PROPERTY = 'DRIVE_ROOT_FOLDER_ID';
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
  if (filename === 'scripts') {
    return includeScripts();
  }

  return includeRaw(filename);
}

function includeRaw(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function includeScripts() {
  const html = includeRaw('scripts').replace(
    /<\?!= includeRaw\('([^']+)'\); \?>/g,
    function(_match, partialName) {
      return getScriptPartialContent(partialName);
    }
  );
  const source = html
    .replace(/^  <script type="module">\n/, '')
    .replace(/\n  <\/script>\n?$/, '');
  const encoded = Utilities.base64Encode(source, Utilities.Charset.UTF_8);

  return [
    '<script>',
    '(function() {',
    `  const encoded = '${encoded}';`,
    "  const bytes = Uint8Array.from(atob(encoded), function(ch) { return ch.charCodeAt(0); });",
    "  const script = document.createElement('script');",
    "  script.type = 'module';",
    '  script.textContent = new TextDecoder().decode(bytes);',
    '  document.head.appendChild(script);',
    '}());',
    '</script>'
  ].join('\n');
}

function getScriptPartialContent(partialName) {
  const content = includeRaw(partialName);
  const match = content.match(/^<script type="application\/json" data-dashboard-script-partial>\n([\s\S]*)\n<\/script>\n?$/);

  if (!match) {
    throw new Error(`Invalid script partial. name=${partialName}`);
  }

  return match[1];
}

function getRequiredScriptProperty(propertyName) {
  const value = PropertiesService.getScriptProperties().getProperty(propertyName);

  if (!value) {
    throw new Error(`Script property is required. name=${propertyName}`);
  }

  return value;
}
