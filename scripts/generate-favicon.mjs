import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

// The tab icon: the square app icon cut to a circle. Each frame's alpha is the share of the
// pixel the circle covers, so even the 16px frame stays round when a browser scales it up.
const source = new URL('../public/web-app-manifest-512x512.png', import.meta.url).pathname;
const sizes = [48, 32, 16];
const SUB = 16;

const coverage = (size, x, y) => {
  const r = size / 2;
  let inside = 0;
  for (let sy = 0; sy < SUB; sy++) for (let sx = 0; sx < SUB; sx++) {
    const dx = x + (sx + 0.5) / SUB - r;
    const dy = y + (sy + 0.5) / SUB - r;
    if (dx * dx + dy * dy <= r * r) inside++;
  }
  return inside / (SUB * SUB);
};

// One ICO frame: a 32-bit BMP (bottom-up BGRA) followed by its 1-bit AND mask.
const frame = async (size) => {
  const rgba = await sharp(source).resize(size, size, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
  const colour = size * size * 4;
  const maskStride = Math.ceil(size / 32) * 4;
  const out = Buffer.alloc(40 + colour + maskStride * size);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(size, 4);
  out.writeInt32LE(size * 2, 8);
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  out.writeUInt32LE(colour + maskStride * size, 20);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const from = (y * size + x) * 4;
    const row = size - 1 - y;
    const alpha = Math.round(coverage(size, x, y) * rgba[from + 3]);
    if (alpha) {
      const to = 40 + (row * size + x) * 4;
      out[to] = rgba[from + 2];
      out[to + 1] = rgba[from + 1];
      out[to + 2] = rgba[from];
      out[to + 3] = alpha;
    } else {
      out[40 + colour + row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
};

const frames = await Promise.all(sizes.map((size) => frame(size)));
const directory = Buffer.alloc(6 + 16 * frames.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
frames.forEach((data, i) => {
  const at = 6 + 16 * i;
  directory[at] = directory[at + 1] = sizes[i];
  directory.writeUInt16LE(1, at + 4);
  directory.writeUInt16LE(32, at + 6);
  directory.writeUInt32LE(data.length, at + 8);
  directory.writeUInt32LE(offset, at + 12);
  offset += data.length;
});
const ico = Buffer.concat([directory, ...frames]);
for (const path of ['../src/assets/favicon.ico', '../public/favicon.ico']) {
  await writeFile(new URL(path, import.meta.url), ico);
}
