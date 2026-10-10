// Logo pipeline: reads brand/ + reference/ bytes, emits raster sizes, favicon, og image.
// Resizes are premultiplied: the transparent logo carries 3,718,220 pure-black
// transparent pixels (rgb 0,0,0 / alpha 0) that would bleed a dark halo into edges.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PNG } from 'pngjs';
import potrace from 'potrace';

const LOGO_ALPHA = 'brand/LOGO ESSYN PNG...png';     // RGBA, transparent background
const COVER = 'reference/SAMPUL ESSYN JPG.jpg.jpeg';  // 1500x500 banner

function readRGBA(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  return png;
}

export function alphaBBox(png) {
  let x0 = png.width, y0 = png.height, x1 = -1, y1 = -1;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    if (png.data[(y * png.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Manual premultiplied resize so the guarantee does not rest on library defaults.
async function premultipliedResize(rgba, w, h, size) {
  const n = w * h; const pm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const a = rgba[i*4+3] / 255;
    pm[i*4] = Math.round(rgba[i*4] * a); pm[i*4+1] = Math.round(rgba[i*4+1] * a); pm[i*4+2] = Math.round(rgba[i*4+2] * a); pm[i*4+3] = rgba[i*4+3];
  }
  // resize premultiplied colour (as opaque RGB) and alpha independently, then unpremultiply
  const rgb = Buffer.alloc(n * 3), al = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) { rgb[i*3] = pm[i*4]; rgb[i*3+1] = pm[i*4+1]; rgb[i*3+2] = pm[i*4+2]; al[i*3] = al[i*3+1] = al[i*3+2] = pm[i*4+3]; }
  const r1 = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).resize(size.w, size.h, { kernel: 'lanczos3' }).raw().toBuffer();
  const r2 = await sharp(al, { raw: { width: w, height: h, channels: 3 } }).resize(size.w, size.h, { kernel: 'lanczos3' }).raw().toBuffer();
  const out = Buffer.alloc(size.w * size.h * 4);
  for (let i = 0; i < size.w * size.h; i++) {
    const a = r2[i*3];
    out[i*4+3] = a;
    for (let c = 0; c < 3; c++) out[i*4+c] = a ? Math.min(255, Math.round(r1[i*3+c] * 255 / a)) : 0;
  }
  return out;
}

export async function buildAssets({ dist, tokens }) {
  const png = readRGBA(LOGO_ALPHA);
  const bb = alphaBBox(png);
  // crop to a square around the mark with 6% breathing room
  const side = Math.round(Math.max(bb.w, bb.h) * 1.12);
  const cx = Math.round(bb.x0 + bb.w / 2), cy = Math.round(bb.y0 + bb.h / 2);
  const sx = cx - Math.floor(side / 2), sy = cy - Math.floor(side / 2);
  const crop = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const X = sx + x, Y = sy + y; const o = (y * side + x) * 4;
    if (X >= 0 && Y >= 0 && X < png.width && Y < png.height) { const s = (Y * png.width + X) * 4; crop[o] = png.data[s]; crop[o+1] = png.data[s+1]; crop[o+2] = png.data[s+2]; crop[o+3] = png.data[s+3]; }
  }
  const outDir = path.join(dist, 'assets/img'); fs.mkdirSync(outDir, { recursive: true });
  const report = { bbox: bb, side, sizes: {} };

  for (const s of [64, 128, 512]) {
    const buf = await premultipliedResize(crop, side, side, { w: s, h: s });
    await sharp(buf, { raw: { width: s, height: s, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(outDir, `logo-${s}.png`));
    // halo evidence: partial-alpha edge pixels that came out dark. A naive straight-alpha
    // average of the black transparent pixels would darken every edge; the premultiplied path must not.
    let dark = 0, edge = 0;
    for (let i = 0; i < s * s; i++) { const a = buf[i*4+3]; if (a > 0 && a < 255) { edge++; if (Math.min(buf[i*4], buf[i*4+1], buf[i*4+2]) < 160) dark++; } }
    report.sizes[s] = { edgePixels: edge, darkEdgePixels: dark };
  }

  // favicon: trace the real pixel grid (256 px mask), scale into a 32x32 viewBox
  const G = 256;
  const gridPx = await premultipliedResize(crop, side, side, { w: G, h: G });
  const mask = Buffer.alloc(G * G * 3, 255);
  for (let i = 0; i < G * G; i++) if (gridPx[i*4+3] >= 128) { mask[i*3] = 0; mask[i*3+1] = 0; mask[i*3+2] = 0; }
  const maskPng = await sharp(mask, { raw: { width: G, height: G, channels: 3 } }).png().toBuffer();
  const svgTrace = await new Promise((res, rej) => potrace.trace(maskPng, { threshold: 128, turdSize: 4, optTolerance: 0.4, blackOnWhite: true }, (e, s) => (e ? rej(e) : res(s))));
  const d = [...svgTrace.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(' ');
  const pad = 5, inner = 32 - pad * 2, k = inner / G;
  const fav = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${tokens.black}"/><path transform="translate(${pad} ${pad}) scale(${k.toFixed(6)})" fill="${tokens.white}" fill-rule="evenodd" d="${d}"/></svg>\n`;
  if (fav.includes('--')) throw new Error('favicon contains a double hyphen');
  fs.writeFileSync(path.join(dist, 'favicon.svg'), fav);
  report.favicon = { bytes: fav.length, pathLength: d.length };

  // apple touch icon 180: mark centred on black
  const mark = await sharp(path.join(outDir, 'logo-512.png')).resize(126, 126).toBuffer();
  await sharp({ create: { width: 180, height: 180, channels: 4, background: tokens.black } }).composite([{ input: mark, gravity: 'centre' }]).png().toFile(path.join(dist, 'apple-touch-icon.png'));

  // og image: banner on black, 1200x630
  const banner = await sharp(COVER).resize(1200, 400).toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: tokens.black } }).composite([{ input: banner, top: 115, left: 0 }]).png({ compressionLevel: 9 }).toFile(path.join(dist, 'og.png'));
  return report;
}
