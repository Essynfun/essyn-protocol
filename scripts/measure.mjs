// npm run measure -> measures dist/ at 360/390/430/1366/1440, absent branch and a stated-contract branch.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from './lib/serve.mjs';
import { build } from './build.mjs';
import { loadRegistry, byId } from './lib/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const addr = () => { for (;;) { let n = BigInt('0x' + crypto.randomBytes(32).toString('hex')), s = ''; while (n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; } if (s.length >= 43) return s; } };

const tmp = path.join(root, '.tmp-gates', 'measure'); fs.mkdirSync(tmp, { recursive: true });
const reg = loadRegistry(path.join(root, 'src/data/registry.json'));
const sreg = JSON.parse(JSON.stringify(reg));
Object.assign(byId(sreg, 'ca'), { state: 'stated', value: addr(), source: 'client statement', scope: 'batch-level', statedAt: '2026-10-10' }); delete byId(sreg, 'ca').asOf;
fs.writeFileSync(path.join(tmp, 'r.json'), JSON.stringify(sreg));
await build({ registryFile: path.join(tmp, 'r.json'), dist: path.join(tmp, 'dist'), skipAssetsFrom: path.join(root, 'dist') });

const probe = () => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
  const vw = innerWidth, out = { vw, scrollW: document.documentElement.scrollWidth };
  out.hScroll = out.scrollW > vw;
  out.header = r(document.querySelector('.hdr')); out.top = r(document.querySelector('.top'));
  out.social = ['x', 'github'].map((id) => { const e = document.querySelector(`[data-record="${id}"]`); const b = r(e); const s = getComputedStyle(e); return { id, ...b, visible: s.display !== 'none' && s.visibility !== 'hidden', rightGap: Math.round(vw - (b.x + b.w)), tag: e.tagName.toLowerCase(), href: e.getAttribute('href') }; });
  const ca = document.querySelector('#ca'), cv = ca.querySelector('.ca-value');
  out.ca = { ...r(ca), valueFont: getComputedStyle(cv).fontSize, valueText: cv.textContent.trim().length, valueBox: r(cv), fullyVisible: r(ca).y >= 0 && r(ca).y + r(ca).h <= innerHeight, textClipped: cv.scrollWidth > cv.clientWidth + 1 };
  const small = [];
  const sel = 'a[href], button, [role="tab"], .icon-btn';
  document.querySelectorAll(sel).forEach((e) => { if (e.classList.contains('skip')) return; const b = e.getBoundingClientRect(); const s = getComputedStyle(e); if (s.display === 'none' || b.width === 0) return; if (b.width < 43.5 || b.height < 43.5) small.push(`${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]} "${(e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24)}" ${Math.round(b.width)}x${Math.round(b.height)}`); });
  out.smallTargets = small;
  const h1 = document.querySelector('h1'); out.h1 = { ...r(h1), font: getComputedStyle(h1).fontSize, lh: getComputedStyle(h1).lineHeight, ls: getComputedStyle(h1).letterSpacing };
  out.card = r(document.querySelector('.id-card'));
  out.container = r(document.querySelector('.hero-in'));
  out.h2 = getComputedStyle(document.querySelector('.h2')).fontSize;
  out.h3 = getComputedStyle(document.querySelector('.sec-head h3')).fontSize;
  out.stage = r(document.querySelector('.stage-frame'));
  out.tabs = [...document.querySelectorAll('.tab')].map((e) => r(e).h);
  out.docH = document.documentElement.scrollHeight;
  out.overflowing = [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.right > vw + 1 && !e.closest('.tbl-wrap, .tablist, .blobs, .id-card, .band, .mq-viewport, .mesh'); }).slice(0, 5).map((e) => e.tagName + '.' + e.className);
  return out;
};

