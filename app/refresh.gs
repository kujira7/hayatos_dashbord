function manualRefresh() {
  return refreshDataset({ triggerType: 'manual' });
}

function scheduledRefresh() {
  return refreshDataset({ triggerType: 'daily' });
}

function refreshDataset(options) {
  const triggerType = options && options.triggerType ? options.triggerType : 'unknown';
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(1000)) {
    throw new Error('Refresh is already running.');
  }

  const startedAt = new Date();
  let metadataSheet = null;
  let metadata = {};
  let channel = null;

  try {
    const spreadsheet = getOrCreateSpreadsheet();
    ensureSpreadsheetSheets(spreadsheet);

    metadataSheet = getOrCreateSheet(spreadsheet, METADATA_SHEET_NAME);
    metadata = readMetadata(metadataSheet);

    writeMetadata(metadataSheet, {
      ...metadata,
      last_refresh_started_at: startedAt.toISOString(),
      last_refresh_finished_at: '',
      last_refresh_status: 'running',
      last_refresh_trigger_type: triggerType,
      last_refresh_error: ''
    });

    const dataset = fetchYouTubeDataset();
    channel = dataset.channel;

    writeObjects(spreadsheet, STAGING_SHEET_NAME, VIDEO_COLUMNS, dataset.rows);
    copySheetValues(spreadsheet, STAGING_SHEET_NAME, ACTIVE_SHEET_NAME);

    const finishedAt = new Date();
    const nextMetadata = {
      ...metadata,
      last_refresh_started_at: startedAt.toISOString(),
      last_refresh_finished_at: finishedAt.toISOString(),
      last_refresh_status: 'success',
      last_refresh_trigger_type: triggerType,
      last_refresh_error: '',
      row_count: String(dataset.rows.length),
      schema_version: '1',
      channel_id: channel.id,
      channel_title: channel.title,
      uploads_playlist_id: channel.uploadsPlaylistId
    };

    writeMetadata(metadataSheet, nextMetadata);

    return {
      status: 'success',
      triggerType,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      activeSheetName: ACTIVE_SHEET_NAME,
      rowCount: dataset.rows.length,
      channel
    };
  } catch (error) {
    if (metadataSheet) {
      writeMetadata(metadataSheet, {
        ...metadata,
        last_refresh_started_at: startedAt.toISOString(),
        last_refresh_finished_at: new Date().toISOString(),
        last_refresh_status: 'failed',
        last_refresh_trigger_type: triggerType,
        last_refresh_error: String(error.message || error),
        channel_id: channel ? channel.id : metadata.channel_id,
        channel_title: channel ? channel.title : metadata.channel_title,
        uploads_playlist_id: channel ? channel.uploadsPlaylistId : metadata.uploads_playlist_id
      });
    }

    throw error;
  } finally {
    lock.releaseLock();
  }
}
