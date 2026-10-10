// Quick loop while writing copy: npm run build && node scripts/copy-check.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCopy } from './lib/checks.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = checkCopy({ dist: path.join(root, 'dist'), fixture: path.join(root, 'scripts/fixtures/reference-grams.json') });
console.log(r.ok ? 'PASS' : 'FAIL', r.detail); process.exit(r.ok ? 0 : 1);
