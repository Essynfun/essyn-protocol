// Phase 2: read every byte of every brand/reference asset.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const CT = { 0: 'greyscale', 2: 'truecolour', 3: 'indexed', 4: 'greyscale+alpha', 6: 'truecolour+alpha' };
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

function sniff(buf) {
  if (buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  return 'unknown';
}

function pngChunks(buf) {
  const out = []; let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
    out.push([type, len]); p += 12 + len;
  }
  return out;
}

function kmeans(px, k, iters = 24) {
  // px: array of [r,g,b,count]; seeded by farthest-point for determinism
  const cent = [px[0].slice(0, 3)];
  while (cent.length < k) {
    let best = null, bd = -1;
    for (const p of px) {
      const d = Math.min(...cent.map((c) => (c[0]-p[0])**2 + (c[1]-p[1])**2 + (c[2]-p[2])**2));
      if (d > bd) { bd = d; best = p; }
    }
    cent.push(best.slice(0, 3));
  }
  let assign = new Array(px.length).fill(0);
  for (let it = 0; it < iters; it++) {
    px.forEach((p, i) => {
      let b = 0, bd = Infinity;
      cent.forEach((c, j) => { const d = (c[0]-p[0])**2 + (c[1]-p[1])**2 + (c[2]-p[2])**2; if (d < bd) { bd = d; b = j; } });
      assign[i] = b;
    });
    cent.forEach((c, j) => {
      let s = [0, 0, 0], n = 0;
      px.forEach((p, i) => { if (assign[i] === j) { s[0] += p[0]*p[3]; s[1] += p[1]*p[3]; s[2] += p[2]*p[3]; n += p[3]; } });
      if (n) cent[j] = s.map((v) => v / n);
    });
  }
  const weights = cent.map((_, j) => px.reduce((a, p, i) => a + (assign[i] === j ? p[3] : 0), 0));
  return { cent, weights };
}

export function analyze(file) {
  const buf = fs.readFileSync(file);
  const kind = sniff(buf);
  const rep = { file: path.relative('.', file), bytes: buf.length, kind };
  let w, h, data;
  if (kind === 'png') {
    const ihdr = buf.slice(16, 29);
    rep.ihdr = { width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4), bitDepth: ihdr[8], colourType: ihdr[9], colourTypeName: CT[ihdr[9]], interlace: ihdr[12] };
    rep.chunks = pngChunks(buf).map(([t, l]) => `${t}:${l}`).join(' ');
    const png = PNG.sync.read(buf); w = png.width; h = png.height; data = png.data;
  } else if (kind === 'jpeg') {
    const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    w = j.width; h = j.height; data = j.data;
    // SOF marker components
    let p = 2; while (p < buf.length) { if (buf[p] !== 0xff) { p++; continue; } const m = buf[p+1]; const l = buf.readUInt16BE(p+2); if (m >= 0xc0 && m <= 0xc2) { rep.sof = { precision: buf[p+4], height: buf.readUInt16BE(p+5), width: buf.readUInt16BE(p+7), components: buf[p+9] }; break; } p += 2 + l; }
    rep.note = 'JPEG carries no alpha channel';
  } else { rep.error = 'unknown format'; return rep; }
  rep.size = [w, h];
  // alpha histogram (16 buckets) + counts
  const ah = new Array(16).fill(0); let a0 = 0, a255 = 0, black0 = 0;
  const map = new Map();
  for (let i = 0; i < w * h; i++) {
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2], a = data[i*4+3];
    ah[a >> 4]++; if (a === 0) a0++; if (a === 255) a255++;
    if (a === 0 && r === 0 && g === 0 && b === 0) black0++;
    if (a > 0) { const key = (r << 16) | (g << 8) | b; map.set(key, (map.get(key) || 0) + 1); }
  }
  rep.alpha = { hist16: ah, fullyTransparent: a0, fullyOpaque: a255, partial: w*h - a0 - a255, pureBlackTransparent: black0 };
  const top = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${hex(k >> 16, (k >> 8) & 255, k & 255)} x${n}`);
  rep.dominant = top;
  // k-means (k=5) on quantised colours, snapped to real pixel
  const q = new Map();
  for (const [k, n] of map) { const r = k >> 16, g = (k >> 8) & 255, b = k & 255; const kk = ((r>>3)<<10)|((g>>3)<<5)|(b>>3); const e = q.get(kk) || [0,0,0,0]; e[0]+=r*n; e[1]+=g*n; e[2]+=b*n; e[3]+=n; q.set(kk, e); }
  const px = [...q.values()].map((e) => [e[0]/e[3], e[1]/e[3], e[2]/e[3], e[3]]);
  const { cent, weights } = kmeans(px, 5);
  const real = [...map.keys()].map((k) => [k >> 16, (k >> 8) & 255, k & 255]);
  const total = weights.reduce((a, b) => a + b, 0);
  rep.kmeans = cent.map((c, j) => {
    let best = null, bd = Infinity;
    for (const p of real) { const d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2; if (d < bd) { bd = d; best = p; } }
    // locate a real coordinate of the snapped pixel
    let at = null;
    for (let i = 0; i < w * h && !at; i++) if (data[i*4]===best[0] && data[i*4+1]===best[1] && data[i*4+2]===best[2] && data[i*4+3] > 0) at = [i % w, Math.floor(i / w)];
    return { centroid: hex(...c.map(Math.round)), snapped: hex(...best), at, share: +(weights[j]/total*100).toFixed(2) };
  }).sort((a, b) => b.share - a.share);
  return rep;
}

if (process.argv[1].endsWith('analyze.mjs')) {
  const files = ['brand', 'reference'].flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f)));
  const reps = files.map(analyze);
  fs.writeFileSync(process.argv[2] || 'scripts/asset-report.json', JSON.stringify(reps, null, 2));
  for (const r of reps) console.log(JSON.stringify(r));
}
