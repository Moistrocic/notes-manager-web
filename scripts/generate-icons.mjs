#!/usr/bin/env node
/**
 * Generates the app icons from one vector definition.
 *
 *   node scripts/generate-icons.mjs
 *
 * Writes into web/public/: favicon.svg, favicon.ico, apple-touch-icon.png,
 * icon-192.png, icon-512.png, site.webmanifest.
 *
 * The PNG/ICO rasteriser is a few dozen lines on purpose: the project should not
 * grow a native image dependency (sharp, canvas, resvg) just to draw a rounded
 * square with a note on it, and keeping the source of truth here means the icons
 * can be regenerated rather than being opaque binaries nobody dares to touch.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public');

/* -------------------------------------------------------------------------- */
/* The mark, in a 0..1 coordinate space                                        */
/* -------------------------------------------------------------------------- */
const ACCENT = [0x8b, 0x6c, 0xff];
const ACCENT_2 = [0x22, 0xd3, 0xee];
const PAGE = [0xff, 0xff, 0xff];
const FOLD = [0xdc, 0xd6, 0xff];

const CORNER = 0.235; // rounded square
const PAGE_BOX = { x0: 0.305, y0: 0.165, x1: 0.695, y1: 0.835, r: 0.062 };
const FOLD_BOX = { x0: 0.535, y0: 0.165, x1: 0.695, y1: 0.325 };

/** Rounded rectangle signed distance: negative inside. */
function roundRectSDF(px, py, box) {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const hw = (box.x1 - box.x0) / 2 - box.r;
  const hh = (box.y1 - box.y0) / 2 - box.r;
  const qx = Math.abs(px - cx) - hw;
  const qy = Math.abs(py - cy) - hh;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - box.r;
}

function inTriangle(px, py, a, b, c) {
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = sign([px, py], a, b);
  const d2 = sign([px, py], b, c);
  const d3 = sign([px, py], c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * Draws the icon at one size.
 * `detail` drops the folded corner and one text line below 32px, where those
 * details would only smear the glyph.
 */
function render(size, detail = 'full') {
  const SS = 4; // supersampling factor per axis
  const rgba = Buffer.alloc(size * size * 4);
  const lines =
    detail === 'full'
      ? [
          { y0: 0.43, y1: 0.485, x1: 0.638 },
          { y0: 0.545, y1: 0.6, x1: 0.638 },
          { y0: 0.66, y1: 0.715, x1: 0.55 },
        ]
      : [
          { y0: 0.44, y1: 0.515, x1: 0.645 },
          { y0: 0.585, y1: 0.66, x1: 0.645 },
        ];
  const lineBoxes = lines.map((l) => ({ x0: 0.362, x1: l.x1, y0: l.y0, y1: l.y1, r: (l.y1 - l.y0) / 2 }));

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;

          if (roundRectSDF(x, y, { x0: 0, y0: 0, x1: 1, y1: 1, r: CORNER }) > 0) continue; // outside the badge

          // gradient background, top-left to bottom-right
          let cr = 0;
          let cg = 0;
          let cb = 0;
          const t = Math.min(1, Math.max(0, (x + y) / 2));
          [cr, cg, cb] = mix(ACCENT, ACCENT_2, t);

          if (roundRectSDF(x, y, PAGE_BOX) <= 0) {
            [cr, cg, cb] = mix([cr, cg, cb], PAGE, 0.96);
            if (
              detail === 'full' &&
              inTriangle(x, y, [FOLD_BOX.x0, FOLD_BOX.y0], [FOLD_BOX.x1, FOLD_BOX.y1], [FOLD_BOX.x0, FOLD_BOX.y1])
            ) {
              [cr, cg, cb] = mix([cr, cg, cb], FOLD, 1);
            } else if (lineBoxes.some((box) => roundRectSDF(x, y, box) <= 0)) {
              [cr, cg, cb] = mix([cr, cg, cb], ACCENT, 1);
            }
          }

          r += cr;
          g += cg;
          b += cb;
          a += 255;
        }
      }

      const samples = SS * SS;
      const i = (py * size + px) * 4;
      if (a === 0) continue;
      // Un-premultiply: the colour sums only cover the covered samples.
      const covered = a / 255;
      rgba[i] = Math.round(r / covered);
      rgba[i + 1] = Math.round(g / covered);
      rgba[i + 2] = Math.round(b / covered);
      rgba[i + 3] = Math.round(a / samples);
    }
  }
  return rgba;
}

/* -------------------------------------------------------------------------- */
/* PNG encoder                                                                 */
/* -------------------------------------------------------------------------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO container holding PNG images (supported by every browser since IE11). */
function encodeICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((image, i) => {
    const b = i * 16;
    dir[b] = image.size >= 256 ? 0 : image.size;
    dir[b + 1] = image.size >= 256 ? 0 : image.size;
    dir[b + 2] = 0; // palette
    dir[b + 3] = 0; // reserved
    dir.writeUInt16LE(1, b + 4); // colour planes
    dir.writeUInt16LE(32, b + 6); // bits per pixel
    dir.writeUInt32BE(0, b + 8);
    dir.writeUInt32LE(image.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += image.png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

/* -------------------------------------------------------------------------- */
/* SVG                                                                         */
/* -------------------------------------------------------------------------- */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="笔记管理面板">
  <defs>
    <linearGradient id="badge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b6cff"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#badge)"/>
  <path d="M19.5 14.6a4 4 0 0 1 4-4h10.6l10.4 10.4v28.4a4 4 0 0 1-4 4h-17a4 4 0 0 1-4-4z" fill="#fff" fill-opacity="0.96"/>
  <path d="M34.1 10.6 44.5 21h-7.4a3 3 0 0 1-3-3z" fill="#dcd6ff"/>
  <rect x="23.2" y="27.5" width="17.6" height="3.5" rx="1.75" fill="#8b6cff"/>
  <rect x="23.2" y="34.9" width="17.6" height="3.5" rx="1.75" fill="#8b6cff" fill-opacity="0.72"/>
  <rect x="23.2" y="42.3" width="12" height="3.5" rx="1.75" fill="#8b6cff" fill-opacity="0.45"/>
</svg>
`;

const manifest = {
  name: '笔记管理面板',
  short_name: '笔记',
  description: 'Markdown 笔记管理面板，笔记存放于 OpenList 目录',
  start_url: '.',
  display: 'standalone',
  background_color: '#060a16',
  theme_color: '#8b6cff',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
};

/* -------------------------------------------------------------------------- */
mkdirSync(OUT, { recursive: true });

writeFileSync(path.join(OUT, 'favicon.svg'), svg);
writeFileSync(
  path.join(OUT, 'favicon.ico'),
  encodeICO([
    { size: 16, png: encodePNG(16, render(16, 'simple')) },
    { size: 32, png: encodePNG(32, render(32)) },
    { size: 48, png: encodePNG(48, render(48)) },
  ]),
);
writeFileSync(path.join(OUT, 'apple-touch-icon.png'), encodePNG(180, render(180)));
writeFileSync(path.join(OUT, 'icon-192.png'), encodePNG(192, render(192)));
writeFileSync(path.join(OUT, 'icon-512.png'), encodePNG(512, render(512)));
writeFileSync(path.join(OUT, 'site.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');

console.log('icons written to', OUT);
for (const name of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest']) {
  const { size } = await import('node:fs').then((fs) => fs.statSync(path.join(OUT, name)));
  console.log(`  ${name.padEnd(22)} ${size} bytes`);
}
