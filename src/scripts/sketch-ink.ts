/**
 * Puts a sketch on the page and draws it in the way it was inked. Fetched with the sketch, after
 * the page has loaded (src/scripts/sketch.ts).
 *
 * At rest the sketch is a canvas: the SVG's ink, rasterized once by the browser at the place the
 * CSS gives it, in the layer's colour. The canvas follows a theme switch and is rasterized again
 * when the window changes the drawing's size.
 *
 * The drawing runs in WebGL 2. Each pen stroke in the SVG's <mask> runs along one line, starting
 * at `--d` and taking `--t` milliseconds, eased by --ease-in-out, and the ink shows where a pen
 * has been. The drawing takes as long as its last stroke's end, but its clock runs through
 * --ease-sketch: quickly at first, then more and more slowly toward the end. Done once on the
 * GPU, that becomes a map of the moment each pixel is inked, so a frame only compares that map
 * with the clock and costs the same however many strokes there are. Masking an SVG with the
 * strokes themselves rendered every stroke and all the ink on every frame, which phones could not
 * keep up with. The canvas at rest holds the same pixels as the last frame, so it takes over
 * without a seam.
 */

/** How long, in the sketch's own units, the straight pieces a pen's curves are cut into are. */
const STEP = 12;

/** The share of the pens' length the drawing's pace runs over; the rest comes with its last frame (see drawnBy). */
const DRAWN = 0.999;

const TIMES_VERTEX = `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 piece;
layout(location = 2) in vec2 along;
layout(location = 3) in vec3 pen;
uniform vec2 view;  // the viewBox's size
uniform vec4 place; // where the sketch lies in the canvas, as shares of its width and height
out vec2 local;
flat out float span;
flat out vec2 at;
flat out vec3 stroke;
void main() {
  vec2 d = piece.zw - piece.xy;
  span = length(d);
  vec2 forward = span > 0.0 ? d / span : vec2(1.0, 0.0);
  // A box around the piece and its round ends: along it from -radius to its length + radius.
  local = vec2(corner.x > 0.5 ? span + pen.x : -pen.x, corner.y * pen.x);
  vec2 p = piece.xy + forward * local.x + vec2(-forward.y, forward.x) * local.y;
  at = along;
  stroke = pen;
  gl_Position = vec4((place.xy + p / view * place.zw) * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const TIMES_FRAGMENT = `#version 300 es
precision highp float;
in vec2 local;
flat in float span;
flat in vec2 at;     // the stroke's length before this piece, and its whole length
flat in vec3 stroke; // the pen's radius, when it starts and how long it takes, in ms
// Row 0: the share of its time a stroke takes to draw a share of its length. Row 1: the share of
// the drawing's time at which it reaches a share of last.
uniform sampler2D ease;
uniform float last;     // the ms that 1 stands for in the strokes' timing
out vec4 moment;
void main() {
  float reach = stroke.x * stroke.x - local.y * local.y;
  if (reach < 0.0) discard;
  reach = sqrt(reach);
  if (local.x - reach > span || local.x + reach < 0.0) discard;
  // How much of the stroke the pen has drawn when its round end first covers this pixel.
  float share = clamp((at.x + max(0.0, local.x - reach)) / at.y, 0.0, 1.0);
  float time = texture(ease, vec2((share * 255.0 + 0.5) / 256.0, 0.25)).r;
  float scheduled = (stroke.y + stroke.z * time) / last;
  moment = vec4(texture(ease, vec2((scheduled * 255.0 + 0.5) / 256.0, 0.75)).r);
}`;

const FRAME_VERTEX = `#version 300 es
void main() {
  gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0.0, 1.0);
}`;

const FRAME_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D moments;
uniform sampler2D ink; // top row first, as the canvas holds it
uniform int rows;
uniform float now;
uniform vec3 tint;
out vec4 colour;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float a = texelFetch(ink, ivec2(p.x, rows - 1 - p.y), 0).a;
  colour = a > 0.0 && texelFetch(moments, p, 0).r <= now ? vec4(tint * a, a) : vec4(0.0);
}`;

/**
 * Cuts one pen stroke's path into straight pieces, nine numbers each: the piece's two ends, the
 * stroke's length before it and its whole length, and the pen's radius, start and duration. Reads
 * only what the generator writes: an absolute M, then relative c and h, and z.
 */
