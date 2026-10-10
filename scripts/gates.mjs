// npm run gates -> exit 0 only when every gate passes on the real build AND the harness proves both branches.
// Mutation anchors are state-independent: each mutation reads the current record at runtime (by id)
// and rewrites it, so it works whether that record is stated, absent or unconfirmed today.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { loadRegistry, byId, validate } from './lib/registry.mjs';
import { runDistChecks, checkAddresses, checkRegisterDom, checkLinks, checkPalette, checkCopy, scanAddresses, tokenize, visibleCopy } from './lib/checks.mjs';
import { checkHygiene } from './lib/checks.mjs';
import { build } from './build.mjs';
import { runMarketTests } from './market-test.mjs';
import { checkMarket } from './lib/market-check.mjs';
import { checkNoDates } from './lib/checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const registryFile = path.join(root, 'src/data/registry.json');
const tmp = path.join(root, '.tmp-gates');
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (buf) => { let n = BigInt('0x' + buf.toString('hex')); let s = ''; while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; } return s; };
const freshSolana = () => { for (;;) { const a = b58(crypto.randomBytes(32)); if (a.length >= 43) return a; } };
const freshEvm = () => '0x' + crypto.randomBytes(20).toString('hex');
const clone = (o) => JSON.parse(JSON.stringify(o));

const results = []; let failed = 0;
const rec = (group, name, pass, detail = '') => { results.push({ group, name, pass, detail }); if (!pass) failed++; console.log(`${pass ? 'PASS' : 'FAIL'}  [${group}] ${name}${detail && !pass ? '\n        ' + detail : ''}`); };
const expectFail = (group, name, r, needle) => rec(group, name, !r.ok && (!needle || r.detail.includes(needle)), r.ok ? 'gate did not trip' : (needle && !r.detail.includes(needle) ? `tripped without "${needle}": ${r.detail}` : ''));

/* ---------- 1. gates on the real build ---------- */
const real = loadRegistry(registryFile);
if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('dist/ missing: run npm run build first'); process.exit(1); }
for (const r of runDistChecks({ root, dist, registryFile })) rec('dist', `${r.id} (rule ${r.rule})`, r.ok, r.detail);
const hy = checkHygiene({ root }); rec('repo', `${hy.id} (rule ${hy.rule})`, hy.ok, hy.detail);

/* ---------- 2. mutation harness ---------- */
fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
const scenario = async (name, mutate) => {
  const reg = clone(real); mutate(reg);
  const dir = path.join(tmp, name); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'registry.json'); fs.writeFileSync(file, JSON.stringify(reg, null, 2));
  const out = path.join(dir, 'dist');
  try { await build({ registryFile: file, dist: out, skipAssetsFrom: dist }); } catch (e) { return { reg, out, file, error: e.message }; }
  return { reg, out, file };
};
const state = (reg, id, patch, drop = []) => { const r = byId(reg, id); for (const k of drop) delete r[k]; Object.assign(r, patch); };
const html = (d) => path.join(d, 'index.html');
const edit = (d, fn) => { const root2 = parse(fs.readFileSync(html(d), 'utf8'), { comment: true }); fn(root2); fs.writeFileSync(html(d), root2.toString()); };
const today = real.records.find((r) => r.asOf)?.asOf || '2026-10-10';

// Branch A: the contract is as the register says today (absent in this repo). Prove the inert branch from the live record.
{
  const ca = byId(real, 'ca');
  const a = await scenario('branch-a-current', () => {});
  const html1 = fs.readFileSync(html(a.out), 'utf8');
  const slot = parse(html1).querySelector('#ca');
  if (ca.state !== 'stated') {
    rec('branch A (inert)', 'contract slot renders inert and dated', slot.getAttribute('data-state') === ca.state && slot.getAttribute('data-asof') === ca.asOf && !!slot.querySelector('button[disabled]'));
    rec('branch A (inert)', 'no address-shaped string anywhere in output', checkAddresses({ dist: a.out, reg: a.reg }).ok);
    rec('branch A (inert)', 'x and github icons render at every breakpoint but inert (no href)', ['x', 'github'].every((id) => { const n = parse(html1).querySelector(`[data-record="${id}"]`); return n && n.tagName !== 'A' && !n.hasAttribute('href'); }));
  }
  for (const r of runDistChecks({ root, dist: a.out, registryFile: a.file })) rec('branch A (inert)', `${r.id}`, r.ok, r.detail);
}

