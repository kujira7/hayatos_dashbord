const DRIVE_ROOT_FOLDER_ID = '1BMLDFq1tZ7Jj69Pf0FMks80JTRTtC9S1';
const CHANNEL_HANDLE = '@hayayabo';
const SPREADSHEET_FOLDER_PATH = 'data';
const SPREADSHEET_NAME = 'hayato_youtube_data';
const DATA_SHEET_NAME = 'videos';
const RUNS_SHEET_NAME = 'refresh_runs';
const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_API_KEY_PROPERTY = 'YOUTUBE_API_KEY';
const MAX_PLAYLIST_PAGES = 4;
const SPREADSHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';

const VIDEO_COLUMNS = [
  'video_id',
  'title',
  'published_at',
  'duration_iso',
  'duration_sec',
  'live_broadcast_content',
  'live_type',
  'privacy_status',
  'view_count',
  'like_count',
  'comment_count',
  'current_concurrent_viewers',
  'scheduled_start_time',
  'actual_start_time',
  'actual_end_time',
  'thumbnail_url',
  'video_url',
  'fetched_at'
];

const RUN_COLUMNS = [
  'started_at',
  'finished_at',
  'status',
  'trigger_type',
  'channel_id',
  'channel_title',
  'uploads_playlist_id',
  'row_count',
  'error'
];

function doGet() {
  return HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle('YouTube Data API PoC')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getPocConfig() {
  return {
    driveRootFolderId: DRIVE_ROOT_FOLDER_ID,
    spreadsheetFolderPath: SPREADSHEET_FOLDER_PATH,
    channelHandle: CHANNEL_HANDLE,
    spreadsheetName: SPREADSHEET_NAME,
    dataSheetName: DATA_SHEET_NAME,
    maxPlaylistPages: MAX_PLAYLIST_PAGES,
    hasYouTubeApiKey: Boolean(PropertiesService.getScriptProperties().getProperty(YOUTUBE_API_KEY_PROPERTY))
  };
}

function manualRefresh() {
  return refreshDataset({ triggerType: 'manual' });
}

function scheduledRefresh() {
  return refreshDataset({ triggerType: 'daily' });
}

function getLatestRows(limit) {
  const spreadsheet = getOnlySpreadsheetByNameOrNull(SPREADSHEET_NAME);

  if (!spreadsheet) {
    return {
      spreadsheet: null,
      rows: [],
      runs: []
    };
  }

  const dataSheet = spreadsheet.getSheetByName(DATA_SHEET_NAME);
  const runSheet = spreadsheet.getSheetByName(RUNS_SHEET_NAME);

  return {
    spreadsheet: {
      id: spreadsheet.getId(),
      name: spreadsheet.getName(),
      url: spreadsheet.getUrl()
    },
    rows: dataSheet ? readSheetObjects(dataSheet, limit || 20) : [],
    runs: runSheet ? readSheetObjects(runSheet, 5) : []
  };
}

function refreshDataset(options) {
  const triggerType = options && options.triggerType ? options.triggerType : 'unknown';
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(1000)) {
    throw new Error('Refresh is already running.');
  }

  const startedAt = new Date();
  let spreadsheet = null;
  let channel = null;

  try {
    const apiKey = getRequiredYouTubeApiKey();

    spreadsheet = getOrCreateSpreadsheet();
    channel = fetchChannel(apiKey);
    const playlistItems = fetchUploadPlaylistItems(apiKey, channel.uploadsPlaylistId);
    const videos = fetchVideoDetails(apiKey, playlistItems.map((item) => item.videoId));
    const fetchedAt = new Date();
    const rows = videos.map((video) => normalizeVideo(video, fetchedAt));

    writeObjects(spreadsheet, DATA_SHEET_NAME, VIDEO_COLUMNS, rows);

    const result = {
      status: 'success',
      triggerType,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      channel,
      rowCount: rows.length,
      spreadsheet: {
        id: spreadsheet.getId(),
        name: spreadsheet.getName(),
        url: spreadsheet.getUrl()
      }
    };

    appendRun(spreadsheet, {
      started_at: result.startedAt,
      finished_at: result.finishedAt,
      status: result.status,
      trigger_type: triggerType,
      channel_id: channel.id,
      channel_title: channel.title,
      uploads_playlist_id: channel.uploadsPlaylistId,
      row_count: rows.length,
      error: ''
    });

    return {
      ...result,
      previewRows: rows.slice(0, 20)
    };
  } catch (error) {
    if (spreadsheet) {
      appendRun(spreadsheet, {
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        status: 'failed',
        trigger_type: triggerType,
        channel_id: channel ? channel.id : '',
        channel_title: channel ? channel.title : '',
        uploads_playlist_id: channel ? channel.uploadsPlaylistId : '',
        row_count: '',
        error: String(error.message || error)
      });
    }

    throw error;
  } finally {
    lock.releaseLock();
  }
}

