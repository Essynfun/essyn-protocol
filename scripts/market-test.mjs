// Browser proof of the market module against a mocked DEX api (fresh random addresses, nothing hard-coded).
// The contract stays ABSENT throughout the live tests: the feed must not depend on it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { serve } from './lib/serve.mjs';
import { build } from './build.mjs';
import { byId } from './lib/registry.mjs';

const EDGE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const addr = () => { for (;;) { let n = BigInt('0x' + crypto.randomBytes(32).toString('hex')), s = ''; while (n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; } if (s.length >= 43) return s; } };
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const DASH = String.fromCharCode(0x2014);

export async function runMarketTests({ realDist, tmp, realReg, record }) {
  const reg = JSON.parse(JSON.stringify(realReg));
  const caState = byId(reg, 'ca').state; // whatever it is today; never mutated here
  const mk = byId(reg, 'market'); const apiHost = new URL(mk.url).hostname;
  const dir = path.join(tmp, 'market-live'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'r.json'), JSON.stringify(reg));
  await build({ registryFile: path.join(dir, 'r.json'), dist: path.join(dir, 'dist'), skipAssetsFrom: realDist });

  // mock universe: 14 solana boosts (+2 duplicates), 3 other-chain boosts; two pairs per token, the shallow one carries a decoy volume
  const toks = Array.from({ length: 14 }, (_, i) => ({ a: addr(), sym: 'T' + String.fromCharCode(65 + i), vol: (i + 1) * 10000 }));
  const other = Array.from({ length: 3 }, () => addr());
  const boosts = [...toks.map((t) => ({ chainId: 'solana', tokenAddress: t.a })), { chainId: 'solana', tokenAddress: toks[0].a }, { chainId: 'solana', tokenAddress: toks[1].a }, ...other.map((a) => ({ chainId: 'ethereum', tokenAddress: a }))];
  let scale = 1; // lets a test move the numbers between refreshes
  const pairsFor = (t, i) => [
    { chainId: 'solana', baseToken: { address: t.a, symbol: t.sym, name: 'Token ' + t.sym }, priceUsd: String((1.5 / (i + 1) / 1000) * scale), priceChange: { h24: i % 2 ? -12.34 : 45.6 }, volume: { h24: t.vol * scale }, txns: { h24: { buys: 100 * (i + 1), sells: 50 } }, liquidity: { usd: 500000 + i }, info: i === 13 ? {} : i === 12 ? { imageUrl: 'https://evil.example/x.png' } : { imageUrl: `https://${mk.imageHost}/${i}.png` } },
    { chainId: 'solana', baseToken: { address: t.a, symbol: t.sym, name: 'Token ' + t.sym }, priceUsd: '9', priceChange: { h24: 1 }, volume: { h24: 99999999 }, liquidity: { usd: 10 } },
  ];
  const expected = [...toks].sort((x, y) => y.vol - x.vol).slice(0, 10);
  const evil = [];
  const rpcUrl = new URL(byId(reg, 'network').rpc); let height = 300000000;
  const mock = async (ctx, delay = 0) => {
    await ctx.route(`${rpcUrl.origin}/**`, (r) => { height += 25; return r.fulfill({ json: { jsonrpc: '2.0', id: 1, result: height } }); });
    await ctx.route(`https://${mk.imageHost}/**`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1 }));
    await ctx.route('https://evil.example/**', (r) => { evil.push(1); return r.abort(); });
    await ctx.route(`https://${apiHost}/**`, async (r) => {
      const u = new URL(r.request().url()); if (delay) await wait(delay);
      if (u.pathname === '/token-boosts/top/v1') return r.fulfill({ json: boosts });
      if (u.pathname.startsWith('/tokens/v1/solana/')) {
        const asked = decodeURIComponent(u.pathname.split('/').pop()).split(',');
        if (asked.length > 30) return r.fulfill({ status: 400, json: {} });
        return r.fulfill({ json: asked.flatMap((a) => { const i = toks.findIndex((t) => t.a === a); return i < 0 ? [] : pairsFor(toks[i], i); }) });
      }
      return r.fulfill({ status: 404, json: {} });
    });
  };
  const { srv, url } = await serve(path.join(dir, 'dist'));
  const browser = await chromium.launch({ executablePath: EDGE });
  const g = 'market (browser)';
  try {
    // ---- success path (contract slot untouched)
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage(); await mock(ctx, 1800);
    await page.goto(url);
    await page.waitForSelector('#market-rows .skel', { timeout: 3000 });
    record(g, 'skeleton rows and skeleton marquee show first, status pill is loading', (await page.locator('#market-rows .skel').count()) >= 10 && (await page.locator('#mq-track .skel').count()) > 0 && (await page.getAttribute('#market-status', 'data-state')) === 'loading');
    await page.waitForSelector('#market-rows .mrow[data-state="live"]', { timeout: 25000 });
    await wait(1800);
    const rows = await page.$$eval('#market-rows .mrow', (trs) => trs.map((tr) => ({ sym: tr.querySelector('.tok-name strong') && tr.querySelector('.tok-name strong').textContent, addr: tr.querySelector('.addr-btn').getAttribute('data-address'), disabled: tr.querySelector('.addr-btn').disabled, tile: !!tr.querySelector('.tok-logo.tile'), tileText: tr.querySelector('.tok-logo.tile') && tr.querySelector('.tok-logo.tile').textContent, img: !!tr.querySelector('img.tok-logo'), cells: [...tr.children].slice(2, 6).map((c) => c.textContent.trim()) })));
    record(g, 'contract absent, feed still live: ten rows, solana only, ordered by 24h volume (deepest pair), skeletons gone', caState !== 'stated' && rows.length === 10 && rows.every((r, i) => r.sym === expected[i].sym && r.addr === expected[i].a && !r.disabled) && (await page.locator('#market-rows .skel').count()) === 0, JSON.stringify(rows.map((r) => r.sym)));
    record(g, 'contract slot stays inert while the feed is live', (await page.getAttribute('#ca', 'data-state')) === caState && (await page.locator('#ca button[disabled]').count()) === 1);
    record(g, 'count-up lands on the formatted figures: price, 24h change, volume, liquidity', rows.every((r) => /^\$/.test(r.cells[0]) && /^[▲▼]\s?[+\u2212]\d/.test(r.cells[1]) && /^\$[\d.]+[KMB]?$/.test(r.cells[2]) && /^\$[\d.]+[KMB]?$/.test(r.cells[3])), JSON.stringify(rows[0].cells));
    const tiles = rows.filter((r) => r.tile);
    record(g, 'letter tile when imageUrl is missing or off the stated image host', tiles.length === 2 && tiles.every((r) => /^T$/.test(r.tileText)) && rows.some((r) => r.img) && !evil.length, `tiles=${tiles.length} offhost-requests=${evil.length}`);
    const clones = await page.locator('#mq-track .mq-clone[aria-hidden="true"]').count();
    const syms = await page.locator('#mq-track .mq-item strong').allTextContents();
    record(g, 'marquee uses the same data, doubled for a seamless loop, clones hidden from assistive tech', syms.length === 20 && clones === 10 && syms.slice(0, 10).join() === expected.map((t) => t.sym).join());
    record(g, 'status pill turns live with a pulsing dot', (await page.getAttribute('#market-status', 'data-state')) === 'live' && (await page.evaluate(() => getComputedStyle(document.querySelector('#market-status .dot'), '::after').animationName)) === 'pulse-dot');
    await page.locator('#market-rows .addr-btn').nth(2).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    record(g, 'per-row button sends that token address to the clipboard, with feedback', clip === expected[2].a && (await page.locator('#market-rows .addr-btn.is-done').count()) === 1);
    const small = await page.$$eval('#market-rows .addr-btn', (bs) => bs.filter((b) => { const r = b.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; }).length);
    record(g, 'row buttons are 44x44', small === 0, JSON.stringify(await page.$$eval('#market-rows .addr-btn', (bs) => bs.slice(0, 3).map((b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }))));
    // spotlight: pointer over a row moves its light
    const row0 = page.locator('#market-rows .mrow').first(); const bb = await row0.boundingBox();
    await page.mouse.move(bb.x + 120, bb.y + 20); await wait(150);
    const keysTxt = await page.$$eval('#card-back .keys li', (ls) => ls.map((l) => ({ n: l.querySelector('.k-name') && l.querySelector('.k-name').textContent, p: l.querySelector('.k-price') && l.querySelector('.k-price').textContent, logo: !!l.querySelector('.tok-logo'), skel: !!l.querySelector('.skel') })));
    record(g, 'hero badge: top 3 movers from the shared feed (logo, name, price), contract absent', keysTxt.length === 3 && keysTxt.every((k, i) => k.n === expected[i].sym && /^\$/.test(k.p) && k.logo && !k.skel), JSON.stringify(keysTxt));
    const bars = await page.$$eval('#card-back .meters > div', (ds) => ds.map((d) => ({ w: parseFloat(getComputedStyle(d.querySelector('.meter b')).width) / d.querySelector('.meter').getBoundingClientRect().width, v: d.querySelector('.mv').textContent.trim() })));
    record(g, 'hero badge: four score bars filled from live market data, values counted up', bars.length === 4 && bars.every((b) => b.w > 0.05 && /^\d+$/.test(b.v) && Number(b.v) > 0), JSON.stringify(bars));
    const tenure1 = await page.locator('#tenure').textContent();
    record(g, 'hero badge: live block height from the stated rpc, no skeleton left', /^\d{1,3}(,\d{3})+$/.test(tenure1.trim()) && (await page.locator('#tenure .skel').count()) === 0, tenure1);
    record(g, 'spotlight follows the pointer over a row', (await row0.evaluate((e) => e.style.getPropertyValue('--sx'))) !== '');
    await ctx.close();

    // ---- value change on refresh: flash, no rebuild (fake clock jumps past the 60s refresh)
    const ctxF = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pf = await ctxF.newPage(); await mock(ctxF, 0); scale = 1;
    await pf.clock.install();
    await pf.goto(url); await pf.waitForSelector('#market-rows .mrow[data-state="live"]', { timeout: 25000 }); await wait(1500);
    await pf.evaluate(() => { window.__flash = 0; new MutationObserver((ms) => ms.forEach((m) => { if (m.target.classList && (m.target.classList.contains('flash-up') || m.target.classList.contains('flash-down'))) window.__flash++; })).observe(document.querySelector('#market-rows'), { subtree: true, attributes: true, attributeFilter: ['class'] }); });
    const domBefore = await pf.evaluate(() => document.querySelector('#market-rows .mrow .tok-logo') && document.querySelector('#market-rows .mrow .tok-logo').outerHTML.length);
    scale = 1.37;
    await pf.clock.runFor(61000); await wait(600);
    const flashes = await pf.evaluate(() => window.__flash);
    const tenure2 = (await pf.locator('#tenure').textContent()).replace(/,/g, '');
    record(g, 'block height keeps climbing between polls', Number(tenure2) > 300000000 && Number(tenure2) > 300000000 + 25, tenure2);
    record(g, 'a changed value flashes on refresh (and rows are updated in place)', flashes > 0 && domBefore > 0, `flash class applications=${flashes}`);
    await ctxF.close(); scale = 1;

    // ---- reduced motion: figures appear instantly, nothing flashes, no stagger delays
    const ctxR = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const pr = await ctxR.newPage(); await mock(ctxR, 0);
    await pr.goto(url); await pr.waitForSelector('#market-rows .mrow[data-state="live"]', { timeout: 25000 });
    const instant = await pr.$$eval('#market-rows .mrow', (trs) => trs.every((tr) => /^\$/.test(tr.children[2].textContent.trim()) && /^\$[\d.]+[KMB]?$/.test(tr.children[4].textContent.trim()) && !tr.querySelector('.flash-up,.flash-down')));
    const noAnim = await pr.evaluate(() => { const bad = []; document.querySelectorAll('*').forEach((e) => { const s = getComputedStyle(e); if (s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.01) bad.push(e.className + ':' + s.animationName); }); return bad.slice(0, 5); });
    record(g, 'prefers-reduced-motion: figures are instant and every animation collapses', instant && noAnim.length === 0, JSON.stringify(noAnim));
    await ctxR.close();

    // ---- failure path on a fake clock: abort everything, count attempts at each backoff step
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const p2 = await ctx2.newPage(); const times = [];
    await p2.clock.install();
    await ctx2.route(`https://${apiHost}/**`, (r) => { if (new URL(r.request().url()).pathname === '/token-boosts/top/v1') times.push(1); return r.abort(); });
    await p2.goto(url); await wait(300);
    const step = async (ms) => { await p2.clock.runFor(ms); await wait(250); return times.length; };
    const seq = [times.length, await step(1500), await step(3000), await step(6000), await step(11000), await step(70000)];
    // attempts land at cumulative 0s, 1s, 3s, 7s, 15s (gaps 1, 2, 4, 8) and then stop; checkpoints sit between them
    record(g, 'backoff doubles 1s, 2s, 4s, 8s across five attempts, then stops', JSON.stringify(seq) === JSON.stringify([1, 2, 3, 4, 5, 5]), JSON.stringify(seq));
    const status = (await p2.locator('#market-status').textContent()) || '';
    const dashes = await p2.$$eval('#market-rows .mrow', (trs, d) => trs.every((tr) => [...tr.children].slice(1, 6).every((c) => c.textContent.trim() === d) && tr.querySelector('.addr-btn').disabled), DASH);
    record(g, 'after the last failure: dashes in every cell, error pill, retry offered, marquee shows the error', /unavailable after 5 attempts/.test(status) && (await p2.getAttribute('#market-status', 'data-state')) === 'error' && dashes && (await p2.locator('#market-retry').isVisible()) && /unavailable/.test((await p2.locator('#mq-track').textContent()) || ''), status);
    await ctx2.close();

    // ---- market source not stated: no request, no fetch code
    const off = JSON.parse(JSON.stringify(realReg)); const m2 = byId(off, 'market');
    for (const k of ['url', 'imageHost', 'source', 'scope', 'statedAt']) delete m2[k]; m2.state = 'unconfirmed'; m2.asOf = realReg.records.find((r) => r.asOf).asOf;
    const d2 = path.join(tmp, 'market-off'); fs.mkdirSync(d2, { recursive: true }); fs.writeFileSync(path.join(d2, 'r.json'), JSON.stringify(off));
    await build({ registryFile: path.join(d2, 'r.json'), dist: path.join(d2, 'dist'), skipAssetsFrom: realDist });
    const { srv: s2, url: u2 } = await serve(path.join(d2, 'dist'));
    const ctx3 = await browser.newContext(); const p3 = await ctx3.newPage(); const reqs = [];
    p3.on('request', (r) => reqs.push(r.url()));
    await p3.goto(u2); await wait(1500);
    record(g, 'market source unstated: no request reaches the api, controls disabled, slots pending, no marquee track', !reqs.some((u) => u.includes(apiHost)) && (await p3.locator('#market-rows .addr-btn:not([disabled])').count()) === 0 && (await p3.locator('#market-rows [data-asof]').count()) > 10 && (await p3.locator('#marquee .mq-track').count()) === 0);
    await ctx3.close(); s2.close();
  } finally { await browser.close(); srv.close(); }
}
