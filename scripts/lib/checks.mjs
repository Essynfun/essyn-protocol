// Gate checks. Every check reads the built output (dist) and the register; none hard-codes state.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'node-html-parser';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { checkMarket } from './market-check.mjs';
import { loadRegistry, validate, byId, statedValues, isSolanaAddress, isEvmAddress, handleFromUrl } from './registry.mjs';

const TEXT_EXT = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.md', '.mjs', '.xml', '']);
export const walk = (dir, skip = () => false) => {
  const out = [];
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const p = path.join(dir, e.name);
    if (skip(p, e)) continue;
    if (e.isDirectory()) out.push(...walk(p, skip)); else out.push(p);
  }
  return out;
};
const rel = (root, p) => path.relative(root, p).replace(/\\/g, '/');
const readText = (p) => fs.readFileSync(p, 'utf8');
const isText = (p) => TEXT_EXT.has(path.extname(p).toLowerCase()) || path.basename(p) === '_headers';

const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const EVM_RUN = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const ok = (id, rule, pass, detail = '') => ({ id, rule, ok: !!pass, detail });

/* ---------- Rule 3: address scanner (never a blanket 0x reject; match against the stated register) ---------- */
export function scanAddresses(text, reg) {
  const stated = statedValues(reg);
  const found = [];
  for (const m of text.matchAll(BASE58_RUN)) if (isSolanaAddress(m[0])) found.push({ kind: 'solana', value: m[0] });
  for (const m of text.matchAll(EVM_RUN)) if (isEvmAddress(m[0])) found.push({ kind: 'evm', value: m[0] });
  return found.map((f) => ({ ...f, registered: stated.has(f.value) }));
}
// The contract slot is exempt from the scanner: its elements are stripped before scanning.
export function stripExempt(html) {
  const root = parse(html, { comment: false });
  root.querySelectorAll('[data-ca-exempt]').forEach((n) => n.remove());
  return root.toString();
}

/* ---------- Rule 3 on a dist folder ---------- */
export function checkAddresses({ dist, reg }) {
  const bad = [];
  for (const f of walk(dist)) {
    if (!isText(f)) continue;
    let t = readText(f);
    if (f.endsWith('.html')) t = stripExempt(t);
    for (const a of scanAddresses(t, reg)) if (!a.registered) bad.push(`${path.basename(f)}: unregistered ${a.kind} address ${a.value}`);
  }
  return ok('address-scan', 3, bad.length === 0, bad.join('; ') || 'every address-shaped string is in the stated register (or inside the exempt contract slot)');
}

/* ---------- Rules 1 + 2: register and link rule on rendered DOM ---------- */
export function checkRegisterDom({ dist, reg }) {
  const html = parse(readText(path.join(dist, 'index.html')));
  const errs = [];
  const INERT_ATTRS = ['href', 'value', 'data-value', 'src', 'data-url', 'data-href'];
  for (const el of html.querySelectorAll('[data-record]')) {
    const id = el.getAttribute('data-record'); const rec = byId(reg, id);
    if (!rec) { errs.push(`unknown record ${id}`); continue; }
    if (el.getAttribute('data-state') !== rec.state) errs.push(`${id}: dom state ${el.getAttribute('data-state')} != register ${rec.state}`);
    if (rec.state !== 'stated') {
      for (const a of INERT_ATTRS) if (el.hasAttribute(a)) errs.push(`${id}: inert element carries ${a}`);
      if (el.getAttribute('data-asof') !== rec.asOf) errs.push(`${id}: inert element missing its date`);
      if (el.querySelector('a[href]')) errs.push(`${id}: inert element wraps a link`);
    }
  }
  // social links: always both, always top-right inside the header, href only for stated records, handle derived
  const social = html.querySelector('header .social');
  for (const [id, name] of [['x', 'X'], ['github', 'GitHub']]) {
    const els = html.querySelectorAll(`[data-record="${id}"]`);
    const rec = byId(reg, id);
    if (els.length !== 1) { errs.push(`${id}: expected exactly one icon, found ${els.length}`); continue; }
    if (!social || !social.querySelector(`[data-record="${id}"]`)) errs.push(`${id}: icon is not inside header .social`);
    const el = els[0];
    if (!el.querySelector('svg')) errs.push(`${id}: icon has no svg`);
    if (el.text.trim()) errs.push(`${id}: icon must carry no text label`);
    if (rec.state === 'stated') {
      if (el.tagName !== 'A' || el.getAttribute('href') !== rec.url) errs.push(`${id}: stated icon href must equal register url`);
      if (!(el.getAttribute('aria-label') || '').includes('@' + handleFromUrl(rec.url))) errs.push(`${id}: aria-label must carry the derived handle`);
    } else if (el.tagName === 'A') errs.push(`${id}: inert icon rendered as a link`);
  }
  // contract slot
  const ca = byId(reg, 'ca'); const slot = html.querySelector('#ca');
  if (!slot) errs.push('ca: slot missing');
  else if (ca.state === 'stated') {
    const v = slot.querySelector('#ca-value'); const btn = slot.querySelector('#ca-copy');
    if (!v || v.text.trim() !== ca.value) errs.push('ca: slot must show the full address exactly');
    if (!btn || btn.hasAttribute('disabled')) errs.push('ca: copy control must be live when stated');
  } else {
    if (slot.querySelector('#ca-copy')) errs.push('ca: inert slot must not carry a live copy control');
    if (!slot.querySelector('button[disabled]')) errs.push('ca: inert slot must show a disabled control');
    if (scanAddresses(slot.toString(), reg).length) errs.push('ca: inert slot contains an address');
  }
  return ok('register-dom', '1,2', errs.length === 0, errs.join('; ') || 'records, states, dates, social links and contract slot agree with the register');
}