function fetchChannel(apiKey) {
  const response = youtubeGet('/channels', {
    part: 'snippet,contentDetails,statistics',
    forHandle: CHANNEL_HANDLE
  }, apiKey);

  if (!response.items || response.items.length !== 1) {
    throw new Error(`Channel not found or ambiguous. handle=${CHANNEL_HANDLE}`);
  }

  const item = response.items[0];

  return {
    id: item.id,
    title: item.snippet.title,
    handle: CHANNEL_HANDLE,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    subscriberCount: item.statistics.subscriberCount || '',
    videoCount: item.statistics.videoCount || '',
    viewCount: item.statistics.viewCount || ''
  };
}

function fetchUploadPlaylistItems(apiKey, playlistId) {
  const items = [];
  let pageToken = '';

  for (let page = 0; page < MAX_PLAYLIST_PAGES; page += 1) {
    const response = youtubeGet('/playlistItems', {
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: 50,
      pageToken
    }, apiKey);

    (response.items || []).forEach((item) => {
      const videoId = item.contentDetails && item.contentDetails.videoId;

      if (videoId) {
        items.push({
          videoId,
          playlistPublishedAt: item.contentDetails.videoPublishedAt || item.snippet.publishedAt || ''
        });
      }
    });

    pageToken = response.nextPageToken || '';

    if (!pageToken) {
      break;
    }
  }

  return dedupeByVideoId(items);
}

function fetchVideoDetails(apiKey, videoIds) {
  const videos = [];

  chunk(videoIds, 50).forEach((ids) => {
    if (ids.length === 0) {
      return;
    }

    const response = youtubeGet('/videos', {
      part: 'snippet,contentDetails,statistics,liveStreamingDetails,status',
      id: ids.join(',')
    }, apiKey);

    videos.push(...(response.items || []));
  });

  return videos;
}

function normalizeVideo(video, fetchedAt) {
  const snippet = video.snippet || {};
  const contentDetails = video.contentDetails || {};
  const statistics = video.statistics || {};
  const liveStreamingDetails = video.liveStreamingDetails || {};
  const status = video.status || {};
  const thumbnails = snippet.thumbnails || {};
  const thumbnail = thumbnails.medium || thumbnails.high || thumbnails.default || {};
  const durationIso = contentDetails.duration || '';
  const hasLiveDetails = Boolean(
    liveStreamingDetails.scheduledStartTime ||
    liveStreamingDetails.actualStartTime ||
    liveStreamingDetails.actualEndTime
  );

  return {
    video_id: video.id,
    title: snippet.title || '',
    published_at: snippet.publishedAt || '',
    duration_iso: durationIso,
    duration_sec: durationIso ? parseYouTubeDurationSeconds(durationIso) : '',
    live_broadcast_content: snippet.liveBroadcastContent || '',
    live_type: hasLiveDetails ? 'LIVE' : '通常動画',
    privacy_status: status.privacyStatus || '',
    view_count: statistics.viewCount || '',
    like_count: statistics.likeCount || '',
    comment_count: statistics.commentCount || '',
    current_concurrent_viewers: liveStreamingDetails.concurrentViewers || '',
    scheduled_start_time: liveStreamingDetails.scheduledStartTime || '',
    actual_start_time: liveStreamingDetails.actualStartTime || '',
    actual_end_time: liveStreamingDetails.actualEndTime || '',
    thumbnail_url: thumbnail.url || '',
    video_url: `https://www.youtube.com/watch?v=${video.id}`,
    fetched_at: fetchedAt.toISOString()
  };
}

