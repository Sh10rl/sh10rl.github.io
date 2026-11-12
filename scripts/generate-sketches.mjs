import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// The sketches behind the index, a different one on each load. Each scan in src/assets/sketches
// is traced into the outlines of its inked lines, and into a pen stroke along the middle of each
// line. The page draws the pen strokes one by one and shows the ink only where they have been,
// so the line art appears the way it was inked. The ink takes its colour from the theme and
// stays sharp at any size.
//
// A scan is lossless greyscale, dark lines on light paper. Each needs an entry in sketches.json
// beside it, under the scan's file name. Positions are in the scan file's own pixels:
//   mirror  true flips the drawing, so the figure faces the list on its left
//   focus   [x, y]: where the drawing starts
//   face    x of the edge, nearest the list, of what must stay clear of the text: a face, or the subject
//   crop    [left, top, width, height], optional: the part of the scan that is drawn
//   erase   [[left, top, width, height], …], optional: parts painted out first, such as frame lines and signatures
//   width   optional: the width the whole scan is traced at, when 2400 leaves its lines too thin to trace
//   weight  optional: how many pixels wider than in the scan the lines are drawn; by default, enough
//           for fine lines not to be faint at the size the page shows them
//   credit  read by the page, not here
// Run `node scripts/generate-sketches.mjs` after adding or changing a scan or its entry. It
// writes <name>.svg for every entry and deletes SVGs whose entry is gone.

const folder = new URL('../src/assets/sketches/', import.meta.url);

export const WIDTH = 2400; // a scan is traced as if it were this wide, and the lengths below are in those pixels
export const INK = 200; // tones darker than this are ink
export const PAPER = 235; // tones lighter than this are paper; between the two is the soft edge of a line
const DUST = 24; // specks smaller than this many pixels are noise from the scan
const STRAIGHT = 35; // lines that meet within this many degrees of straight are one stroke
const PEN_TOLERANCE = 1.5; // how far a pen stroke may stray from the traced centre line, in pixels
const PEN_MARGIN = 1.5; // a pen stroke covers its line's ink and this many pixels on either side
const INK_TOLERANCE = 1.2; // how far an inked outline may stray from the smoothed scan, in pixels
const SPECK = 4; // inked shapes smaller than this many square pixels are left out
const SMOOTH = 1.5; // lines are smoothed over this many of the scan's own pixels (a Gaussian's deviation)
const SCALE = 2; // output units per traced pixel: whole-number coordinates fall on half pixels
const SPREAD = 1150; // ms over which the strokes start, at an even rate, nearest the focus first
const DETAIL = 180; // ms the finest strokes wait after the main lines around them
const PACE = 1.25; // pixels a pen covers in a millisecond
const SHORTEST = 100; // ms for the shortest stroke
const LONGEST = 480; // ms for the longest
const REACH = 10; // pixels along a line that give its direction at an end
export const BODY = 0.85; // the middle width, in CSS pixels, that a sketch's lines have at least in a 1440 × 900 window

/** The width in CSS pixels at which the page shows a sketch of this aspect (width over height): --w in src/styles/global.css. */
export const shownWidth = (aspect, vw = 1440, vh = 900) => Math.min(Math.min(0.85 * vh, Math.max(0.5 * vh, vw - 240)) * aspect, Math.max(0.71 * vw, 544));

/* Curves -------------------------------------------------------------------------- */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a) => mul(a, 1 / (Math.hypot(a[0], a[1]) || 1));

/** The same line as points one pixel apart. */
function resample(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += gap(points[i - 1], points[i]);
  const count = Math.max(1, Math.round(total));
  const out = [points[0]];
  let i = 1;
  let passed = 0;
  for (let k = 1; k < count; k++) {
    const want = (k / count) * total;
    while (i < points.length - 1 && passed + gap(points[i - 1], points[i]) <= want) passed += gap(points[i - 1], points[i++]);
    const step = gap(points[i - 1], points[i]);
    out.push(add(points[i - 1], mul(sub(points[i], points[i - 1]), step ? (want - passed) / step : 0)));
  }
  out.push(points.at(-1));
  return { line: out, length: total };
}

/** Indices where the line turns sharply, so curves are not fitted across a corner. */
function corners(line) {
  const SPAN = 6;
  const turn = line.map((p, i) => {
    if (i < SPAN || i >= line.length - SPAN) return 0;
    const a = unit(sub(p, line[i - SPAN]));
    const b = unit(sub(line[i + SPAN], p));
    return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  });
  const out = [];
  for (let i = SPAN; i < line.length - SPAN; i++) {
    if (turn[i] < Math.PI / 3) continue;
    let peak = true;
    for (let k = i - SPAN; k <= i + SPAN; k++) if (turn[k] > turn[i] || (turn[k] === turn[i] && k < i)) peak = false;
    if (peak) out.push(i);
  }
  return out;
}