export function checkLinks({ dist, reg }) {
  const errs = []; const stated = statedValues(reg);
  const ids = new Set();
  const html = parse(readText(path.join(dist, 'index.html')));
  html.querySelectorAll('[id]').forEach((n) => ids.add(n.getAttribute('id')));
  for (const a of html.querySelectorAll('a')) {
    const h = a.getAttribute('href');
    if (h === undefined) continue;
    if (h.startsWith('#')) { if (h.length < 2 || !ids.has(h.slice(1))) errs.push(`dead fragment ${h}`); continue; }
    if (!stated.has(h)) errs.push(`href ${h} is not a stated record url`);
  }
  const site = byId(reg, 'site').url.replace(/\/$/, '');
  for (const f of walk(dist)) {
    if (!isText(f)) continue;
    for (const m of readText(f).matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
      const u = m[0].replace(/[.,;]+$/, '');
      if (u.startsWith('http://www.w3.org/')) continue;
      if (u === site || u.startsWith(site + '/')) continue;
      if (stated.has(u) || [...stated].some((s) => u === s || u.startsWith(s + '/'))) continue;
      if (u.startsWith(new URL(byId(reg, 'network').rpc).origin)) continue;
      errs.push(`${path.basename(f)}: external url ${u} not in register`);
    }
  }
  return ok('link-rule', 2, errs.length === 0, errs.join('; ') || 'no href without a stated record; every url traces to the register');
}

