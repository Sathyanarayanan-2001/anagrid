// Draws the app icons with no image library, so the build needs no native tools.
// Run once (npm run icons is not needed in CI: the PNG files are committed).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../src/icons/', import.meta.url));
mkdirSync(out, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 3 x 3 supersampling for smooth edges
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const c = pixel((x + (sx + 0.5) / 3) / size, (y + (sy + 0.5) / 3) / size);
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0; raw[o + 1] = a ? Math.round(g / a) : 0; raw[o + 2] = a ? Math.round(b / a) : 0; raw[o + 3] = Math.round((a / 9) * 255);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const EMERALD = [4, 120, 87], WHITE = [255, 255, 255];
/** Icon: emerald tile, white grid cross, node ring in the centre. scale shrinks the glyph for the maskable safe zone. */
function icon(rounded, scale) {
  return (u, v) => {
    if (rounded) {
      const r = 0.2, dx = Math.max(r - u, 0, u - (1 - r)), dy = Math.max(r - v, 0, v - (1 - r));
      if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
    }
    const x = (u - 0.5) / scale, y = (v - 0.5) / scale;
    const d = Math.hypot(x, y);
    const w = 0.045;
    if (d < 0.075) return [...EMERALD, 1];
    if (d < 0.165) return [...WHITE, 1];
    if ((Math.abs(y) < w && Math.abs(x) < 0.36) || (Math.abs(x) < w && Math.abs(y) < 0.36)) return [...WHITE, 1];
    return [...EMERALD, 1];
  };
}
writeFileSync(out + 'icon-192.png', png(192, icon(true, 1)));
writeFileSync(out + 'icon-512.png', png(512, icon(true, 1)));
writeFileSync(out + 'icon-maskable-512.png', png(512, icon(false, 0.72)));
console.log('icons written to', out);
