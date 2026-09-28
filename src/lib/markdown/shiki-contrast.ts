import type { ShikiTransformer } from '@shikijs/types';

// Code block backgrounds: --code-bg in prose.css, which is --raised in tokens.css.
const BACKGROUND = { light: '#fbfaf6', dark: '#221f1b' } as const;
const MIN_CONTRAST = 4.6; // a hair above AA so rounding in audit tools never dips below 4.5

type RGB = [number, number, number];

function parse(hex: string): { rgb: RGB; alpha: number } | undefined {
  const h = hex.replace('#', '');
  const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[\da-f]{6}([\da-f]{2})?$/i.test(full)) return;
  const n = full.match(/../g)!.map((x) => parseInt(x, 16));
  return { rgb: [n[0], n[1], n[2]], alpha: n.length > 3 ? n[3] / 255 : 1 };
}

const toHex = (rgb: RGB) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

function luminance([r, g, b]: RGB) {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;

/** Nudges a token colour toward black/white until it reads at WCAG AA against the code background. */
function readable(color: string, background: string): string {
  const fg = parse(color);
  const bg = parse(background)!.rgb;
  if (!fg) return color;
  let rgb = mix(bg, fg.rgb, fg.alpha);
  if (contrast(rgb, bg) >= MIN_CONTRAST) return fg.alpha < 1 ? toHex(rgb) : color;
  const target: RGB = luminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let t = 0.02; t <= 1; t += 0.02) {
    const next = mix(rgb, target, t);
    if (contrast(next, bg) >= MIN_CONTRAST) {
      rgb = next;
      break;
    }
  }
  return toHex(rgb);
}

const cache = new Map<string, string>();

function fixStyle(style: unknown): unknown {
  if (typeof style !== 'string') return style;
  return style.replace(/--shiki-(light|dark):(#[\da-f]+)/gi, (_, theme: 'light' | 'dark', color: string) => {
    const key = `${theme}${color}`;
    let out = cache.get(key);
    if (!out) cache.set(key, (out = readable(color, BACKGROUND[theme])));
    return `--shiki-${theme}:${out}`;
  });
}

export const shikiContrast = (): ShikiTransformer => ({
  name: 'readable-contrast',
  pre(node) {
    node.properties.style = fixStyle(node.properties.style) as string;
  },
  span(node) {
    node.properties.style = fixStyle(node.properties.style) as string;
  },
});
