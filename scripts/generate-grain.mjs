import sharp from 'sharp';

// A repeatable, monochrome grain tile. Wrapped neighbours keep the edges seamless.
const size = 256;
let seed = 8317;
const random = () => {
  seed = Math.imul(seed ^ seed >>> 15, 1 | seed);
  seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed);
  return ((seed ^ seed >>> 14) >>> 0) / 4294967296;
};
const noise = Float32Array.from({ length: size * size }, () =>
  Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random()));
const pixels = Buffer.alloc(size * size * 4);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = y * size + x;
  const neighbours = noise[y * size + (x + 1) % size] + noise[(y + 1) % size * size + x];
  const tone = Math.max(0, Math.min(255, Math.round((128 + (noise[i] * 0.86 + neighbours * 0.12) * 52) / 4) * 4));
  pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = tone;
}
for (const [name, alpha] of [['film-grain', 16], ['film-grain-dark', 14]]) {
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = alpha;
  await sharp(pixels, { raw: { width: size, height: size, channels: 4 } })
    .webp({ lossless: true, effort: 6 })
    .toFile(new URL(`../src/assets/${name}.webp`, import.meta.url).pathname);
}
