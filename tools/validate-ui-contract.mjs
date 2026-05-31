import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(repoDir, 'app');
const read = (fileName) => fs.readFileSync(path.join(appDir, fileName), 'utf8');
const scriptPartialOrder = [
  'scripts_state',
  'scripts_common',
  'scripts_cache',
  'scripts_data',
  'scripts_list',
  'scripts_bi_filters',
  'scripts_chart',
  'scripts_dataset',
  'scripts_events'
];

const indexHtml = read('index.html');
const codeGs = read('code.gs');
const stylesHtml = read('styles.html');
const scriptsManifestHtml = read('scripts.html');
const scriptPartials = new Map();
const scriptsHtml = [scriptsManifestHtml];

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

function extractScriptPartial(fileName) {
  const partialHtml = read(`${fileName}.html`);
  const match = partialHtml.match(/^<script type="application\/json" data-dashboard-script-partial>\n([\s\S]*)\n<\/script>\n?$/);

  assert(Boolean(match), `${fileName}.html must wrap JS in the script partial container.`);

  return match ? match[1] : '';
}

function buildExpandedModuleScript() {
  let expanded = scriptsManifestHtml;

  scriptPartialOrder.forEach((fileName) => {
    const body = extractScriptPartial(fileName);
    scriptPartials.set(fileName, body);
    scriptsHtml.push(body);
  });

  const includes = [...scriptsManifestHtml.matchAll(/<\?!= includeRaw\('([^']+)'\); \?>/g)]
    .map((match) => match[1]);
  assert(
    JSON.stringify(includes) === JSON.stringify(scriptPartialOrder),
    `scripts.html must include partials in order: ${scriptPartialOrder.join(', ')}.`
  );
  assert(!scriptsManifestHtml.includes("include('scripts_"), 'scripts.html must use includeRaw for script partials.');

  expanded = expanded.replace(
    /<\?!= includeRaw\('([^']+)'\); \?>/g,
    (_match, fileName) => scriptPartials.get(fileName) || ''
  );
  assert(!expanded.includes('<?!='), 'expanded scripts.html must not contain template directives.');

  const moduleSource = expanded
    .replace(/^  <script type="module">\n/, '')
    .replace(/\n  <\/script>\n?$/, '');
  assert(moduleSource !== expanded, 'scripts.html must be a module script wrapper.');

  return moduleSource;
}

function assertModuleSyntax(moduleSource) {
  const checkFile = path.join(os.tmpdir(), `hayatos-dashboard-${process.pid}.mjs`);
  fs.writeFileSync(checkFile, moduleSource);

  try {
    const result = spawnSync(process.execPath, ['--check', checkFile], { encoding: 'utf8' });
    assert(result.status === 0, `expanded module script syntax check failed: ${(result.stderr || result.stdout).trim()}`);
  } finally {
    fs.rmSync(checkFile, { force: true });
  }
}

const moduleSource = buildExpandedModuleScript();

assert(indexHtml.includes("<?!= include('styles'); ?>"), "index.html must include styles.html through include('styles').");
assert(indexHtml.includes("<?!= include('scripts'); ?>"), "index.html must include scripts.html through include('scripts').");
assert(!indexHtml.includes('<script type="module">'), 'index.html must not inline the module script.');
assert(!indexHtml.includes('duckdb-wasm'), 'index.html must not import DuckDB directly.');
assert(!/\sstyle=/.test(indexHtml), 'index.html must not contain inline style attributes.');
assert(stylesHtml.includes('.correlation-table-wrap'), 'styles.html must define .correlation-table-wrap.');
assert(!moduleSource.includes('&lt;=') && !moduleSource.includes('&lt; '), 'expanded module script must not contain escaped less-than operators.');
assert(!moduleSource.includes('&gt;=') && !moduleSource.includes(' &gt; '), 'expanded module script must not contain escaped greater-than operators.');
assert(!moduleSource.includes('[&&lt;'), 'expanded module script must not contain an escaped escapeHtml regex.');
assert(codeGs.includes("if (filename === 'scripts')"), "code.gs must route include('scripts') through the script loader.");
assert(codeGs.includes('Utilities.base64Encode'), 'code.gs must base64 encode the expanded module script.');
assert(codeGs.includes('getScriptPartialContent'), 'code.gs must extract script partial content before encoding.');
assertModuleSyntax(moduleSource);

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
  const scriptText = scriptsHtml.join('\n');

  if (scriptText.includes(`[${attributeName}]`) || scriptText.includes(`.${attributeName}`)) {
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