// Branch B: contract + both socials stated (mutated from whatever state each record has right now).
{
  const addr = freshSolana();
  const b = await scenario('branch-b-stated', (reg) => {
    state(reg, 'ca', { state: 'stated', value: addr, source: 'client statement', scope: 'batch-level', statedAt: today }, ['asOf']);
    state(reg, 'x', { state: 'stated', url: 'https://x.com/essyn_test', source: 'client statement', scope: 'batch-level', statedAt: today }, ['asOf']);
    state(reg, 'github', { state: 'stated', url: 'https://github.com/essyn-test/essyn', source: 'client statement', scope: 'batch-level', statedAt: today }, ['asOf']);
  });
  rec('branch B (stated)', 'build accepts a stated contract and stated socials', !b.error, b.error);
  if (!b.error) {
    const h = parse(fs.readFileSync(html(b.out), 'utf8'));
    rec('branch B (stated)', 'contract slot shows the full address, live copy control', h.querySelector('#ca-value')?.text.trim() === addr && !!h.querySelector('#ca-copy') && !h.querySelector('#ca-copy').hasAttribute('disabled'));
    rec('branch B (stated)', 'x and github are links with href = stored url, handle derived', h.querySelector('[data-record="x"]').getAttribute('href') === 'https://x.com/essyn_test' && h.querySelector('[data-record="x"]').getAttribute('aria-label') === 'X @essyn_test' && h.querySelector('[data-record="github"]').getAttribute('aria-label') === 'GitHub @essyn-test');
    rec('branch B (stated)', 'registry json handed to the page carries the stated contract', JSON.parse(h.querySelector('#registry').text).ca.value === addr);
    const css = fs.readFileSync(path.join(b.out, 'assets/js/app.js'), 'utf8');
    rec('branch B (stated)', 'clipboard + rpc wiring present in app.js', css.includes('clipboard') && css.includes('getAccountInfo'));
    for (const r of runDistChecks({ root, dist: b.out, registryFile: b.file })) rec('branch B (stated)', `${r.id}`, r.ok, r.detail);

    // negatives on top of branch B
    const stray = freshSolana();
    edit(b.out, (r2) => r2.querySelector('main').insertAdjacentHTML('beforeend', `<p>${stray}</p>`));
    expectFail('negative', 'stray unregistered Solana address in page is caught', checkAddresses({ dist: b.out, reg: b.reg }), stray);
    edit(b.out, (r2) => { r2.querySelector('main').lastChild.remove(); });
    rec('negative', 'removing the stray restores a clean scan', checkAddresses({ dist: b.out, reg: b.reg }).ok);
  }
}

// Branch A negatives: absent state with an address-shaped string / href injected.
{
  const a = await scenario('neg-absent-injected', () => {});
  const stray = freshSolana();
  edit(a.out, (r2) => r2.querySelector('main').insertAdjacentHTML('beforeend', `<p>${stray}</p>`));
  expectFail('negative', 'address in page while contract is unstated is caught', checkAddresses({ dist: a.out, reg: a.reg }), stray);
  const a2 = await scenario('neg-inert-href', () => {});
  edit(a2.out, (r2) => { const n = r2.querySelector('[data-record="x"]'); n.setAttribute('href', 'https://x.com/essyn_test'); });
  const xState = byId(a2.reg, 'x').state;
  if (xState !== 'stated') {
    expectFail('negative', 'href on an unstated social record is caught (register)', checkRegisterDom({ dist: a2.out, reg: a2.reg }), 'inert element carries href');
    expectFail('negative', 'href on an unstated social record is caught (link rule)', checkLinks({ dist: a2.out, reg: a2.reg }) , undefined);
  }
}