function youtubeGet(path, params, apiKey) {
  const query = {
    ...params,
    key: apiKey
  };
  const url = `${YOUTUBE_API_BASE_URL}${path}?${toQueryString(query)}`;
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true
  });
  const statusCode = response.getResponseCode();
  const text = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`YouTube Data API request failed. status=${statusCode}, body=${text}`);
  }

  return JSON.parse(text);
}

function getRequiredYouTubeApiKey() {
  const apiKey = PropertiesService.getScriptProperties().getProperty(YOUTUBE_API_KEY_PROPERTY);

  if (!apiKey) {
    throw new Error(`Script property is required. name=${YOUTUBE_API_KEY_PROPERTY}`);
  }

  return apiKey;
}

function getOrCreateSpreadsheet() {
  const existing = getOnlySpreadsheetByNameOrNull(SPREADSHEET_NAME);

  if (existing) {
    return existing;
  }

  const folder = getOrCreateFolderByPath(DRIVE_ROOT_FOLDER_ID, SPREADSHEET_FOLDER_PATH);
  const spreadsheet = SpreadsheetApp.create(SPREADSHEET_NAME);
  DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);

  return spreadsheet;
}

function getOnlySpreadsheetByNameOrNull(name) {
  const folder = getOrCreateFolderByPath(DRIVE_ROOT_FOLDER_ID, SPREADSHEET_FOLDER_PATH);
  const files = folder.getFilesByName(name);

  if (!files.hasNext()) {
    return null;
  }

  const file = files.next();

  if (files.hasNext()) {
    throw new Error(`Duplicate spreadsheet name. folderPath=${SPREADSHEET_FOLDER_PATH}, name=${name}`);
  }

  if (file.getMimeType() !== SPREADSHEET_MIME_TYPE) {
    throw new Error(`File is not Google Sheets. name=${name}, mimeType=${file.getMimeType()}`);
  }

  return SpreadsheetApp.openById(file.getId());
}

function getOrCreateFolderByPath(rootFolderId, folderPath) {
  const segments = String(folderPath || '').split('/').filter(Boolean);
  let folder = DriveApp.getFolderById(rootFolderId);

  segments.forEach((segment) => {
    const folders = folder.getFoldersByName(segment);

    folder = folders.hasNext()
      ? folders.next()
      : folder.createFolder(segment);

    if (folders.hasNext()) {
      throw new Error(`Duplicate folder name. folderPath=${folderPath}, folder=${segment}`);
    }
  });

  return folder;
}

function writeObjects(spreadsheet, sheetName, columns, objects) {
  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  const values = [columns].concat(objects.map((object) => columns.map((column) => object[column])));

  sheet.clearContents();
  sheet.getRange(1, 1, values.length, columns.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, columns.length);
}

function appendRun(spreadsheet, run) {
  const sheet = getOrCreateSheet(spreadsheet, RUNS_SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, RUN_COLUMNS.length).setValues([RUN_COLUMNS]);
    sheet.setFrozenRows(1);
  }

  sheet.appendRow(RUN_COLUMNS.map((column) => run[column]));
}

function getOrCreateSheet(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function readSheetObjects(sheet, limit) {
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return [];
  }

  const headers = values[0].map(String);

  return values.slice(1, 1 + limit).map((row) => {
    const object = {};

    headers.forEach((header, index) => {
      const value = row[index];
      object[header] = value instanceof Date ? value.toISOString() : value;
    });

    return object;
  });
}

function dedupeByVideoId(items) {
  const seen = {};

  return items.filter((item) => {
    if (seen[item.videoId]) {
      return false;
    }

    seen[item.videoId] = true;
    return true;
  });
}

function chunk(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function toQueryString(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== '' && params[key] !== null && params[key] !== undefined)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

function parseYouTubeDurationSeconds(duration) {
  const match = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);

  if (!match) {
    return '';
  }

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);

  return (days * 86400) + (hours * 3600) + (minutes * 60) + seconds;
}
