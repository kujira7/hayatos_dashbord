const DRIVE_ROOT_FOLDER_ID = '1BMLDFq1tZ7Jj69Pf0FMks80JTRTtC9S1';
const DEFAULT_PARQUET_PATH = 'hayato_live_poc.parquet';
const MAX_PARQUET_BYTES = 20 * 1024 * 1024;

function doGet() {
  return HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle('DuckDB-Wasm GAS PoC')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Drive上のParquetをDuckDB-Wasmへ渡すため、base64文字列として返す。
 * PoC用: google.script.runのペイロード肥大化を避けるため小さいファイルだけ許可する。
 */
function getDriveParquetFile() {
  const file = findFileByPath(DRIVE_ROOT_FOLDER_ID, DEFAULT_PARQUET_PATH);
  const size = file.getSize();

  if (size > MAX_PARQUET_BYTES) {
    throw new Error(`Parquet is too large for this PoC. size=${size}, max=${MAX_PARQUET_BYTES}`);
  }

  const blob = file.getBlob();

  return {
    path: DEFAULT_PARQUET_PATH,
    id: file.getId(),
    name: file.getName(),
    mimeType: blob.getContentType(),
    size,
    base64: Utilities.base64Encode(blob.getBytes())
  };
}

function findFileByPath(rootFolderId, normalizedPath) {
  const segments = normalizedPath.split('/');
  const fileName = segments.pop();
  let folder = DriveApp.getFolderById(rootFolderId);

  segments.forEach((segment) => {
    folder = getOnlyFolderByName(folder, segment, normalizedPath);
  });

  return getOnlyFileByName(folder, fileName, normalizedPath);
}

function getOnlyFolderByName(parentFolder, name, originalPath) {
  const folders = parentFolder.getFoldersByName(name);

  if (!folders.hasNext()) {
    throw new Error(`Folder not found in Drive path. path=${originalPath}, folder=${name}`);
  }

  const folder = folders.next();

  if (folders.hasNext()) {
    throw new Error(`Duplicate folder name in Drive path. path=${originalPath}, folder=${name}`);
  }

  return folder;
}

function getOnlyFileByName(parentFolder, name, originalPath) {
  const files = parentFolder.getFilesByName(name);

  if (!files.hasNext()) {
    throw new Error(`Parquet file not found. path=${originalPath}`);
  }

  const file = files.next();

  if (files.hasNext()) {
    throw new Error(`Duplicate file name in Drive path. path=${originalPath}`);
  }

  return file;
}