/* ---------- Rule 4: palette ---------- */
export function checkPalette({ root, dist, tokensFile }) {
  const errs = [];
  const tokensCss = readText(tokensFile);
  const tokens = [...tokensCss.matchAll(/(--c-[a-z]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]);
  const pal = JSON.parse(readText(path.join(root, 'scripts/palette.json')));
  if (tokens.length !== pal.length) errs.push(`tokens (${tokens.length}) and palette.json (${pal.length}) differ`);
  const cache = {};
  for (const p of pal) {
    const t = tokens.find((x) => x[0] === p.token);
    if (!t || t[1] !== p.hex) { errs.push(`${p.token}: token does not match palette.json`); continue; }
    const file = path.join(root, p.file);
    if (!cache[file]) { const b = fs.readFileSync(file); cache[file] = file.toLowerCase().endsWith('.png') ? PNG.sync.read(b) : jpeg.decode(b, { useTArray: true, formatAsRGBA: true }); }
    const img = cache[file]; const i = (p.y * img.width + p.x) * 4;
    const got = '#' + [img.data[i], img.data[i + 1], img.data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    if (got !== p.hex) errs.push(`${p.token} ${p.hex} is not the pixel at ${p.file} (${p.x},${p.y}); found ${got}`);
  }
  const allowed = new Set(tokens.map((t) => t[1]));
  const LIT = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;
  const scanDirs = [path.join(root, 'src'), dist, path.join(root, 'scripts')];
  for (const dir of scanDirs) for (const f of walk(dir)) {
    const r = rel(root, f);
    if (!isText(f) || r.endsWith('tokens.css') || r.startsWith('scripts/lib/') || r.startsWith('scripts/fixtures') || r === 'scripts/palette.json' || r.startsWith('scripts/analyze') || r.startsWith('scripts/gates') || r.startsWith('scripts/measure') || r === 'scripts/assets.mjs' || r === 'scripts/build.mjs') continue;
    let t = readText(f);
    t = t.replace(/(["'=(])#[a-z][a-z0-9_-]*(["')])/gi, '$1$2'); // fragment ids such as href="#how"
    t = t.replace(/&#\d+;|&#x[0-9a-f]+;/gi, '');
    const hits = t.match(LIT);
    if (!hits) continue;
    if (f.endsWith('favicon.svg')) { for (const h of hits) if (!allowed.has(h.toLowerCase())) errs.push(`favicon.svg colour ${h} is not a token`); continue; }
    errs.push(`${r}: colour literal ${[...new Set(hits)].slice(0, 3).join(' ')} outside tokens.css`);
  }
  return ok('palette', 4, errs.length === 0, errs.join('; ') || `${tokens.length} tokens, each equal to a real pixel; no other colour literal anywhere`);
}

/* ---------- Rule 5: repo hygiene ---------- */
export function checkHygiene({ root }) {
  const errs = [];
  const skip = (p, e) => e.isDirectory() && ['node_modules', '.git', '.tmp-gates'].includes(e.name);
  const files = walk(root, skip);
  for (const f of files) if (/(^|[\\/])\.claude([\\/]|$)/i.test(rel(root, f)) || /^claude\.md$/i.test(path.basename(f))) errs.push(`forbidden file ${rel(root, f)}`);
  for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.name.toLowerCase() === '.claude' || e.name.toLowerCase() === 'claude.md') errs.push(`forbidden ${e.name}`);
  const pat = new RegExp([['cla', 'ude'], ['anthr', 'opic'], ['\\bA', 'I\\b'], ['gener', 'ated (?:by|with)'], ['co-auth', 'ored-by'], ['\\bL', 'LM\\b'], ['chat', 'gpt']].map((p) => p.join('')).join('|'), 'i');
  for (const f of files) {
    const r = rel(root, f);
    if (!isText(f) || r === 'package-lock.json' || r.startsWith('reports/') || r === 'scripts/lib/checks.mjs') continue;
    const m = readText(f).match(pat);
    if (m) errs.push(`${r}: mentions "${m[0]}"`);
  }
  return ok('repo-hygiene', 5, errs.length === 0, errs.join('; ') || 'no CLAUDE.md, no .claude, no tooling attribution anywhere');
}

/* ---------- dist contents ---------- */
export function checkDist({ dist, reg }) {
  const errs = [];
  for (const f of ['index.html', 'favicon.svg', 'og.png', 'apple-touch-icon.png', '_headers', 'assets/css/tokens.css', 'assets/css/site.css', 'assets/js/app.js', 'assets/img/logo-64.png', 'assets/img/logo-128.png', 'assets/img/logo-512.png', 'assets/fonts/montserrat.woff2']) if (!fs.existsSync(path.join(dist, f))) errs.push(`missing dist/${f}`);
  for (const f of walk(dist)) { const b = path.basename(f).toLowerCase(); if (['readme.md', 'license', 'whitepaper.md'].includes(b) || f.includes(`${path.sep}docs${path.sep}`)) errs.push(`repo file leaked into dist: ${b}`); }
  const fav = fs.existsSync(path.join(dist, 'favicon.svg')) ? readText(path.join(dist, 'favicon.svg')) : '';
  if (!/width="32"/.test(fav) || !/height="32"/.test(fav) || !/viewBox="0 0 32 32"/.test(fav)) errs.push('favicon must be 32x32');
  if (fav.includes('--')) errs.push('favicon contains a double hyphen');
  if (/<!--/.test(fav)) errs.push('favicon contains an XML comment');
  if (!/<path[^>]* d="M/.test(fav)) errs.push('favicon has no traced path');
  const idx = fs.existsSync(path.join(dist, 'index.html')) ? readText(path.join(dist, 'index.html')) : '';
  if (/\sstyle=/.test(idx)) errs.push('inline style attribute in html (CSP forbids it)');
  const css = fs.existsSync(path.join(dist, 'assets/css/site.css')) ? readText(path.join(dist, 'assets/css/site.css')) : '';
  if (/(?:^|[^a-zA-Z0-9-])\d*\.?\d+ch\b/.test(css)) errs.push('ch unit used in css');
  if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css)) errs.push('no prefers-reduced-motion rule');
  const headers = fs.existsSync(path.join(dist, '_headers')) ? readText(path.join(dist, '_headers')) : '';
  if (!headers.includes(new URL(byId(reg, 'network').rpc).origin)) errs.push('CSP connect-src does not name the stated rpc');
  return ok('dist-contents', '-', errs.length === 0, errs.join('; ') || 'required files present, no repo files in dist, favicon 32x32 with no double hyphen, no ch units, reduced-motion rule present');
}

/* ---------- copy: zero shared words / 2-grams with the reference ---------- */
const STOP = new Set('a an the and or but if so as at by for from in into of off on onto out over per than that this those these to up via with without it its is are was were be been being am do does did has have had not no nor you your yours we our us they their them he she his her i me my can will would should could may might shall just only also very too more most any each both all some such what when where which who whom how why then there here about above after again against around before below between during under until while now one two three'.split(' '));
const h10 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
export const tokenize = (s) => s.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);
export function visibleCopy(html) {
  const root = parse(html, { comment: false });
  root.querySelectorAll('script,style,svg').forEach((n) => n.remove());
  const BREAK = ' ' + String.fromCharCode(10) + ' ';
  const INLINE = new Set(['SPAN', 'A', 'EM', 'B', 'STRONG', 'TIME', 'CODE', 'I']);
  const spaced = (n) => (n.nodeType === 3 ? n.text : (n.childNodes || []).map(spaced).join(INLINE.has(n.tagName) ? ' ' : BREAK));
  const parts = [spaced(root.querySelector('body') || root)];
  for (const n of root.querySelectorAll('[aria-label],[title],[alt]')) parts.push(n.getAttribute('aria-label') || '', n.getAttribute('title') || '', n.getAttribute('alt') || '');
  const head = parse(html);
  parts.push(head.querySelector('title')?.text || '');
  for (const m of head.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"]')) parts.push(m.getAttribute('content') || '');
  return parts.join(' \n ');
}
// Unavoidable functional tokens: digits, the SOL unit, the X platform name, and the .fun domain suffix of our own domain.
const FUNCTIONAL = new Set(['x', 'sol', 'fun']);
export function checkCopy({ dist, fixture }) {
  const fx = JSON.parse(readText(fixture));
  const uni = new Set(fx.unigrams), bi = new Set(fx.bigrams);
  const html = readText(path.join(dist, 'index.html'));
  // sentences are separate runs so a 2-gram never spans two blocks
  const runs = visibleCopy(html).split(/\n|[.!?;:]\s/);
  const sharedBi = new Set(), sharedUni = new Set();
  for (const run of runs) {
    const t = tokenize(run);
    t.forEach((w, i) => {
      if (!STOP.has(w) && !FUNCTIONAL.has(w) && !/^[0-9]+$/.test(w) && uni.has(h10(w))) sharedUni.add(w);
      if (i + 1 < t.length && bi.has(h10(w + ' ' + t[i + 1]))) sharedBi.add(w + ' ' + t[i + 1]);
    });
  }
  const errs = [];
  if (sharedBi.size) errs.push(`shared 2-grams: ${[...sharedBi].join(' | ')}`);
  if (sharedUni.size) errs.push(`shared words: ${[...sharedUni].join(', ')}`);
  return ok('copy-original', '-', errs.length === 0, errs.join('; ') || 'no shared 2-gram and no shared content word with the reference (function words exempt)');
}

/* ---------- no visible dates (the register keeps data-asof as invisible metadata) ---------- */
export function checkNoDates({ dist }) {
  const html = readText(path.join(dist, 'index.html'));
  const text = visibleCopy(html) + ' ' + [...html.matchAll(/<time\b/g)].map(() => '<time>').join(' ');
  const hits = text.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b|<time>|\b(?:as of|checked)\b/gi);
  const js = ['app.js', 'market.js', 'fx.js', 'card.js'].map((f) => path.join(dist, 'assets/js', f)).filter((f) => fs.existsSync(f)).map(readText).join(' ');
  const jsHit = /toLocale(?:Date|Time)String|toDateString|getFullYear/.test(js);
  return ok('no-visible-dates', '-', !hits && !jsHit, hits ? 'visible date text: ' + [...new Set(hits)].join(', ') : jsHit ? 'script formats a date for display' : 'no date string is visible anywhere on the page or produced by scripts');
}

/* ---------- aggregate ---------- */
export function runDistChecks({ root, dist, registryFile, skipCopy = false }) {
  const reg = loadRegistry(registryFile);
  const out = [];
  const errs = validate(reg);
  out.push(ok('register-valid', 1, errs.length === 0, errs.join('; ') || `${reg.records.length} records valid`));
  out.push(checkRegisterDom({ dist, reg }));
  out.push(checkLinks({ dist, reg }));
  out.push(checkAddresses({ dist, reg }));
  out.push(checkPalette({ root, dist, tokensFile: path.join(root, 'src/css/tokens.css') }));
  out.push(checkDist({ dist, reg }));
  out.push(checkMarket({ dist, reg }));
  out.push(checkNoDates({ dist }));
  if (!skipCopy) out.push(checkCopy({ dist, fixture: path.join(root, 'scripts/fixtures/reference-grams.json') }));
  return out;
}