// Rule 3: 0x hex is never blanket-rejected; it is matched against the stated register.
{
  const evm = freshEvm();
  const e = await scenario('evm', (reg) => { reg.records.push({ id: 'evm-probe', kind: 'link', state: 'stated', label: 'Probe', value: evm, source: 'client statement', scope: 'batch-level', statedAt: today }); });
  rec('rule 3', 'registry accepts a stated 0x address record', !e.error, e.error);
  if (!e.error) {
    edit(e.out, (r2) => r2.querySelector('main').insertAdjacentHTML('beforeend', `<p>${evm} 0xff 0x1234 0x${'ab'.repeat(32)}</p>`));
    rec('rule 3', 'stated 0x address + short hex constants + 32-byte hash all pass', checkAddresses({ dist: e.out, reg: e.reg }).ok);
    const other = freshEvm();
    edit(e.out, (r2) => r2.querySelector('main').insertAdjacentHTML('beforeend', `<p>${other}</p>`));
    expectFail('rule 3', 'an unregistered 0x address is caught', checkAddresses({ dist: e.out, reg: e.reg }), other);
  }
}

// Rule 1: inert records must not carry value or url (checked against whichever record is current).
{
  for (const [id, key, val] of [['ca', 'value', freshSolana()], ['x', 'url', 'https://x.com/someone'], ['github', 'url', 'https://github.com/someone'], ['m.score', 'value', '4.9']]) {
    const s = await scenario(`inert-${id}-${key}`, (reg) => { const r = byId(reg, id); r.state = r.state === 'stated' ? 'unconfirmed' : r.state; r.asOf = r.asOf || today; r[key] = val; });
    rec('rule 1', `inert ${id} carrying ${key} is refused at build`, !!s.error && s.error.includes('inert record must not carry'), s.error || 'build accepted it');
  }
  const bad = await scenario('ca-malformed', (reg) => state(reg, 'ca', { state: 'stated', value: 'not-a-real-address-0OIl', source: 'client statement', statedAt: today }, ['asOf']));
  rec('rule 1', 'malformed contract value is refused at build', !!bad.error && bad.error.includes('32-byte base58'), bad.error || 'build accepted it');
  const bad2 = await scenario('x-stored-handle', (reg) => state(reg, 'x', { state: 'stated', url: 'https://x.com/essyn_test', handle: 'essyn_test', source: 'client statement', statedAt: today }, ['asOf']));
  rec('rule 2', 'a stored handle is refused (handles are derived from the url)', !!bad2.error && bad2.error.includes('derived from url'), bad2.error || 'build accepted it');
  const bad3 = await scenario('x-wrong-host', (reg) => state(reg, 'x', { state: 'stated', url: 'https://example.org/essyn_test', source: 'client statement', statedAt: today }, ['asOf']));
  rec('rule 2', 'a social url on the wrong host is refused', !!bad3.error && bad3.error.includes('not accepted'), bad3.error || 'build accepted it');
  const unc = await scenario('unconfirmed-contract', (reg) => state(reg, 'ca', { state: 'unconfirmed', asOf: today }, ['value', 'url']));
  rec('rule 1', 'unconfirmed contract builds inert and dated', !unc.error && parse(fs.readFileSync(html(unc.out), 'utf8')).querySelector('#ca').getAttribute('data-state') === 'unconfirmed' && checkRegisterDom({ dist: unc.out, reg: unc.reg }).ok, unc.error);
}