/** Weights of a Gaussian with deviation `sigma`, out to three deviations. */
const gaussian = (sigma) => Array.from({ length: Math.ceil(3 * sigma) + 1 }, (_, i) => Math.exp(-(i * i) / (2 * sigma * sigma)));

/** Takes the pixel staircase out of a line. Its two ends stay where they are. */
function smooth(line, weights) {
  return line.map((p, i) => {
    const reach = Math.min(weights.length - 1, i, line.length - 1 - i);
    let x = 0;
    let y = 0;
    let sum = 0;
    for (let k = -reach; k <= reach; k++) {
      const weight = weights[Math.abs(k)];
      x += line[i + k][0] * weight;
      y += line[i + k][1] * weight;
      sum += weight;
    }
    return [x / sum, y / sum];
  });
}

/** The same for a closed outline, which has no ends. */
function smoothLoop(loop, weights) {
  return loop.map((_, i) => {
    let x = 0;
    let y = 0;
    let sum = 0;
    for (let k = 1 - weights.length; k < weights.length; k++) {
      const [px, py] = loop[(i + k + loop.length) % loop.length];
      const weight = weights[Math.abs(k)];
      x += px * weight;
      y += py * weight;
      sum += weight;
    }
    return [x / sum, y / sum];
  });
}

/** The area a closed outline encloses, in square pixels. */
const area = (loop) =>
  Math.abs(loop.reduce((sum, [x, y], i) => {
    const [nx, ny] = loop[(i + 1) % loop.length];
    return sum + x * ny - nx * y;
  }, 0)) / 2;

const bezier = (c, t) => {
  const s = 1 - t;
  return add(add(mul(c[0], s * s * s), mul(c[1], 3 * s * s * t)), add(mul(c[2], 3 * s * t * t), mul(c[3], t * t * t)));
};

/** Least-squares cubic through `line` with the given end tangents (Schneider, Graphics Gems). */
function cubic(line, u, t1, t2) {
  const first = line[0];
  const last = line.at(-1);
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  line.forEach((p, i) => {
    const t = u[i];
    const s = 1 - t;
    const a1 = mul(t1, 3 * s * s * t);
    const a2 = mul(t2, 3 * s * t * t);
    const rest = sub(p, add(mul(first, s * s * s + 3 * s * s * t), mul(last, 3 * s * t * t + t * t * t)));
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    x0 += dot(a1, rest);
    x1 += dot(a2, rest);
  });
  const det = c00 * c11 - c01 * c01;
  const span = gap(first, last);
  let alpha1 = det ? (x0 * c11 - x1 * c01) / det : 0;
  let alpha2 = det ? (c00 * x1 - c01 * x0) / det : 0;
  if (alpha1 < span * 1e-6 || alpha2 < span * 1e-6) alpha1 = alpha2 = span / 3;
  return [first, add(first, mul(t1, alpha1)), add(last, mul(t2, alpha2)), last];
}

/** Newton's method: moves each parameter toward the closest point on the curve. */
function reparameterize(line, c, u) {
  const d1 = [mul(sub(c[1], c[0]), 3), mul(sub(c[2], c[1]), 3), mul(sub(c[3], c[2]), 3)];
  const d2 = [mul(sub(d1[1], d1[0]), 2), mul(sub(d1[2], d1[1]), 2)];
  return u.map((t, i) => {
    const s = 1 - t;
    const off = sub(bezier(c, t), line[i]);
    const q1 = add(add(mul(d1[0], s * s), mul(d1[1], 2 * s * t)), mul(d1[2], t * t));
    const q2 = add(mul(d2[0], s), mul(d2[1], t));
    const slope = dot(q1, q1) + dot(off, q2);
    return slope ? Math.max(0, Math.min(1, t - dot(off, q1) / slope)) : t;
  });
}

/** Appends cubics that follow `line` within `tolerance`, splitting where one curve cannot. */
function fit(line, t1, t2, tolerance, out) {
  if (line.length === 2) {
    const third = gap(line[0], line[1]) / 3;
    out.push([add(line[0], mul(t1, third)), add(line[1], mul(t2, third)), line[1]]);
    return;
  }
  let u = [0];
  for (let i = 1; i < line.length; i++) u.push(u[i - 1] + gap(line[i - 1], line[i]));
  u = u.map((length) => length / u.at(-1));
  let curve;
  let worst;
  let split;
  for (let round = 0; round < 5; round++) {
    if (round) u = reparameterize(line, curve, u);
    curve = cubic(line, u, t1, t2);
    worst = 0;
    split = line.length >> 1;
    line.forEach((p, i) => {
      const miss = gap(bezier(curve, u[i]), p);
      if (miss > worst && i > 0 && i < line.length - 1) {
        worst = miss;
        split = i;
      }
    });
    if (worst < tolerance) {
      out.push(curve.slice(1));
      return;
    }
    if (worst > tolerance * 4) break;
  }
  const back = unit(sub(line[Math.max(0, split - 3)], line[Math.min(line.length - 1, split + 3)]));
  fit(line.slice(0, split + 1), t1, back, tolerance, out);
  fit(line.slice(split), mul(back, -1), t2, tolerance, out);
}