function trace(d: string, radius: number, start: number, duration: number, out: number[]) {
  const first = out.length;
  let i = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let length = 0;
  const number = () => {
    while (d.charCodeAt(i) === 32 || d.charCodeAt(i) === 44) i++;
    let sign = 1;
    if (d.charCodeAt(i) === 45) {
      sign = -1;
      i++;
    }
    let value = 0;
    let digits = 0;
    for (let c = d.charCodeAt(i); c >= 48 && c <= 57; c = d.charCodeAt(++i), digits++) value = value * 10 + c - 48;
    if (d.charCodeAt(i) === 46) {
      for (let c = d.charCodeAt(++i), scale = 0.1; c >= 48 && c <= 57; c = d.charCodeAt(++i), scale /= 10, digits++) value += (c - 48) * scale;
    }
    if (!digits) throw new Error(`Pen path data not read at ${i}: ${d.slice(0, 40)}`);
    return sign * value;
  };
  const to = (nx: number, ny: number) => {
    out.push(x, y, nx, ny, length, 0, radius, start, duration);
    length += Math.hypot(nx - x, ny - y);
    x = nx;
    y = ny;
  };
  let command = '';
  while (true) {
    while (d.charCodeAt(i) === 32 || d.charCodeAt(i) === 44) i++;
    if (i >= d.length) break;
    const c = d.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) command = d[i++];
    if (command === 'M') {
      x = startX = number();
      y = startY = number();
      command = '';
    } else if (command === 'h') {
      to(x + number(), y);
    } else if (command === 'c') {
      const x0 = x;
      const y0 = y;
      const x1 = x0 + number();
      const y1 = y0 + number();
      const x2 = x0 + number();
      const y2 = y0 + number();
      const x3 = x0 + number();
      const y3 = y0 + number();
      const hull = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
      const count = Math.min(64, Math.max(1, Math.ceil(hull / STEP)));
      for (let k = 1; k <= count; k++) {
        const t = k / count;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const e = 3 * u * t * t;
        const f = t * t * t;
        to(a * x0 + b * x1 + e * x2 + f * x3, a * y0 + b * y1 + e * y2 + f * y3);
      }
    } else if (command === 'z') {
      if (x !== startX || y !== startY) to(startX, startY);
      command = '';
    } else {
      throw new Error(`Pen path command ${command || d[i]} is not read here`);
    }
  }
  for (let k = first + 5; k < out.length; k += 9) out[k] = Math.max(length, 1e-3);
}

/** Every pen stroke in the mask's markup, as pieces (see trace). */
function pieces(mask: string) {
  const out: number[] = [];
  for (const [, width, group] of mask.matchAll(/<g stroke-width="([\d.]+)">([\s\S]*?)<\/g>/g)) {
    for (const [, tag] of group.matchAll(/<path\b([^>]*)>/g)) {
      const timing = /--d:\s*([\d.]+);\s*--t:\s*([\d.]+)/.exec(tag);
      const d = /\bd="([^"]*)"/.exec(tag);
      if (!timing || !d) throw new Error('A pen stroke without timing or path data');
      trace(d[1], +width / 2, +timing[1], +timing[2], out);
    }
  }
  if (!out.length) throw new Error('No pen strokes');
  return new Float32Array(out);
}

/**
 * For a cubic-bezier() easing, the share of its time it takes to reach a share of its progress.
 * `fallback` stands in for a value that is not one.
 */
function timeTo(value: string, fallback: number[]) {
  const numbers = value.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
  const [x1, y1, x2, y2] = numbers.length === 4 ? numbers : fallback;
  const bezier = (a: number, b: number, t: number) => 3 * (1 - t) * t * ((1 - t) * a + t * b) + t * t * t;
  return (progress: number) => {
    let low = 0;
    let high = 1;
    for (let k = 0; k < 24; k++) {
      const middle = (low + high) / 2;
      if (bezier(y1, y2, middle) < progress) low = middle;
      else high = middle;
    }
    return bezier(x1, x2, high);
  };
}

/**
 * The ms by which the pens have drawn all but the last thousandth of their length, with `pen`
 * giving the share of its time a stroke takes to draw each 255th of its length. After it the
 * last strokes only ease into their ends, which shows almost nothing (0.02 to 0.07% of the
 * pixels that change), and at the slow end of the drawing's pace it held a finished-looking
 * drawing still for nearly half a second. Those tips come with the last frame.
 */
