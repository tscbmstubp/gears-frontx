// Post-build check for the dev-builds definition of done: both builds exist, the production
// bundles carry no dev-inspector code, the development bundles do, and the package's
// `development` export condition points at them. Production stays inspector-free only because
// tsup tree-shakes the inspector away; this check fails the build if that ever stops holding.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INSPECTOR_MARKERS = ['[telemetry:dev]', 'groupCollapsed'];
const failures = [];

function read(file) {
  const path = join(root, file);
  if (!existsSync(path)) {
    failures.push(`${file} is missing`);
    return '';
  }
  return readFileSync(path, 'utf8');
}

for (const file of ['dist/index.js', 'dist/index.cjs']) {
  const code = read(file);
  for (const marker of INSPECTOR_MARKERS) {
    if (code.includes(marker)) failures.push(`${file} (production) contains "${marker}"`);
  }
}

for (const file of ['dist/development/index.js', 'dist/development/index.cjs']) {
  const code = read(file);
  if (code && !code.includes('[telemetry:dev]')) {
    failures.push(`${file} (development) lacks "[telemetry:dev]"`);
  }
}

const development = JSON.parse(read('package.json')).exports?.['.']?.development;
if (development?.import !== './dist/development/index.js') {
  failures.push('package.json exports["."].development.import is not ./dist/development/index.js');
}
if (development?.require !== './dist/development/index.cjs') {
  failures.push('package.json exports["."].development.require is not ./dist/development/index.cjs');
}

if (failures.length > 0) {
  console.error(`check-builds: ${failures.length} problem(s):\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('check-builds: production and development builds are as expected.');