/** Path data in whole output units, each curve relative to where the last one ended. */
function serialize(start, curves, closed) {
  let x = Math.round(start[0] * SCALE);
  let y = Math.round(start[1] * SCALE);
  let d = `M${x} ${y}`;
  for (const curve of curves) {
    const numbers = curve.flatMap(([px, py]) => [Math.round(px * SCALE) - x, Math.round(py * SCALE) - y]);
    d += `c${numbers.join(' ').replaceAll(' -', '-')}`;
    x += numbers[4];
    y += numbers[5];
  }
  return closed ? `${d}z` : d;
}

/** A pen stroke along a line's centre, smoothed over `sigma` pixels. */
function centre({ line, length, closed }, sigma) {
  // A dot is a line with nowhere to go: one pixel long, under its round ends.
  if (length < 1) return `M${Math.round(line[0][0] * SCALE)} ${Math.round(line[0][1] * SCALE)}h${SCALE}`;
  const stops = [0, ...(closed ? [] : corners(line)), line.length - 1];
  const curves = [];
  for (let i = 1; i < stops.length; i++) {
    const piece = smooth(line.slice(stops[i - 1], stops[i] + 1), gaussian(sigma));
    const lean = Math.min(3, piece.length - 1);
    let t1 = unit(sub(piece[lean], piece[0]));
    let t2 = unit(sub(piece.at(-1 - lean), piece.at(-1)));
    // A ring leaves and arrives along the same tangent, so its seam does not show.
    if (closed) {
      t1 = unit(sub(piece[lean], piece.at(-1 - lean)));
      t2 = mul(t1, -1);
    }
    fit(piece, t1, t2, PEN_TOLERANCE, curves);
  }
  return serialize(line[0], curves, closed);
}

/**
 * A closed outline as one smooth run of curves, smoothed over `sigma` pixels, or less on a loop
 * so small that it would shrink. Without corners, line ends stay round.
 */
function outline(loop, sigma) {
  const { line } = resample([...loop, loop[0]]);
  line.pop();
  if (line.length < 8) {
    const curves = line.map((p, i) => {
      const q = line[(i + 1) % line.length];
      return [add(p, mul(sub(q, p), 1 / 3)), add(p, mul(sub(q, p), 2 / 3)), q];
    });
    return serialize(line[0], curves, true);
  }
  const ring = smoothLoop(line, gaussian(Math.min(sigma, line.length / 12)));
  ring.push(ring[0]);
  const t1 = unit(sub(ring[3], ring.at(-4)));
  const curves = [];
  fit(ring, t1, mul(t1, -1), INK_TOLERANCE, curves);
  return serialize(ring[0], curves, true);
}

/**
 * Where `field` crosses one half (marching squares): closed loops of points, with pixel centres
 * at whole coordinates. The field is below one half along its border, so every loop closes.
 */
function contours(field, w, h) {
  const points = new Map();
  const links = new Map();
  // A crossing on the edge from pixel (x, y) to the one right of it, or below it.
  const cross = (x, y, down) => {
    const id = (y * w + x) * 2 + down;
    if (!points.has(id)) {
      const a = field[y * w + x];
      const b = field[down ? (y + 1) * w + x : y * w + x + 1];
      const t = (0.5 - a) / (b - a);
      points.set(id, down ? [x, y + t] : [x + t, y]);
    }
    return id;
  };
  const link = (a, b) => {
    for (const [from, to] of [[a, b], [b, a]]) {
      const list = links.get(from);
      if (list) list.push(to);
      else links.set(from, [to]);
    }
  };
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const tl = field[y * w + x];
    const tr = field[y * w + x + 1];
    const br = field[(y + 1) * w + x + 1];
    const bl = field[(y + 1) * w + x];
    const code = (tl >= 0.5) | ((tr >= 0.5) << 1) | ((br >= 0.5) << 2) | ((bl >= 0.5) << 3);
    if (code === 0 || code === 15) continue;
    const top = () => cross(x, y, 0);
    const bottom = () => cross(x, y + 1, 0);
    const left = () => cross(x, y, 1);
    const right = () => cross(x + 1, y, 1);
    // Where two inked corners face each other across the cell, they join if its middle is inked.
    const joined = (tl + tr + br + bl) / 4 >= 0.5;
    switch (code) {
      case 1: case 14: link(top(), left()); break;
      case 2: case 13: link(top(), right()); break;
      case 3: case 12: link(left(), right()); break;
      case 4: case 11: link(right(), bottom()); break;
      case 6: case 9: link(top(), bottom()); break;
      case 7: case 8: link(left(), bottom()); break;
      case 5:
        if (joined) link(top(), right()), link(left(), bottom());
        else link(top(), left()), link(right(), bottom());
        break;
      case 10:
        if (joined) link(top(), left()), link(right(), bottom());
        else link(top(), right()), link(left(), bottom());
        break;
    }
  }
  const loops = [];
  const done = new Set();
  for (const start of links.keys()) {
    if (done.has(start)) continue;
    const loop = [];
    for (let id = start, prev = -1; !done.has(id); ) {
      done.add(id);
      loop.push(points.get(id));
      const [a, b] = links.get(id);
      [prev, id] = [id, a === prev ? b : a];
    }
    loops.push(loop);
  }
  return loops;
}

