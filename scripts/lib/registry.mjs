// Register pattern: every external fact is exactly one record with a state.
// stated      -> carries its value/url, source and the date it was stated
// absent      -> inert: no value, no url, dated
// unconfirmed -> inert: no value, no url, dated
import fs from 'node:fs';

export const STATES = ['stated', 'absent', 'unconfirmed'];
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function loadRegistry(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

export function base58Decode(s) {
  let n = 0n;
  for (const ch of s) { const i = ALPHABET.indexOf(ch); if (i < 0) return null; n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
  let bytes = n === 0n ? [] : hex.match(/../g).map((h) => parseInt(h, 16));
  for (const ch of s) { if (ch === '1') bytes.unshift(0); else break; }
  return Uint8Array.from(bytes);
}
export function isSolanaAddress(s) { const b = typeof s === 'string' && s.length >= 32 && s.length <= 44 ? base58Decode(s) : null; return !!b && b.length === 32; }
export function isEvmAddress(s) { return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s); }

export function fmtDate(iso) { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; }

const HOSTS = { x: ['x.com', 'twitter.com'], github: ['github.com'] };
export function handleFromUrl(url) {
  const u = new URL(url); const first = u.pathname.split('/').filter(Boolean)[0];
  return first || null;
}

export function validate(reg) {
  const errors = []; const ids = new Set();
  for (const r of reg.records) {
    const at = `record ${r.id}`;
    if (!r.id || ids.has(r.id)) errors.push(`${at}: missing or duplicate id`); ids.add(r.id);
    if (!STATES.includes(r.state)) { errors.push(`${at}: bad state ${r.state}`); continue; }
    if (r.state === 'stated') {
      if (!DATE.test(r.statedAt || '')) errors.push(`${at}: stated record needs statedAt`);
      if (!r.source) errors.push(`${at}: stated record needs source`);
      if (r.url) {
        let u; try { u = new URL(r.url); } catch { errors.push(`${at}: bad url`); continue; }
        if (u.protocol !== 'https:') errors.push(`${at}: url must be https`);
        if (HOSTS[r.id] && !HOSTS[r.id].includes(u.hostname)) errors.push(`${at}: url host ${u.hostname} not accepted`);
        if (HOSTS[r.id] && !handleFromUrl(r.url)) errors.push(`${at}: no handle derivable from url`);
      }
      if (r.id === 'market') {
        if (!r.url || new URL(r.url).hostname !== 'api.dexscreener.com') errors.push(`${at}: url must be the stated market api host`);
        if (!/^[a-z0-9.-]+$/.test(r.imageHost || '')) errors.push(`${at}: needs an imageHost`);
      }
      if (r.id === 'ca') {
        if (!isSolanaAddress(r.value)) errors.push(`${at}: value is not a 32-byte base58 Solana address`);
        if (r.url) errors.push(`${at}: contract is stored as value only`);
      }
      if (HOSTS[r.id] && !r.url) errors.push(`${at}: stated social record needs url`);
      if (HOSTS[r.id] && r.handle) errors.push(`${at}: handle is derived from url, never stored`);
    } else {
      if (!DATE.test(r.asOf || '')) errors.push(`${at}: inert record needs asOf date`);
      for (const k of ['value', 'url', 'href', 'handle', 'name', 'rpc', 'imageHost']) if (k in r) errors.push(`${at}: inert record must not carry ${k}`);
    }
  }
  return errors;
}

export const byId = (reg, id) => reg.records.find((r) => r.id === id);
export function statedValues(reg) {
  const out = new Set();
  for (const r of reg.records) {
    if (r.state !== 'stated') continue;
    for (const k of ['value', 'url', 'rpc']) if (r[k]) out.add(r[k]);
    if (r.imageHost) out.add('https://' + r.imageHost);
  }
  return out;
}

// The market module is live whenever its source is stated. The contract slot never gates it.
export const marketLive = (reg) => byId(reg, 'market')?.state === 'stated';