// deterministic stand-in for the pricing api so layout is measured with a populated table
const mkRec = byId(reg, 'market'); const apiHost = new URL(mkRec.url).hostname;
const fakeToks = Array.from({ length: 12 }, (_, i) => ({ a: addr(), s: 'TK' + i, v: (i + 3) * 123456 }));
const route = async (ctx) => {
  await ctx.route(`https://${mkRec.imageHost}/**`, (r) => r.abort());
  await ctx.route(`https://${apiHost}/**`, (r) => { const u = new URL(r.request().url()); if (u.pathname === '/token-boosts/top/v1') return r.fulfill({ json: fakeToks.map((t) => ({ chainId: 'solana', tokenAddress: t.a })) }); const asked = decodeURIComponent(u.pathname.split('/').pop()).split(','); return r.fulfill({ json: asked.map((a) => { const t = fakeToks.find((x) => x.a === a); return { chainId: 'solana', baseToken: { address: a, symbol: t.s, name: 'Token ' + t.s }, priceUsd: '0.0123', priceChange: { h24: 12.3 }, volume: { h24: t.v }, liquidity: { usd: 99999 }, info: { imageUrl: `https://${mkRec.imageHost}/x.png` } }; }) }); });
};
const { srv: s1, url: u1 } = await serve(path.join(root, 'dist'));
const { srv: s2, url: u2 } = await serve(path.join(tmp, 'dist'));
const browser = await chromium.launch({ executablePath: EDGE });
const report = {};
for (const [branch, url] of [['absent', u1], ['stated', u2]]) for (const w of [360, 390, 430, 1366, 1440]) {
  const bctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 800 : 900 } }); await route(bctx);
  const page = await bctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1800);
  const m = await page.evaluate(probe);
  await page.evaluate(() => scrollTo(0, 1500)); await page.waitForTimeout(300);
  m.stickyAfterScroll = await page.evaluate(() => { const c = document.querySelector('#ca').getBoundingClientRect(), s = [...document.querySelectorAll('.icon-btn')].map((e) => e.getBoundingClientRect()); return { caTop: Math.round(c.top), caInView: c.top >= 0 && c.bottom <= innerHeight, socialsInView: s.every((b) => b.top >= 0 && b.bottom <= 90) }; });
  report[`${branch}@${w}`] = m;
  if (branch === 'stated' && w === 360) await page.screenshot({ path: path.join(root, 'reports/shots/stated-360.png') });
  if (branch === 'absent') await page.screenshot({ path: path.join(root, 'reports/shots/absent-' + w + '.png') });
  await bctx.close();
}
await browser.close(); s1.close(); s2.close(); fs.rmSync(path.join(root, '.tmp-gates'), { recursive: true, force: true });
fs.writeFileSync(path.join(root, 'reports/measure.json'), JSON.stringify(report, null, 2));

let bad = 0;
console.log('branch@width | hScroll | header | social x/gh (w x h, rightGap) | CA h / font | h1 | card | stage | small targets | sticky');
for (const [k, m] of Object.entries(report)) {
  const probs = [];
  if (m.hScroll) probs.push('H-SCROLL'); if (m.smallTargets.length) probs.push('SMALL'); if (m.social.some((s) => !s.visible || s.w < 44 || s.h < 44)) probs.push('SOCIAL');
  if (!m.stickyAfterScroll.caInView || !m.stickyAfterScroll.socialsInView) probs.push('NOT-STICKY'); if (m.ca.textClipped) probs.push('CA-CLIPPED'); if (m.overflowing.length) probs.push('OVERFLOW ' + m.overflowing.join(','));
  if (probs.length) bad++;
  console.log(`${k} | ${m.hScroll} | ${m.header.h} | ${m.social.map((s) => `${s.w}x${s.h}/${s.rightGap}`).join(' ')} | ${m.ca.h}/${m.ca.valueFont} | ${m.h1.font}/${m.h1.h} | ${m.card.w}x${m.card.h} | ${m.stage.w}x${m.stage.h} | ${m.smallTargets.length} | ${JSON.stringify(m.stickyAfterScroll)} ${probs.length ? '<-- ' + probs.join(' ') : ''}`);
  if (m.smallTargets.length) console.log('    ', m.smallTargets.join('; '));
}
process.exit(bad ? 1 : 0);