/* One sketch ------------------------------------------------------------------------ */

/** The part of a scan that an entry draws, as tones from 0 to 255, with what the entry erases painted out. */
export async function framed(scan, { crop, erase = [] }) {
  const { data, info } = await sharp(scan).greyscale().raw().toBuffer({ resolveWithObject: true });
  const [left, top, width, height] = crop ?? [0, 0, info.width, info.height];
  for (const [l, t, w, h] of [...erase, [left, top, width, height]]) {
    if (l < 0 || t < 0 || l + w > info.width || t + h > info.height) throw new Error(`${scan}: [${l}, ${t}, ${w}, ${h}] reaches outside the ${info.width}×${info.height} scan`);
  }
  for (const [l, t, w, h] of erase) for (let y = t; y < t + h; y++) data.fill(255, y * info.width + l, y * info.width + l + w);
  const part = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) data.copy(part, y * width, (top + y) * info.width + left, (top + y) * info.width + left + width);
  return { data: part, left, top, width, height, scan: info.width };
}

/**
 * How wide a picture's lines are: twice the distance to paper, along the middle of each line.
 * The distance is a 3-4 chamfer, and a pixel is on the middle of its line where no neighbour is
 * farther from paper. Returns the 10th, 50th and 90th percentile, in pixels.
 */
export function lineWidths({ data, width: W, height: H }) {
  const far = new Uint16Array(W * H);
  for (let i = 0; i < W * H; i++) far[i] = data[i] < INK ? 65535 : 0;
  const relax = (i, x, y, dx, dy, cost) => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
    const d = far[ny * W + nx] + cost;
    if (d < far[i]) far[i] = d;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!far[i]) continue;
    relax(i, x, y, -1, 0, 3);
    relax(i, x, y, 0, -1, 3);
    relax(i, x, y, -1, -1, 4);
    relax(i, x, y, 1, -1, 4);
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (!far[i]) continue;
    relax(i, x, y, 1, 0, 3);
    relax(i, x, y, 0, 1, 3);
    relax(i, x, y, 1, 1, 4);
    relax(i, x, y, -1, 1, 4);
  }
  const widths = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const d = far[i];
    if (!d || d === 65535) continue;
    let middle = true;
    for (const n of [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1]) if (far[i + n] > d) middle = false;
    // A line w pixels wide is (w + 1) / 2 or w / 2 pixels from paper along its middle.
    if (middle) widths.push((2 * d) / 3 - 0.5);
  }
  widths.sort((a, b) => a - b);
  return [0.1, 0.5, 0.9].map((share) => widths[Math.floor(share * widths.length)] ?? 0);
}

/**
 * How much wider than in the scan an entry's lines are drawn, in the scan's pixels. Fine lines
 * shown small would be faint, so they are thickened until their middle width on the page is
 * BODY. An entry's `weight` sets the amount itself.
 */
export function thickening(part, entry) {
  if (entry.weight !== undefined) return entry.weight;
  const shown = shownWidth(part.width / part.height) / part.width;
  return Math.max(0, BODY / shown - lineWidths(part)[1]);
}