// Market module: inert when the contract is absent, live when stated; negatives; then browser proof against a mocked api.
{
  const a = await scenario('market-inert', (reg) => state(reg, 'market', { state: 'unconfirmed', asOf: today }, ['url', 'imageHost', 'source', 'scope', 'statedAt']));
  const mi = a.error ? { ok: false, detail: a.error } : checkMarket({ dist: a.out, reg: a.reg });
  rec('market', 'market source not stated: module is inert (no fetch code, no host)', mi.ok, mi.detail);
  edit(a.out, (r2) => r2.querySelector('main').insertAdjacentHTML('beforeend', '<p>' + byId(real, 'market').url + '</p>'));
  expectFail('market', 'market host leaking into an inert build is caught', checkMarket({ dist: a.out, reg: a.reg }), 'mentions the market host');
  const l = await scenario('market-live-ca-absent', (reg) => state(reg, 'ca', { state: 'absent', asOf: today }, ['value', 'url', 'source', 'scope', 'statedAt']));
  const ml = l.error ? { ok: false, detail: l.error } : checkMarket({ dist: l.out, reg: l.reg });
  rec('market', 'contract absent: market module is still live', ml.ok && byId(l.reg, 'ca').state === 'absent' && fs.existsSync(path.join(l.out, 'assets/js/market.js')), ml.detail);
  const l2 = await scenario('market-live-ca-stated', (reg) => state(reg, 'ca', { state: 'stated', value: freshSolana(), source: 'client statement', statedAt: today }, ['asOf']));
  const ml2 = l2.error ? { ok: false, detail: l2.error } : checkMarket({ dist: l2.out, reg: l2.reg });
  rec('market', 'contract stated: market module is live too', ml2.ok, ml2.detail);
  const u = await scenario('market-unconfirmed', (reg) => { state(reg, 'ca', { state: 'stated', value: freshSolana(), source: 'client statement', statedAt: today }, ['asOf']); state(reg, 'market', { state: 'unconfirmed', asOf: today }, ['url', 'imageHost', 'source', 'scope', 'statedAt']); });
  const mu = u.error ? { ok: false, detail: u.error } : checkMarket({ dist: u.out, reg: u.reg });
  rec('market', 'contract stated but market source unconfirmed: stays inert', mu.ok, mu.detail);
  const dd = await scenario('date-neg', () => {});
  edit(dd.out, (r2) => r2.querySelector('main').insertAdjacentHTML('beforeend', '<p>checked 2026-10-10</p>'));
  expectFail('dates', 'a visible date is caught', checkNoDates({ dist: dd.out }), 'visible date text');
  const hard = await scenario('market-url-inert', (reg) => { const r = byId(reg, 'market'); r.state = 'absent'; r.asOf = today; });
  rec('market', 'inert market record may not carry url or imageHost', !!hard.error && hard.error.includes('inert record must not carry'), hard.error || 'build accepted it');
  await runMarketTests({ realDist: dist, tmp, realReg: real, record: rec });
}

// Rule 4: a stray colour literal anywhere outside tokens.css is caught.
{
  const a = await scenario('palette-neg', () => {});
  const css = path.join(a.out, 'assets/css/site.css');
  fs.appendFileSync(css, '\n.probe { color: #ff00aa; }\n');
  expectFail('rule 4', 'hex literal outside tokens.css is caught', checkPalette({ root, dist: a.out, tokensFile: path.join(root, 'src/css/tokens.css') }), 'colour literal');
  fs.writeFileSync(css, fs.readFileSync(css, 'utf8').replace(/\n\.probe[^\n]*\n/, '\n') + '\n.probe { color: rgb(1 2 3); }\n');
  expectFail('rule 4', 'rgb() literal outside tokens.css is caught', checkPalette({ root, dist: a.out, tokensFile: path.join(root, 'src/css/tokens.css') }), 'colour literal');
}

// Copy gate: put one of our own bigrams into a copy of the fixture; the gate must trip on it.
{
  const a = await scenario('copy-neg', () => {});
  const text = visibleCopy(fs.readFileSync(html(a.out), 'utf8')).split(/\n|[.!?;:]\s/).map(tokenize).find((t) => t.length > 3);
  const fx = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/reference-grams.json'), 'utf8'));
  const h10 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
  fx.bigrams.push(h10(text[0] + ' ' + text[1]));
  const fxFile = path.join(tmp, 'fixture.json'); fs.writeFileSync(fxFile, JSON.stringify(fx));
  expectFail('copy', 'a shared 2-gram is caught', checkCopy({ dist: a.out, fixture: fxFile }), text[0] + ' ' + text[1]);
}

fs.rmSync(tmp, { recursive: true, force: true });
const passN = results.filter((r) => r.pass).length;
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/gates.json'), JSON.stringify({ at: new Date().toISOString(), passed: passN, failed, results }, null, 2));
console.log(`\n${passN}/${results.length} gates passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
