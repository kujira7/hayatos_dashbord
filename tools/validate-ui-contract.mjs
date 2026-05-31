import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(repoDir, 'app');
const read = (fileName) => fs.readFileSync(path.join(appDir, fileName), 'utf8');

const indexHtml = read('index.html');
const stylesHtml = read('styles.html');
const scriptsHtml = fs.readdirSync(appDir)
  .filter((fileName) => fileName === 'scripts.html' || /^scripts_.*\.html$/.test(fileName))
  .sort()
  .map(read)
  .join('\n');

const failures = [];

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function hasId(id) {
  return new RegExp(`id=["']${id}["']`).test(indexHtml);
}

function hasClass(className) {
  return new RegExp(`class=["'][^"']*\\b${className}\\b`).test(indexHtml);
}

function hasDataAttribute(attributeName) {
  return new RegExp(`${attributeName}=["']`).test(indexHtml);
}

assert(indexHtml.includes("<?!= include('styles'); ?>"), "index.html must include styles.html through include('styles').");
assert(indexHtml.includes("<?!= include('scripts'); ?>"), "index.html must include scripts.html through include('scripts').");
assert(!indexHtml.includes('<script type="module">'), 'index.html must not inline the module script.');
assert(!indexHtml.includes('duckdb-wasm'), 'index.html must not import DuckDB directly.');
assert(!/\sstyle=/.test(indexHtml), 'index.html must not contain inline style attributes.');
assert(stylesHtml.includes('.correlation-table-wrap'), 'styles.html must define .correlation-table-wrap.');

[
  'load-button',
  'refresh-button',
  'live-filter',
  'page-size-select',
  'tbody',
  'list-view',
  'bi-view',
  'bi-list-button',
  'correlation-templates',
  'run-correlation',
  'x-metric',
  'y-metric',
  'color-metric',
  'plot-mode',
  'bi-filter',
  'published-year-filter',
  'published-hour-filter',
  'bi-keyword',
  'duration-start',
  'duration-end',
  'duration-start-label',
  'duration-end-label',
  'clear-duration-filter',
  'published-date-start',
  'published-date-end',
  'published-date-start-label',
  'published-date-end-label',
  'clear-published-date-filter',
  'correlation-top-videos',
  'correlation-canvas',
  'correlation-tooltip'
].forEach((id) => {
  assert(hasId(id), `index.html is missing #${id}.`);
});

[
  'page-info',
  'view-hidden',
  'correlation-table-wrap'
].forEach((className) => {
  assert(hasClass(className), `index.html is missing .${className}.`);
});

[
  'data-page-action',
  'data-filter',
  'data-view',
  'data-sort-key'
].forEach((attributeName) => {
  if (scriptsHtml.includes(`[${attributeName}]`) || scriptsHtml.includes(`.${attributeName}`)) {
    assert(hasDataAttribute(attributeName), `index.html is missing ${attributeName}.`);
  }
});

if (failures.length > 0) {
  failures.forEach((failure) => {
    console.error(`ERROR: ${failure}`);
  });
  process.exit(1);
}

console.log('UI contract OK.');
