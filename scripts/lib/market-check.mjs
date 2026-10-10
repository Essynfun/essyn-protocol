// Market module gate: live whenever the market source is stated, independent of the contract.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';
import { byId } from './registry.mjs';

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const isText = (p) => ['.html', '.css', '.js', '.json', '.svg', '.txt', ''].includes(path.extname(p).toLowerCase());

export function checkMarket({ dist, reg }) {
  const errs = []; const mk = byId(reg, 'market');
  const live = mk.state === 'stated';
  const read = (p) => fs.readFileSync(path.join(dist, p), 'utf8');
  const html = parse(read('index.html'));
  const sec = html.querySelector('#market'); const band = html.querySelector('#marquee');
  if (!sec || !band) errs.push('market section or marquee missing');
  else {
    const buttons = html.querySelectorAll('#market-rows .addr-btn');
    if (html.querySelectorAll('#market-rows .mrow').length !== 10) errs.push('market table must have 10 rows');
    if (buttons.some((b) => !b.hasAttribute('disabled'))) errs.push('a token copy button is live before any data exists');
    const mode = live ? 'live' : 'inert';
    if (sec.getAttribute('data-market') !== mode || band.getAttribute('data-market') !== mode) errs.push(`market mode must be ${mode}`);
    if (!live) {
      if (html.querySelectorAll('#market .skel, #marquee .skel').length) errs.push('inert market shows skeletons');
      if (html.querySelector('script[src*="market.js"]') || fs.existsSync(path.join(dist, 'assets/js/market.js'))) errs.push('inert build ships market.js');
      if (JSON.parse(html.querySelector('#registry').text).market) errs.push('inert build hands the market url to the page');
      for (const f of walk(dist)) if (isText(f) && /dexscreener/i.test(fs.readFileSync(f, 'utf8'))) errs.push(`inert build mentions the market host in ${path.basename(f)}`);
      if (html.querySelectorAll('#market-rows [data-record]').some((n) => n.getAttribute('data-state') === 'stated')) errs.push('inert market slots must not be stated');
    } else {
      if (html.querySelectorAll('#market-rows .skel').length < 10) errs.push('live market needs skeleton rows');
      if (!html.querySelector('#mq-track')) errs.push('live marquee track missing');
      if (!fs.existsSync(path.join(dist, 'assets/js/market.js'))) errs.push('market.js missing');
      else { const t = read('assets/js/market.js'); if (/https?:\/\//.test(t) || /dexscreener/i.test(t)) errs.push('market.js hard-codes a url; it must read the register'); }
      for (const f of ['card.js', 'fx.js']) { if (!fs.existsSync(path.join(dist, 'assets/js', f))) errs.push(f + ' missing'); else if (new RegExp("https?:"+String.fromCharCode(47,47)).test(read('assets/js/' + f))) errs.push(f + ' hard-codes a url'); }
      const m = JSON.parse(html.querySelector('#registry').text).market;
      if (!m || m.url !== mk.url || m.imageHost !== mk.imageHost) errs.push('page register json must carry the stated market record');
      const headers = read('_headers');
      if (!headers.includes(new URL(mk.url).origin) || !headers.includes('https://' + mk.imageHost)) errs.push('CSP must name the market api and image host');
    }
  }
  return { id: 'market-module', rule: '1,2', ok: errs.length === 0, detail: errs.join('; ') || `market module is ${live ? 'live (skeleton rows, register-fed js, CSP, not gated by the contract)' : 'inert (no fetch code, no host, disabled buttons, pending slots)'}` };
}
