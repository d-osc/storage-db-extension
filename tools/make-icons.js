// Generates the extension icons (database cylinder on a blue rounded square).
// Run: node tools/make-icons.js   (writes icons/icon16.png, icon48.png, icon128.png)
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  if (!crc32.table) {
    crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

const BG_TOP = [66, 133, 244];
const BG_BOT = [26, 79, 184];
const CYL = [232, 234, 237];

function sample(u, v) {
  const m = 0.04, r = 0.2;
  const cx0 = m + r, cx1 = 1 - m - r, cy0 = m + r, cy1 = 1 - m - r;
  if (u < m || u > 1 - m || v < m || v > 1 - m) return null;
  const nx = Math.min(Math.max(u, cx0), cx1);
  const ny = Math.min(Math.max(v, cy0), cy1);
  if ((u - nx) * (u - nx) + (v - ny) * (v - ny) > r * r) return null;

  const t = (v - m) / (1 - 2 * m);
  const bg = [
    BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t,
    BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t,
    BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t,
  ];

  const cx = 0.5, rx = 0.24, ry = 0.1, topCy = 0.33, botCy = 0.71;
  const inEll = (cy) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;
  const inBody = u >= cx - rx && u <= cx + rx && v >= topCy && v <= botCy;
  if (!(inBody || inEll(topCy) || inEll(botCy))) return bg;

  const band = Math.abs(v - 0.52) < 0.022 || Math.abs(v - 0.615) < 0.022;
  return band ? bg : CYL;
}

function draw(size) {
  const SS = 3;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const c = sample(u, v);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
      px[i + 3] = Math.round(a / n);
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(outDir, 'icon' + size + '.png'), draw(size));
  console.log('wrote icons/icon' + size + '.png');
}
