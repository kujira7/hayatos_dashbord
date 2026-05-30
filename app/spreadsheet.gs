const METADATA_KEYS = [
  'last_refresh_started_at',
  'last_refresh_finished_at',
  'last_success_finished_at',
  'last_refresh_status',
  'last_refresh_trigger_type',
  'last_refresh_error',
  'row_count',
  'schema_version',
  'channel_id',
  'channel_title',
  'uploads_playlist_id'
];

function getDatasetCsv() {
  const totalStart = Date.now();

  const getFileStart = Date.now();
  const file = getOnlyDriveFileByName(VIDEO_CSV_FILE_NAME);
  const getFileMs = Date.now() - getFileStart;

  const readCsvStart = Date.now();
  const csv = file.getBlob().getDataAsString();
  const readCsvMs = Date.now() - readCsvStart;

  const readMetadataStart = Date.now();
  const metadata = readMetadata();
  const readMetadataMs = Date.now() - readMetadataStart;

  const validateStart = Date.now();
  validateCsv(csv, VIDEO_CSV_FILE_NAME);
  const csvBytes = getCsvBytes(csv);
  const validateCsvMs = Date.now() - validateStart;

  return {
    csvFile: createCsvFileSummary(file),
    metadata,
    rowCountIncludingHeader: getRowCountIncludingHeader(metadata, csv),
    dataRowCount: getDataRowCount(metadata, csv),
    columnCount: VIDEO_COLUMNS.length,
    csvBytes,
    csv,
    serverTimingsMs: {
      getFile: getFileMs,
      readCsv: readCsvMs,
      readMetadata: readMetadataMs,
      validateCsv: validateCsvMs,
      total: Date.now() - totalStart
    }
  };
}

function getDatasetManifest() {
  const totalStart = Date.now();
  const file = getOnlyDriveFileByName(VIDEO_CSV_FILE_NAME);
  const metadata = readMetadata();

  return {
    csvFile: createCsvFileSummary(file),
    metadata,
    rowCountIncludingHeader: getRowCountIncludingHeader(metadata, ''),
    dataRowCount: getDataRowCount(metadata, ''),
    columnCount: VIDEO_COLUMNS.length,
    csvBytes: file.getSize(),
    serverTimingsMs: {
      total: Date.now() - totalStart
    }
  };
}

function createCsvFileSummary(file) {
  return {
    id: file.getId(),
    name: file.getName(),
    lastUpdated: file.getLastUpdated().toISOString()
  };
}

function readMetadata() {
  const file = getOnlyDriveFileByNameOrNull(METADATA_JSON_FILE_NAME);

  if (!file) {
    return createDefaultMetadata();
  }

  const content = file.getBlob().getDataAsString();

  if (!content.trim()) {
    return createDefaultMetadata();
  }

  try {
    const metadata = JSON.parse(content);

    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error('metadata JSON must be an object');
    }

    return normalizeMetadata({
      ...createDefaultMetadata(),
      ...metadata
    });
  } catch (error) {
    throw new Error(`Invalid metadata JSON. file=${METADATA_JSON_FILE_NAME}, error=${error.message || error}`);
  }
}

function writeMetadata(metadata) {
  writeDriveFile(METADATA_JSON_FILE_NAME, JSON.stringify(normalizeMetadata(metadata), null, 2), JSON_MIME_TYPE);
}

function normalizeMetadata(metadata) {
  const normalized = {};

  METADATA_KEYS.forEach((key) => {
    normalized[key] = formatMetadataValue(metadata[key]);
  });

  return normalized;
}

function createDefaultMetadata() {
  return normalizeMetadata({
    last_refresh_started_at: '',
    last_refresh_finished_at: '',
    last_success_finished_at: '',
    last_refresh_status: '',
    last_refresh_trigger_type: '',
    last_refresh_error: '',
    row_count: '0',
    schema_version: '1'
  });
}

function formatMetadataValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function objectsToCsv(columns, objects) {
  const csv = [columns].concat(objects.map((object) => columns.map((column) => object[column])))
    .map((row) => row.map(formatCsvCell).join(','))
    .join('\n');

  validateCsv(csv, VIDEO_CSV_FILE_NAME);

  return csv;
}

function writeCsvFile(fileName, csv) {
  validateCsv(csv, fileName);
  return writeDriveFile(fileName, csv, CSV_MIME_TYPE);
}

function validateCsv(csv, fileName) {
  const csvBytes = getCsvBytes(csv);

  if (csvBytes > MAX_CSV_BYTES) {
    throw new Error(`CSV payload is too large. file=${fileName}, bytes=${csvBytes}, max=${MAX_CSV_BYTES}`);
  }

  const lines = csv ? csv.split(/\r\n|\n|\r/) : [];

  if (lines.length === 0 || !lines[0]) {
    throw new Error(`CSV is empty. file=${fileName}`);
  }

  const columns = parseCsvLine(lines[0]).map((value) => String(value || '').trim());
  const missingColumns = UI_REQUIRED_COLUMNS.filter((column) => !columns.includes(column));

  if (missingColumns.length > 0) {
    throw new Error(`Required columns are missing. file=${fileName}, columns=${missingColumns.join(', ')}`);
  }
}

function getCsvBytes(csv) {
  return Utilities.newBlob(csv, CSV_MIME_TYPE).getBytes().length;
}

function getDataRowCount(metadata, csv) {
  const metadataRowCount = Number(metadata.row_count);

  if (Number.isFinite(metadataRowCount) && metadataRowCount >= 0) {
    return metadataRowCount;
  }

  return Math.max(0, csv.split(/\r\n|\n|\r/).length - 1);
}

function getRowCountIncludingHeader(metadata, csv) {
  return getDataRowCount(metadata, csv) + 1;
}

function formatCsvCell(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = value instanceof Date
    ? value.toISOString()
    : String(value);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }

  cells.push(cell);

  return cells;
}

function writeDriveFile(fileName, content, mimeType) {
  const folder = getDriveRootFolder();
  const file = getOnlyDriveFileByNameOrNull(fileName);

  if (file) {
    file.setContent(content);
    return file;
  }

  return folder.createFile(fileName, content, mimeType);
}

function getOnlyDriveFileByName(fileName) {
  const file = getOnlyDriveFileByNameOrNull(fileName);

  if (!file) {
    throw new Error(`Drive file not found. name=${fileName}`);
  }

  return file;
}

function getOnlyDriveFileByNameOrNull(fileName) {
  const folder = getDriveRootFolder();
  const files = folder.getFilesByName(fileName);

  if (!files.hasNext()) {
    return null;
  }

  const file = files.next();

  if (files.hasNext()) {
    throw new Error(`Duplicate Drive file name. name=${fileName}`);
  }

  return file;
}

function getDriveRootFolder() {
  return DriveApp.getFolderById(getRequiredScriptProperty(DRIVE_ROOT_FOLDER_ID_PROPERTY));
}