function drawnBy(strokes: Float32Array, pen: Float32Array, last: number) {
  const lengths = new Float64Array(Math.ceil(last) + 1);
  let total = 0;
  for (let k = 0; k < strokes.length; k += 9) {
    const length = Math.hypot(strokes[k + 2] - strokes[k], strokes[k + 3] - strokes[k + 1]);
    const x = Math.min(1, (strokes[k + 4] + length / 2) / strokes[k + 5]) * 255;
    const i = Math.min(254, Math.floor(x));
    lengths[Math.round(strokes[k + 7] + strokes[k + 8] * (pen[i] + (pen[i + 1] - pen[i]) * (x - i)))] += length;
    total += length;
  }
  let sum = 0;
  for (let ms = 0; ms < lengths.length; ms++) if ((sum += lengths[ms]) >= DRAWN * total) return Math.max(1, ms);
  return last;
}

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const made = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(made, shader);
  }
  gl.linkProgram(made);
  if (!gl.getProgramParameter(made, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(made) ?? 'Shader link failed');
  return made;
}

function texture(gl: WebGL2RenderingContext, filter: number) {
  const made = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, made);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return made;
}

/** Where a canvas for the sketch goes: whole device pixels around the place the CSS gives it. */
interface Place {
  scale: number;
  left: number;
  bottom: number;
  width: number;
  height: number;
  /** The sketch inside the canvas, in its pixels: left, top, width, height. */
  art: [number, number, number, number];
}

function measure(probe: HTMLElement, layer: HTMLElement, largest = 8192): Place {
  const box = probe.getBoundingClientRect();
  const frame = layer.getBoundingClientRect();
  const scale = Math.min(devicePixelRatio, (largest - 1) / box.width, (largest - 1) / box.height, Math.sqrt(2 ** 24 / (box.width * box.height)));
  const left = Math.floor(box.left * scale + 1e-3);
  const top = Math.floor(box.top * scale + 1e-3);
  const width = Math.ceil(box.right * scale - 1e-3) - left;
  const height = Math.ceil(box.bottom * scale - 1e-3) - top;
  return {
    scale,
    left: left / scale - frame.left,
    bottom: frame.bottom - (top + height) / scale,
    width,
    height,
    art: [box.left * scale - left, box.top * scale - top, box.width * scale, box.height * scale],
  };
}

function fit(canvas: HTMLCanvasElement, place: Place) {
  canvas.width = place.width;
  canvas.height = place.height;
  Object.assign(canvas.style, {
    left: `${place.left}px`,
    bottom: `${place.bottom}px`,
    width: `${place.width / place.scale}px`,
    height: `${place.height / place.scale}px`,
  });
}

/** Turns the canvas's ink to `colour`, keeping how much of each pixel is inked. */
function tint(canvas: HTMLCanvasElement, colour: string) {
  const context = canvas.getContext('2d')!;
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = colour;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'source-over';
}

function paint(paper: HTMLCanvasElement, image: HTMLImageElement, place: Place, colour: string) {
  fit(paper, place);
  paper.getContext('2d')!.drawImage(image, ...place.art);
  tint(paper, colour);
}