async function trace(scan, entry) {
  /* Ink: a clear pixel all round means every pixel has eight neighbours. */

  const { mirror } = entry;
  const part = await framed(scan, entry);
  // The whole scan is traced as if it were `width` wide, so a crop keeps the scan's scale.
  const scale = (entry.width ?? WIDTH) / part.scan;
  // sharp gives a resized one-channel image back as three, so it is made grey again.
  const { data, info } = await sharp(part.data, { raw: { width: part.width, height: part.height, channels: 1 } })
    .resize({ width: Math.round(part.width * scale) })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1) throw new Error(`${scan}: expected one channel, got ${info.channels}`);
  const focus = [(entry.focus[0] - part.left) * scale, (entry.focus[1] - part.top) * scale];
  const face = (entry.face - part.left) * scale;
  if (focus[0] < 0 || focus[1] < 0 || focus[0] > info.width || focus[1] > info.height) throw new Error(`${scan}: focus lies outside the part that is drawn`);
  if (face < 0 || face > info.width) throw new Error(`${scan}: face lies outside the part that is drawn`);
  // Lines are smoothed over the scan's own pixels: a scan traced at twice its size is smoothed twice as far.
  const sigma = SMOOTH * scale;
  // Lines that would be thin on the page are drawn bolder: each side moves out by this many pixels.
  const grow = (thickening(part, entry) * scale) / 2;
  const W = info.width + 2;
  const H = info.height + 2;
  const tone = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < info.height; y++) tone.set(data.subarray(y * info.width, (y + 1) * info.width), (y + 1) * W + 1);
  const ink = tone.map((t) => (t < INK ? 1 : 0));
  const dark = (p) => 1 - tone[p] / 255;
  // Clockwise from north.
  const AROUND = [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1];

  /** Calls `each` with every group of touching pixels that `member` accepts. */
  function groups(member, each) {
    const seen = new Uint8Array(W * H);
    for (let start = 0; start < W * H; start++) {
      if (seen[start] || !member(start)) continue;
      const group = [start];
      seen[start] = 1;
      for (let i = 0; i < group.length; i++) for (const d of AROUND) {
        const q = group[i] + d;
        if (!seen[q] && member(q)) {
          seen[q] = 1;
          group.push(q);
        }
      }
      each(group);
    }
  }

  groups((p) => ink[p], (group) => {
    if (group.length < DUST) for (const p of group) {
      ink[p] = 0;
      tone[p] = 255;
    }
  });
  // Ink in the top rows was cut off there. The page fades that edge.
  const cut = ink.subarray(W, 4 * W).some(Boolean);

  /** Half the line's width at a pixel: the distance to the nearest paper. */
  function radius(p) {
    const x = p % W;
    const y = (p - x) / W;
    let best = Infinity;
    for (let r = 1; r < best; r++) for (let i = -r; i <= r; i++) {
      for (const [dx, dy] of [[i, -r], [i, r], [-r, i], [r, i]]) {
        const qx = x + dx;
        const qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= W || qy >= H || !ink[qy * W + qx]) best = Math.min(best, Math.hypot(dx, dy));
      }
    }
    return best - 0.5;
  }

  /* Skeleton: Zhang-Suen thinning peels the ink from both sides until one pixel is left along its middle. */

  const skeleton = ink.slice();
  let live = [];
  for (let p = 0; p < skeleton.length; p++) if (skeleton[p]) live.push(p);
  for (let changed = true; changed; ) {
    changed = false;
    for (const pass of [0, 1]) {
      const gone = live.filter((p) => {
        const n = AROUND.map((d) => skeleton[p + d]);
        const count = n[0] + n[1] + n[2] + n[3] + n[4] + n[5] + n[6] + n[7];
        if (count < 2 || count > 6) return false;
        let turns = 0;
        for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) turns++;
        if (turns !== 1) return false;
        return pass ? !(n[0] && n[2] && n[6]) && !(n[0] && n[4] && n[6]) : !(n[0] && n[2] && n[4]) && !(n[2] && n[4] && n[6]);
      });
      for (const p of gone) skeleton[p] = 0;
      if (gone.length) {
        changed = true;
        live = live.filter((p) => skeleton[p]);
      }
    }
  }
  // A corner pixel between two that already touch diagonally adds nothing but a false junction.
  for (const p of live) {
    const [n, ne, e, se, s, sw, w, nw] = AROUND.map((d) => skeleton[p + d]);
    if ((n && e && !s && !w && !sw) || (e && s && !n && !w && !nw) || (s && w && !n && !e && !ne) || (w && n && !s && !e && !se)) skeleton[p] = 0;
  }
  const pixels = [];
  for (let p = 0; p < skeleton.length; p++) if (skeleton[p]) pixels.push(p);
  const degree = new Uint8Array(W * H);
  for (const p of pixels) for (const d of AROUND) degree[p] += skeleton[p + d];

  /* Graph: junctions are nodes; the runs of pixels between them (or out to a loose end) are edges. */

  const nodeAt = new Int32Array(W * H).fill(-1);
  const nodes = [];
  groups((p) => degree[p] >= 3, (group) => {
    let x = 0;
    let y = 0;
    let r = 0;
    for (const p of group) {
      nodeAt[p] = nodes.length;
      x += p % W;
      y += Math.floor(p / W);
      r = Math.max(r, radius(p));
    }
    nodes.push({ x: x / group.length, y: y / group.length, r, pixels: group });
  });

  const walked = new Uint8Array(W * H);
  const edges = [];

  /** Follows a line from `start` until it ends, closes on itself or reaches a junction. */
  function walk(start, before, from) {
    if (walked[start]) return;
    const chain = [];
    let to = -1;
    let ring = false;
    for (let p = start, prev = before; ; ) {
      walked[p] = 1;
      chain.push(p);
      let next = -1;
      for (const d of AROUND) {
        const q = p + d;
        if (!skeleton[q] || q === prev) continue;
        if (nodeAt[q] >= 0) to = nodeAt[q];
        else next = q;
      }
      if (to >= 0 || next < 0) break;
      if (next === start) {
        ring = true;
        break;
      }
      prev = p;
      p = next;
    }
    edges.push({ at: [from, to], chain, ring, partner: [null, null] });
  }

  nodes.forEach((node, n) => {
    for (const p of node.pixels) for (const d of AROUND) if (skeleton[p + d] && nodeAt[p + d] < 0) walk(p + d, p, n);
  });
  // Loose ends first, then rings, then the dots that thinned down to a single pixel.
  for (const wanted of [1, 2, 0]) for (const p of pixels) if (degree[p] === wanted) walk(p, -1, -1);

  // Thinning leaves a whisker wherever the outline bulges. One that stays inside the line's own
  // width is not a stroke.
  for (const edge of edges) {
    const [a, b] = edge.at;
    if (!edge.ring && a < 0 !== b < 0 && edge.chain.length <= nodes[Math.max(a, b)].r * 1.5 + 2) edge.cut = true;
  }

  // Two lines crossing thin to a pair of junctions with a short bridge between. Where the bridge
  // lies inside both, they are one meeting point.
  const root = nodes.map((_, n) => n);
  const find = (n) => (root[n] === n ? n : (root[n] = find(root[n])));
  for (const edge of edges) {
    const [a, b] = edge.at;
    if (edge.cut || a < 0 || b < 0) continue;
    if (a === b ? edge.chain.length < 4 : edge.chain.length <= nodes[a].r + nodes[b].r + 1) {
      root[find(a)] = find(b);
      edge.cut = true;
    }
  }

  /* Strokes: at each meeting point, the two lines that continue each other best become one. */

  const flip = (x) => (mirror ? info.width - x : x);
  const point = (p) => [flip((p % W) - 0.5), Math.floor(p / W) - 0.5];
  const anchor = (edge, side) => (edge.at[side] < 0 ? null : [flip(nodes[edge.at[side]].x - 0.5), nodes[edge.at[side]].y - 0.5]);

  /** Unit vector along an edge, leaving the junction at `side`. */
  function heading(edge, side) {
    const line = side ? edge.chain.toReversed() : edge.chain;
    const [a, b] = line.length > 3 ? [point(line[1]), point(line[Math.min(line.length - 1, REACH)])] : [anchor(edge, side), anchor(edge, 1 - side) ?? point(line.at(-1))];
    return unit(sub(b, a));
  }

  const meetings = new Map();
  for (const edge of edges) {
    if (edge.cut || edge.ring) continue;
    edge.at.forEach((node, side) => {
      if (node < 0) return;
      const key = find(node);
      if (!meetings.has(key)) meetings.set(key, []);
      meetings.get(key).push({ edge, side });
    });
  }
  const join = (a, b) => {
    a.edge.partner[a.side] = b;
    b.edge.partner[b.side] = a;
  };
  for (const ends of meetings.values()) {
    if (ends.length === 2) {
      join(ends[0], ends[1]);
      continue;
    }
    const headings = ends.map(({ edge, side }) => heading(edge, side));
    const pairs = [];
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      if (ends[i].edge === ends[j].edge) continue;
      const turn = (Math.acos(Math.max(-1, Math.min(1, -dot(headings[i], headings[j])))) * 180) / Math.PI;
      if (turn < STRAIGHT) pairs.push({ turn, i, j });
    }
    const taken = new Set();
    for (const { i, j } of pairs.sort((a, b) => a.turn - b.turn)) {
      if (taken.has(i) || taken.has(j)) continue;
      taken.add(i).add(j);
      join(ends[i], ends[j]);
    }
  }

  /** Runs along joined edges from one end of a stroke to the other. `loose` counts the ends that meet nothing. */
  function follow(first, from) {
    const points = [];
    const route = [];
    const start = anchor(first, from);
    if (start) points.push(start);
    for (let edge = first, side = from; ; ) {
      edge.used = true;
      route.push(edge);
      for (const p of side ? edge.chain.toReversed() : edge.chain) points.push(point(p));
      const next = edge.partner[1 - side];
      if (!next) {
        const stop = anchor(edge, 1 - side);
        if (stop) points.push(stop);
        return { points, edges: route, loose: !start + !stop, closed: false };
      }
      if (next.edge === first && next.side === from) return { points, edges: route, loose: 0, closed: true };
      ({ edge, side } = next);
    }
  }

  const strokes = [];
  for (const edge of edges) {
    if (edge.cut) continue;
    if (edge.ring) strokes.push({ points: edge.chain.map(point), edges: [edge], loose: 0, closed: true });
    else for (const side of [0, 1]) if (!edge.used && !edge.partner[side]) strokes.push(follow(edge, side));
  }
  // What is left runs in a circle through its junctions.
  for (const edge of edges) if (!edge.cut && !edge.ring && !edge.used) strokes.push(follow(edge, 0));

  /* Drawing order: each stroke starts from its end nearer the focus, and later the farther away that is. */

  const start = [flip(focus[0]), focus[1]];
  const drawn = [];
  for (const stroke of strokes) {
    if (stroke.closed) stroke.points.push(stroke.points[0]);
    else if (gap(stroke.points.at(-1), start) < gap(stroke.points[0], start)) stroke.points.reverse();
    const { line, length } = resample(stroke.points);
    // Between two junctions and no longer than their own pixels, a stroke is part of where they meet.
    if (!stroke.loose && length < 2) continue;
    drawn.push({ line, length, closed: stroke.closed, edges: stroke.edges, far: gap(line[0], start) });
  }
  drawn.sort((a, b) => a.far - b.far);

  /* Ink: every inked pixel belongs to the stroke nearest to it. A stroke's outline runs where its
     ink is half as dark as along its middle, so a faint line keeps its width and is filled as
     faint as it is. */

  const owner = new Int32Array(W * H).fill(-1);
  // The centre-line pixel each inked pixel was reached from: how far a stroke's ink spreads.
  const seed = new Int32Array(W * H).fill(-1);
  const claimed = [];
  drawn.forEach((stroke, s) => {
    for (const edge of stroke.edges) for (const p of edge.chain) {
      owner[p] = s;
      seed[p] = p;
      claimed.push(p);
    }
  });
  for (let i = 0; i < claimed.length; i++) {
    const p = claimed[i];
    for (const d of AROUND) {
      const q = p + d;
      if (owner[q] < 0 && tone[q] < PAPER) {
        owner[q] = owner[p];
        seed[q] = seed[p];
        claimed.push(q);
      }
    }
  }
  const regions = drawn.map(() => []);
  for (const p of claimed) regions[owner[p]].push(p);

  const inked = drawn.map((stroke, s) => {
    const middle = stroke.edges.flatMap((edge) => edge.chain.map(dark)).sort((a, b) => a - b);
    const strength = middle[middle.length >> 1];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of regions[s]) {
      const x = p % W;
      const y = (p - x) / W;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    // A margin of two pixels, one for reaching into the lines it meets and one that stays clear,
    // and room for the stroke to grow.
    const margin = 2 + Math.ceil(grow);
    x0 -= margin;
    y0 -= margin;
    const w = x1 - x0 + 1 + margin;
    const h = y1 - y0 + 1 + margin;
    let field = new Float32Array(w * h);
    const put = (p) => {
      const x = p % W;
      const i = ((p - x) / W - y0) * w + (x - x0);
      field[i] = Math.max(field[i], Math.min(1, dark(p) / strength));
    };
    for (const p of regions[s]) {
      put(p);
      // Reaching one pixel into the lines it meets, a stroke overlaps them instead of leaving a seam.
      for (const d of AROUND) if (owner[p + d] !== s && tone[p + d] < PAPER) put(p + d);
    }
    if (grow) {
      // Every inked pixel spreads outward, losing `slope` a pixel. A fully inked pixel lies half a
      // pixel inside the outline, so the outline moves out by `grow`, and less where a line tapers.
      const slope = 0.5 / (grow + 0.5);
      const span = Math.ceil(grow + 1.5);
      const grown = field.slice();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = field[y * w + x];
        if (!v) continue;
        for (let dy = -span; dy <= span; dy++) for (let dx = -span; dx <= span; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const spread = v - slope * Math.hypot(dx, dy);
          if (spread > grown[ny * w + nx]) grown[ny * w + nx] = spread;
        }
      }
      field = grown;
    }
    const d = contours(field, w, h)
      .filter((loop) => area(loop) >= SPECK)
      .map((loop) => outline(loop.map(([x, y]) => [flip(x0 + x - 0.5), y0 + y - 0.5]), sigma))
      .join('');
    // The farthest the stroke's outlined ink lies from its centre line, plus the pixel it reaches
    // into the lines it meets and what it has grown.
    let reach = 0;
    for (const p of regions[s]) {
      if (dark(p) < strength / 2) continue;
      const x = p % W;
      const sx = seed[p] % W;
      reach = Math.max(reach, Math.hypot(x - sx, (p - x - seed[p] + sx) / W));
    }
    return { d, shade: Math.round(strength * 10) / 10, reach: reach + 1 + grow };
  });

  /* Output. Each pen stroke is wide enough to cover its line's ink. The pen works outward from
     the focus at an even rate, so the busy parts take longer, and in each place the main lines
     come before the fine ones around them. A stroke takes as long as a pen would to draw it.
     Times are in steps of 10 ms: finer ones would not show, and whole steps pack smaller. */

  // 0 for the stroke with the most ink, 1 for the one with the least.
  const fine = new Float64Array(drawn.length);
  drawn
    .map((_, s) => s)
    .sort((a, b) => regions[b].length - regions[a].length)
    .forEach((s, i, order) => (fine[s] = i / Math.max(1, order.length - 1)));
  const step = (ms) => Math.round(ms / 10) * 10;
  const pens = new Map();
  const inks = [];
  let done = 0;
  drawn.forEach((stroke, s) => {
    const { d, shade } = inked[s];
    if (!d) return;
    let { reach } = inked[s];
    const delay = step((s / (drawn.length - 1)) * SPREAD + fine[s] * DETAIL);
    const time = step(Math.min(LONGEST, Math.max(SHORTEST, stroke.length / PACE)));
    done = Math.max(done, delay + time);
    // A ring smaller than its own pen would be stroked with a hole in its middle, so its pen
    // is a dot at the ring's centre.
    if (stroke.closed) {
      const middle = mul(stroke.line.reduce(add), 1 / stroke.line.length);
      const span = Math.max(...stroke.line.map((p) => gap(p, middle)));
      if (span < reach + PEN_MARGIN) {
        stroke = { line: [middle], length: 0 };
        reach += span;
      }
    }
    const width = 2 * Math.ceil((reach + PEN_MARGIN) * SCALE);
    if (!pens.has(width)) pens.set(width, []);
    pens.get(width).push(`<path style="--d:${delay};--t:${time}" d="${centre(stroke, sigma)}"/>`);
    inks.push(`<path${shade < 1 ? ` fill-opacity="${shade}"` : ''} d="${d}"/>`);
  });
  const pen = [...pens]
    .sort(([a], [b]) => a - b)
    .map(([width, paths]) => `<g stroke-width="${width}">\n${paths.join('\n')}\n</g>`)
    .join('\n');
  const share = ((mirror ? info.width - face : face) / info.width).toFixed(3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${info.width * SCALE} ${info.height * SCALE}" data-face="${share}" data-done="${done}"${cut ? ' data-cut="top"' : ''}>
<mask id="sketch-pen" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
${pen}
</mask>
<g class="ink" fill="currentColor" fill-rule="evenodd">
${inks.join('\n')}
</g>
</svg>
`;
}

/* All sketches ------------------------------------------------------------------------ */

// Only when run as a script: the tools that check a sketch import what they need from here.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const settings = JSON.parse(await readFile(new URL('sketches.json', folder), 'utf8'));
  const files = await readdir(folder);
  for (const file of files) if (file.endsWith('.webp') && !(file.slice(0, -5) in settings)) throw new Error(`${file} has no entry in sketches.json`);
  const rect = (r) => Array.isArray(r) && r.length === 4 && r.every(Number.isInteger) && r[2] > 0 && r[3] > 0;
  for (const [name, entry] of Object.entries(settings)) {
    const { mirror, focus, face, crop, erase = [], width = WIDTH, weight = 0 } = entry;
    if (typeof mirror !== 'boolean' || !Array.isArray(focus) || focus.length !== 2 || typeof face !== 'number') {
      throw new Error(`${name} in sketches.json needs mirror (true or false), focus ([x, y]) and face (x)`);
    }
    if ((crop !== undefined && !rect(crop)) || !Array.isArray(erase) || !erase.every(rect) || !(width > 0) || !(weight >= 0)) {
      throw new Error(`${name} in sketches.json: crop is [left, top, width, height], erase a list of such boxes, and width and weight are numbers, all in pixels`);
    }
    await writeFile(new URL(`${name}.svg`, folder), await trace(new URL(`${name}.webp`, folder).pathname, entry));
  }
  for (const file of files) if (file.endsWith('.svg') && !(file.slice(0, -4) in settings)) await rm(new URL(file, folder));
}
