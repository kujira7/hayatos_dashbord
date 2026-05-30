function getSpreadsheetCsv() {
  const totalStart = Date.now();
  const file = getOnlySpreadsheetFileByName(SPREADSHEET_FOLDER_PATH, SPREADSHEET_NAME);

  const openStart = Date.now();
  const spreadsheet = SpreadsheetApp.openById(file.getId());
  const metadataSheet = spreadsheet.getSheetByName(METADATA_SHEET_NAME);

  if (!metadataSheet) {
    throw new Error(`Metadata sheet not found. spreadsheet=${SPREADSHEET_NAME}, sheet=${METADATA_SHEET_NAME}`);
  }

  const metadata = readMetadata(metadataSheet);
  const activeSheetName = ACTIVE_SHEET_NAME;
  const sheet = spreadsheet.getSheetByName(activeSheetName);

  if (!sheet) {
    throw new Error(`Active sheet not found. spreadsheet=${SPREADSHEET_NAME}, sheet=${activeSheetName}`);
  }

  const openMs = Date.now() - openStart;
  const readStart = Date.now();
  const values = sheet.getDataRange().getValues();
  const readMs = Date.now() - readStart;

  validateSheetValues(values, activeSheetName, UI_REQUIRED_COLUMNS);

  const serializeStart = Date.now();
  const csv = values.map((row) => row.map(formatCsvCell).join(',')).join('\n');
  const csvBytes = Utilities.newBlob(csv, 'text/csv').getBytes().length;
  const serializeMs = Date.now() - serializeStart;

  if (csvBytes > MAX_CSV_BYTES) {
    throw new Error(`CSV payload is too large. bytes=${csvBytes}, max=${MAX_CSV_BYTES}`);
  }

  return {
    spreadsheet: {
      id: file.getId(),
      name: file.getName(),
      activeSheetName,
      metadataSheetName: METADATA_SHEET_NAME,
      lastUpdated: file.getLastUpdated().toISOString()
    },
    metadata,
    rowCountIncludingHeader: values.length,
    dataRowCount: Math.max(0, values.length - 1),
    columnCount: values[0].length,
    csvBytes,
    csv,
    serverTimingsMs: {
      openSpreadsheet: openMs,
      readValues: readMs,
      serializeCsv: serializeMs,
      total: Date.now() - totalStart
    }
  };
}

function getOrCreateSpreadsheet() {
  const existingFile = getOnlySpreadsheetFileByNameOrNull(SPREADSHEET_FOLDER_PATH, SPREADSHEET_NAME);

  if (existingFile) {
    return SpreadsheetApp.openById(existingFile.getId());
  }

  const folder = getOrCreateFolderByPath(DRIVE_ROOT_FOLDER_ID, SPREADSHEET_FOLDER_PATH);
  const spreadsheet = SpreadsheetApp.create(SPREADSHEET_NAME);
  DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);

  ensureSpreadsheetSheets(spreadsheet);

  return spreadsheet;
}

function ensureSpreadsheetSheets(spreadsheet) {
  DATA_SHEET_NAMES.forEach((sheetName) => getOrCreateSheet(spreadsheet, sheetName));

  const metadataSheet = getOrCreateSheet(spreadsheet, METADATA_SHEET_NAME);

  if (metadataSheet.getLastRow() === 0) {
    writeMetadata(metadataSheet, {
      last_refresh_started_at: '',
      last_refresh_finished_at: '',
      last_refresh_status: '',
      last_refresh_trigger_type: '',
      last_refresh_error: '',
      row_count: '0',
      schema_version: '1'
    });
  }
}

function readMetadata(sheet) {
  const values = sheet.getDataRange().getValues();
  const metadata = {};

  values.slice(1).forEach((row) => {
    const key = String(row[0] || '').trim();

    if (!key) return;

    metadata[key] = formatMetadataValue(row[1]);
  });

  return metadata;
}

function writeMetadata(sheet, metadata) {
  const keys = [
    'last_refresh_started_at',
    'last_refresh_finished_at',
    'last_refresh_status',
    'last_refresh_trigger_type',
    'last_refresh_error',
    'row_count',
    'schema_version',
    'channel_id',
    'channel_title',
    'uploads_playlist_id'
  ];
  const values = [['key', 'value']].concat(keys.map((key) => [key, metadata[key] || '']));

  sheet.clearContents();
  sheet.getRange(1, 1, values.length, 2).setValues(values);
  sheet.setFrozenRows(1);
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

function validateSheetValues(values, sheetName, requiredColumns) {
  if (values.length === 0 || values[0].length === 0) {
    throw new Error(`Sheet is empty. spreadsheet=${SPREADSHEET_NAME}, sheet=${sheetName}`);
  }

  if (values.length > MAX_SHEET_ROWS) {
    throw new Error(`Too many rows. rows=${values.length}, max=${MAX_SHEET_ROWS}`);
  }

  const columns = values[0].map((value) => String(value || '').trim());
  const missingColumns = requiredColumns.filter((column) => !columns.includes(column));

  if (missingColumns.length > 0) {
    throw new Error(`Required columns are missing. sheet=${sheetName}, columns=${missingColumns.join(', ')}`);
  }
}

function writeObjects(spreadsheet, sheetName, columns, objects) {
  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  const values = [columns].concat(objects.map((object) => columns.map((column) => object[column])));

  validateSheetValues(values, sheetName, UI_REQUIRED_COLUMNS);

  sheet.clearContents();
  sheet.getRange(1, 1, values.length, columns.length).setValues(values);
  sheet.setFrozenRows(1);
}

function copySheetValues(spreadsheet, sourceSheetName, destinationSheetName) {
  const sourceSheet = spreadsheet.getSheetByName(sourceSheetName);

  if (!sourceSheet) {
    throw new Error(`Source sheet not found. spreadsheet=${SPREADSHEET_NAME}, sheet=${sourceSheetName}`);
  }

  const values = sourceSheet.getDataRange().getValues();
  validateSheetValues(values, sourceSheetName, UI_REQUIRED_COLUMNS);

  const destinationSheet = getOrCreateSheet(spreadsheet, destinationSheetName);
  destinationSheet.clearContents();
  destinationSheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  destinationSheet.setFrozenRows(1);

  validateSheetValues(destinationSheet.getDataRange().getValues(), destinationSheetName, UI_REQUIRED_COLUMNS);
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

function getOrCreateSheet(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function getOnlySpreadsheetFileByName(folderPath, spreadsheetName) {
  const file = getOnlySpreadsheetFileByNameOrNull(folderPath, spreadsheetName);

  if (!file) {
    throw new Error(`Spreadsheet not found. folderPath=${folderPath}, name=${spreadsheetName}`);
  }

  return file;
}

function getOnlySpreadsheetFileByNameOrNull(folderPath, spreadsheetName) {
  const folder = getOrCreateFolderByPath(DRIVE_ROOT_FOLDER_ID, folderPath);
  const files = folder.getFilesByName(spreadsheetName);

  if (!files.hasNext()) {
    return null;
  }

  const file = files.next();

  if (files.hasNext()) {
    throw new Error(`Duplicate spreadsheet name. folderPath=${folderPath}, name=${spreadsheetName}`);
  }

  if (file.getMimeType() !== GOOGLE_SHEETS_MIME_TYPE) {
    throw new Error(`File is not Google Sheets. name=${spreadsheetName}, mimeType=${file.getMimeType()}`);
  }

  return file;
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