/** The drawing in a WebGL canvas placed like the paper, from the paper's ink. Throws if it cannot be made. */
async function drawing(canvas: HTMLCanvasElement, paper: HTMLCanvasElement, mask: string, view: [number, number], place: Place) {
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) throw new Error('No WebGL 2');
  if (Math.max(place.width, place.height) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('Too large for a texture');
  fit(canvas, place);
  const { width, height } = place;
  const strokes = pieces(mask);
  let last = 1;
  for (let i = 7; i < strokes.length; i += 9) last = Math.max(last, strokes[i] + strokes[i + 1]);
  // Row 0 eases each pen; row 1, the drawing's clock up to where its lines are drawn.
  const tokens = getComputedStyle(document.documentElement);
  const pen = timeTo(tokens.getPropertyValue('--ease-in-out'), [0.65, 0, 0.35, 1]);
  const pace = timeTo(tokens.getPropertyValue('--ease-sketch'), [0.33, 0.62, 0.67, 0.85]);
  const eased = new Float32Array(512);
  for (let i = 0; i < 256; i++) eased[i] = pen(i / 255);
  const end = drawnBy(strokes, eased.subarray(0, 256), last);
  for (let i = 0; i < 256; i++) eased[256 + i] = pace(Math.min(1, ((i / 255) * last) / end));
  // A slow phone spends a while on that; taps and scrolling come first.
  await new Promise((resolve) => setTimeout(resolve));
  if (gl.isContextLost()) throw new Error('WebGL context lost');

  // The moment each pixel is inked: every pen's pieces, keeping the earliest.
  const times = program(gl, TIMES_VERTEX, TIMES_FRAGMENT);
  const ease = texture(gl, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 256, 2, 0, gl.RED, gl.FLOAT, eased);
  const moments = texture(gl, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  const target = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, target);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, moments, 0);
  const shape = gl.createVertexArray();
  gl.bindVertexArray(shape);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const each = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, each);
  gl.bufferData(gl.ARRAY_BUFFER, strokes, gl.STATIC_DRAW);
  for (const [location, size, offset] of [
    [1, 4, 0],
    [2, 2, 4],
    [3, 3, 6],
  ]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 36, offset * 4);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.useProgram(times);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, ease);
  gl.uniform1i(gl.getUniformLocation(times, 'ease'), 0);
  gl.uniform2f(gl.getUniformLocation(times, 'view'), view[0], view[1]);
  const [x, y, w, h] = place.art;
  gl.uniform4f(gl.getUniformLocation(times, 'place'), x / width, y / height, w / width, h / height);
  gl.uniform1f(gl.getUniformLocation(times, 'last'), last);
  gl.viewport(0, 0, width, height);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.MIN);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, strokes.length / 9);
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteBuffer(corners);
  gl.deleteBuffer(each);
  gl.deleteVertexArray(shape);
  gl.deleteFramebuffer(target);
  gl.deleteProgram(times);
  gl.deleteTexture(ease);

  // The paper's ink as it is: alpha only, its rows top first, nothing converted on the way.
  const inked = texture(gl, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, gl.ALPHA, gl.UNSIGNED_BYTE, paper);

  const frame = program(gl, FRAME_VERTEX, FRAME_FRAGMENT);
  gl.useProgram(frame);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, moments);
  gl.uniform1i(gl.getUniformLocation(frame, 'moments'), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, inked);
  gl.uniform1i(gl.getUniformLocation(frame, 'ink'), 1);
  gl.uniform1i(gl.getUniformLocation(frame, 'rows'), height);
  const now = gl.getUniformLocation(frame, 'now');
  const colour = gl.getUniformLocation(frame, 'tint');
  gl.bindVertexArray(gl.createVertexArray());
  if (gl.isContextLost()) throw new Error('WebGL context lost');

  return {
    /**
     * Draws a frame each time the browser paints, in the colour `tinted()` gives (an rgb()
     * value), until the sketch is done (true) or `alive()` turns false or the context is lost
     * (false).
     */
    play: (tinted: () => string, alive: () => boolean) =>
      new Promise<boolean>((resolve) => {
        let start: number | undefined;
        let painting = '';
        const draw = (time: number) => {
          if (!alive() || gl.isContextLost()) return resolve(false);
          start ??= time;
          const value = tinted();
          if (value !== painting && /^rgba?\(/.test(value)) {
            painting = value;
            const [r, g, b] = value.match(/[\d.]+/g)!.map(Number);
            gl.uniform3f(colour, r / 255, g / 255, b / 255);
          }
          const elapsed = time - start;
          gl.uniform1f(now, elapsed / last);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          if (elapsed < last) requestAnimationFrame(draw);
          else resolve(true);
        };
        requestAnimationFrame(draw);
      }),
    /** Gives the GPU's memory back. */
    release: () => {
      gl.deleteTexture(moments);
      gl.deleteTexture(inked);
      gl.deleteProgram(frame);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

/** The image a browser rasterizes the ink from: the SVG without its pen strokes. */
async function inkImage(source: string) {
  const url = URL.createObjectURL(new Blob([source.replace(/<mask[\s\S]*?<\/mask>/, '')], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Keeps the paper in the theme's colour and at the drawing's size while it is in the page. */
function keep(paper: HTMLCanvasElement, image: HTMLImageElement, probe: HTMLElement, layer: HTMLElement) {
  const colour = () => getComputedStyle(layer).color;
  let painted = colour();
  let following = 0;
  // A theme switch moves the layer's colour over a transition; follow it frame by frame.
  const follow = (until: number) => (time: number) => {
    if (!paper.isConnected) return;
    const now = colour();
    if (now !== painted) {
      painted = now;
      tint(paper, now);
    }
    if (time < until) following = requestAnimationFrame(follow(until));
  };
  const onTheme = () => {
    if (!paper.isConnected) return removeEventListener('themechange', onTheme);
    cancelAnimationFrame(following);
    following = requestAnimationFrame((time) => follow(time + 600)(time));
  };
  addEventListener('themechange', onTheme);

  // The window can change the drawing's size or place (not only its height, which the canvas
  // follows by its bottom edge). Until it settles the canvas follows the CSS, then it is
  // rasterized again at its new size.
  let place = measure(probe, layer);
  let settle = 0;
  const watch = new ResizeObserver(() => {
    if (!paper.isConnected) return watch.disconnect();
    const next = measure(probe, layer);
    if (next.width === place.width && next.height === place.height && next.scale === place.scale && Math.abs(next.left - place.left) < 0.5) {
      place = next;
      paper.style.bottom = `${next.bottom}px`;
      return;
    }
    for (const property of ['left', 'bottom', 'width', 'height'] as const) paper.style[property] = '';
    clearTimeout(settle);
    settle = window.setTimeout(() => {
      if (!paper.isConnected) return;
      place = measure(probe, layer);
      paint(paper, image, place, painted);
    }, 150);
  });
  watch.observe(layer);
  // A window moved to a screen of another density keeps its size: watch the density itself.
  const density = () =>
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        if (!paper.isConnected) return;
        paint(paper, image, (place = measure(probe, layer)), painted);
        density();
      },
      { once: true },
    );
  density();
}

/**
 * Shows the sketch in `source` in `layer`: drawn in when `draw` and the browser can, else at once.
 * `begin` runs when it starts to show, with the ms the drawing takes (0 when it shows at once).
 * Settles then. Stops quietly once `alive()` is false.
 */
export async function show(layer: HTMLElement, source: string, { draw, alive, begin }: { draw: boolean; alive: () => boolean; begin: (done: number) => void }) {
  const root = /<svg\b[^>]*>/.exec(source)?.[0] ?? '';
  const attribute = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(root)?.[1];
  const [, , width, height] = attribute('viewBox')!.split(' ').map(Number);
  layer.style.setProperty('--aspect', String(width / height));
  layer.style.setProperty('--face', attribute('data-face')!);
  const cut = attribute('data-cut');

  // An empty box with the canvas's rules says where the sketch goes, now and after the window changes.
  const probe = document.createElement('i');
  probe.className = 'sketch-probe';
  const paper = document.createElement('canvas');
  if (cut) paper.dataset.cut = cut;
  layer.classList.remove('is-leaving');
  layer.replaceChildren(probe);
  const image = await inkImage(source);
  if (!alive()) return;
  const colour = () => getComputedStyle(layer).color;

  if (draw) {
    const canvas = document.createElement('canvas');
    if (cut) canvas.dataset.cut = cut;
    try {
      const place = measure(probe, layer, 4096);
      paint(paper, image, place, colour());
      layer.append(canvas);
      const ink = await drawing(canvas, paper, /<mask[\s\S]*?<\/mask>/.exec(source)?.[0] ?? '', [width, height], place);
      if (!alive()) return ink.release();
      begin(Number(attribute('data-done')));
      void ink.play(colour, () => alive() && canvas.isConnected).then(() => {
        if (alive() && canvas.isConnected) {
          // The last frame and the paper hold the same pixels.
          tint(paper, colour());
          canvas.replaceWith(paper);
          keep(paper, image, probe, layer);
        }
        ink.release();
      });
      return;
    } catch {
      canvas.remove();
      if (!alive()) return;
    }
  }
  // At once: the layer's own transition fades it in.
  paint(paper, image, measure(probe, layer), colour());
  layer.classList.add('is-leaving');
  layer.append(paper);
  void getComputedStyle(layer).opacity;
  layer.classList.remove('is-leaving');
  keep(paper, image, probe, layer);
  begin(0);
}
