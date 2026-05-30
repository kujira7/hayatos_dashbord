const DRIVE_ROOT_FOLDER_ID = '1BMLDFq1tZ7Jj69Pf0FMks80JTRTtC9S1';
const SPREADSHEET_FOLDER_PATH = 'data';
const SPREADSHEET_NAME = 'hayato_live_spreadsheet';
const SHEET_NAME = 'active';
const MAX_SHEET_ROWS = 20000;
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const GOOGLE_SHEETS_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';

function doGet() {
  return HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle('DuckDB-Wasm Spreadsheet PoC')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Spreadsheetの内容をDuckDB-Wasmへ渡すため、CSV文字列として返す。
 * PoC用: Spreadsheet読取、CSV化、client側DuckDB読込の時間を分けて測る。
 */
function getSpreadsheetCsv() {
  const totalStart = Date.now();
  const file = getOnlySpreadsheetFileByName(SPREADSHEET_FOLDER_PATH, SPREADSHEET_NAME);

  const openStart = Date.now();
  const spreadsheet = SpreadsheetApp.openById(file.getId());
  const sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error(`Sheet not found. spreadsheet=${SPREADSHEET_NAME}, sheet=${SHEET_NAME}`);
  }

  const openMs = Date.now() - openStart;
  const readStart = Date.now();
  const range = sheet.getDataRange();
  const values = range.getValues();
  const readMs = Date.now() - readStart;

  if (values.length === 0 || values[0].length === 0) {
    throw new Error(`Sheet is empty. spreadsheet=${SPREADSHEET_NAME}, sheet=${SHEET_NAME}`);
  }

  if (values.length > MAX_SHEET_ROWS) {
    throw new Error(`Too many rows for this PoC. rows=${values.length}, max=${MAX_SHEET_ROWS}`);
  }

  const serializeStart = Date.now();
  const csv = values.map((row) => row.map(formatCsvCell).join(',')).join('\n');
  const csvBytes = Utilities.newBlob(csv, 'text/csv').getBytes().length;
  const serializeMs = Date.now() - serializeStart;

  if (csvBytes > MAX_CSV_BYTES) {
    throw new Error(`CSV payload is too large for this PoC. bytes=${csvBytes}, max=${MAX_CSV_BYTES}`);
  }

  return {
    spreadsheet: {
      id: file.getId(),
      name: file.getName(),
      sheetName: SHEET_NAME,
      lastUpdated: file.getLastUpdated().toISOString()
    },
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

function getOnlySpreadsheetFileByName(folderPath, spreadsheetName) {
  const folder = getFolderByPath(DRIVE_ROOT_FOLDER_ID, folderPath);
  const files = folder.getFilesByName(spreadsheetName);

  if (!files.hasNext()) {
    throw new Error(`Spreadsheet not found. folderPath=${folderPath}, name=${spreadsheetName}`);
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

function getFolderByPath(rootFolderId, folderPath) {
  const segments = String(folderPath || '').split('/').filter(Boolean);
  let folder = DriveApp.getFolderById(rootFolderId);

  segments.forEach((segment) => {
    const folders = folder.getFoldersByName(segment);

    if (!folders.hasNext()) {
      throw new Error(`Folder not found. folderPath=${folderPath}, folder=${segment}`);
    }

    folder = folders.next();

    if (folders.hasNext()) {
      throw new Error(`Duplicate folder name. folderPath=${folderPath}, folder=${segment}`);
    }
  });

  return folder;
}
