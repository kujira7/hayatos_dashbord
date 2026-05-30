function fetchYouTubeDataset() {
  const apiKey = getRequiredYouTubeApiKey();
  const channel = fetchChannel(apiKey);
  const playlistItems = fetchUploadPlaylistItems(apiKey, channel.uploadsPlaylistId);
  const videos = fetchVideoDetails(apiKey, playlistItems.map((item) => item.videoId));
  const fetchedAt = new Date();

  return {
    channel,
    rows: videos.map((video) => normalizeVideo(video, fetchedAt))
  };
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

  do {
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
  } while (pageToken);

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
    duration_sec: durationIso ? parseYouTubeDurationSeconds(durationIso) : '',
    live_type: hasLiveDetails ? 'LIVE' : '通常動画',
    visibility: status.privacyStatus || '',
    peak_concurrent_viewers: '',
    thumbnail_url: thumbnail.url || '',
    duration_iso: durationIso,
    live_broadcast_content: snippet.liveBroadcastContent || '',
    view_count: statistics.viewCount || '',
    like_count: statistics.likeCount || '',
    comment_count: statistics.commentCount || '',
    current_concurrent_viewers: liveStreamingDetails.concurrentViewers || '',
    scheduled_start_time: liveStreamingDetails.scheduledStartTime || '',
    actual_start_time: liveStreamingDetails.actualStartTime || '',
    actual_end_time: liveStreamingDetails.actualEndTime || '',
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
