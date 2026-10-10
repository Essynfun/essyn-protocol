// npm run build  ->  dist/  (this folder is what gets dragged to Cloudflare)
// Env overrides, used by the gate harness only: ESSYN_REGISTRY, ESSYN_DIST.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, validate, byId, marketLive } from './lib/registry.mjs';
import { render } from './render.mjs';
import { buildAssets } from './assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readTokens(file = path.join(root, 'src/css/tokens.css')) {
  const css = fs.readFileSync(file, 'utf8');
  const t = {};
  for (const m of css.matchAll(/--c-([a-z]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) t[m[1]] = m[2].toLowerCase();
  return t;
}

export async function build({ registryFile, dist, skipAssetsFrom } = {}) {
  registryFile ||= process.env.ESSYN_REGISTRY || path.join(root, 'src/data/registry.json');
  dist ||= process.env.ESSYN_DIST || path.join(root, 'dist');
  const reg = loadRegistry(registryFile);
  const errors = validate(reg);
  if (errors.length) throw new Error('registry invalid:\n  ' + errors.join('\n  '));

  fs.rmSync(dist, { recursive: true, force: true });
  for (const d of ['assets/css', 'assets/js', 'assets/fonts', 'assets/img']) fs.mkdirSync(path.join(dist, d), { recursive: true });

  fs.writeFileSync(path.join(dist, 'index.html'), render(reg));
  for (const f of ['tokens.css', 'site.css']) fs.copyFileSync(path.join(root, 'src/css', f), path.join(dist, 'assets/css', f));
  for (const f of marketLive(reg) ? ['app.js', 'fx.js', 'card.js', 'market.js'] : ['app.js', 'fx.js', 'card.js']) fs.copyFileSync(path.join(root, 'src/js', f), path.join(dist, 'assets/js', f));

  const fonts = path.join(root, 'node_modules/@fontsource-variable');
  fs.copyFileSync(path.join(fonts, 'montserrat/files/montserrat-latin-wght-normal.woff2'), path.join(dist, 'assets/fonts/montserrat.woff2'));
  fs.copyFileSync(path.join(fonts, 'jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2'), path.join(dist, 'assets/fonts/jetbrains-mono.woff2'));

  let report;
  if (skipAssetsFrom) { // gate harness only: reuse rasters from a finished build
    for (const f of ['favicon.svg', 'apple-touch-icon.png', 'og.png']) fs.copyFileSync(path.join(skipAssetsFrom, f), path.join(dist, f));
    for (const f of fs.readdirSync(path.join(skipAssetsFrom, 'assets/img'))) fs.copyFileSync(path.join(skipAssetsFrom, 'assets/img', f), path.join(dist, 'assets/img', f));
    report = { reused: true };
  } else {
    const cwd = process.cwd(); process.chdir(root);
    try { report = await buildAssets({ dist, tokens: readTokens() }); } finally { process.chdir(cwd); }
  }

  const rpcOrigin = new URL(byId(reg, 'network').rpc).origin;
  const mk = byId(reg, 'market');
  const mkConnect = marketLive(reg) ? ` ${new URL(mk.url).origin}` : '';
  const mkImg = marketLive(reg) ? ` https://${mk.imageHost}` : '';
  fs.writeFileSync(path.join(dist, '_headers'), `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:${mkImg}; font-src 'self'; connect-src ${rpcOrigin}${mkConnect}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`);
  fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  return { dist, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().then(({ dist, report }) => {
    console.log('built ->', path.relative(root, dist) || dist);
    console.log('assets:', JSON.stringify(report));
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
