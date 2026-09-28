/**
 * Springs. A value moves toward its target under x'' = -k(x - target) - c·x'. Retargeting
 * keeps the current velocity, so an interrupted motion curves toward the new goal rather
 * than starting over from rest.
 */

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
export const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

export interface SpringConfig {
  stiffness: number;
  damping: number;
  /** Settling threshold, in the value's own units. */
  precision?: number;
}

// Same constants as the CSS tokens (--spring-*), so JS-driven and CSS-driven motion agree.
export const SNAPPY: SpringConfig = { stiffness: 520, damping: 36 };
export const SMOOTH: SpringConfig = { stiffness: 280, damping: 32 };
export const BOUNCY: SpringConfig = { stiffness: 380, damping: 20 };
export const GENTLE: SpringConfig = { stiffness: 170, damping: 26 };

const running = new Set<Spring>();
let frame = 0;
let last = 0;

function tick(now: number) {
  const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
  last = now;
  for (const spring of running) spring.step(dt);
  frame = running.size ? requestAnimationFrame(tick) : 0;
}

export class Spring {
  value: number;
  target: number;
  velocity = 0;

  constructor(
    value: number,
    private readonly apply: (value: number) => void,
    public config: SpringConfig = SNAPPY,
  ) {
    this.value = this.target = value;
  }

  get moving() {
    return running.has(this);
  }

  to(target: number, config?: SpringConfig) {
    if (config) this.config = config;
    this.target = target;
    if (reducedMotion.matches) return this.set(target);
    if (this.value === target && !this.velocity) return;
    running.add(this);
    if (!frame) {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  /** Freezes the spring where it is. */
  stop() {
    running.delete(this);
    this.target = this.value;
    this.velocity = 0;
  }

  set(value: number) {
    running.delete(this);
    this.value = this.target = value;
    this.velocity = 0;
    this.apply(value);
  }

  /** Semi-implicit Euler in 1/240 s substeps: stable and cheap at these stiffnesses. */
  step(dt: number) {
    const { stiffness: k, damping: c, precision = 0.01 } = this.config;
    for (let t = dt; t > 0; t -= 1 / 240) {
      const h = Math.min(t, 1 / 240);
      this.velocity += (-k * (this.value - this.target) - c * this.velocity) * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.velocity) < precision * 10 && Math.abs(this.value - this.target) < precision) {
      this.value = this.target;
      this.velocity = 0;
      running.delete(this);
    }
    this.apply(this.value);
  }
}

/**
 * The same spring as a CSS `linear()` easing plus the time it takes to settle, for
 * compositor-driven animations (WAAPI). Sampled from the closed-form solution.
 */
const easings = new Map<SpringConfig, { easing: string; duration: number }>();

export function springEasing(config: SpringConfig) {
  const hit = easings.get(config);
  if (hit) return hit;
  const { stiffness: k, damping: c } = config;
  const w0 = Math.sqrt(k);
  const zeta = c / (2 * w0);
  const x = (t: number) => {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  };
  let settle = 0;
  for (let t = 0; t < 3; t += 0.002) if (Math.abs(x(t) - 1) > 0.002) settle = t;
  const duration = Math.ceil(settle * 1000);
  const n = Math.max(20, Math.round(settle * 60));
  const points = Array.from({ length: n + 1 }, (_, i) => (i === n ? 1 : +x((i / n) * settle).toFixed(4)));
  const out = { easing: `linear(${points.join(', ')})`, duration };
  easings.set(config, out);
  return out;
}

/** WAAPI with a spring easing. Reduced motion collapses it to the end state. */
export function springAnimate(el: Element, keyframes: Keyframe[], config: SpringConfig = SMOOTH, options: KeyframeAnimationOptions = {}) {
  const { easing, duration } = springEasing(config);
  return el.animate(keyframes, { easing, duration: reducedMotion.matches ? 0 : duration, ...options });
}

/* Scrolling ---------------------------------------------------------------- */

let cancelScroll: (() => void) | undefined;

/**
 * Glides the page to `y` on a critically damped spring. Any wheel, touch or key press
 * hands control straight back to the reader (and `done` is not called).
 */
export function scrollToY(y: number, done?: () => void) {
  const max = document.documentElement.scrollHeight - innerHeight;
  const target = Math.max(0, Math.min(max, Math.round(y)));
  cancelScroll?.();
  if (reducedMotion.matches || Math.abs(target - scrollY) < 2) {
    scrollTo({ top: target, behavior: 'instant' });
    done?.();
    return;
  }
  // Long jumps start close by, so the spring spends its time on the arrival, not the trip.
  const far = innerHeight * 1.5;
  const start = Math.abs(target - scrollY) > far ? target - Math.sign(target - scrollY) * far : scrollY;
  let active = true;
  const cleanup = () => {
    active = false;
    removeEventListener('wheel', cancel);
    removeEventListener('touchstart', cancel);
    removeEventListener('keydown', cancel);
    cancelScroll = undefined;
  };
  const cancel = () => {
    if (!active) return;
    cleanup();
    spring.stop();
  };
  const spring = new Spring(
    start,
    (v) => {
      scrollTo({ top: v, behavior: 'instant' });
      if (active && !spring.moving) {
        cleanup();
        done?.();
      }
    },
    { stiffness: 170, damping: 26, precision: 0.5 },
  );
  addEventListener('wheel', cancel, { passive: true });
  addEventListener('touchstart', cancel, { passive: true });
  addEventListener('keydown', cancel);
  cancelScroll = cancel;
  if (start !== scrollY) scrollTo({ top: start, behavior: 'instant' });
  spring.to(target);
}

/** Document-space top of an element, for scroll targets. */
export const pageTop = (el: Element) => el.getBoundingClientRect().top + scrollY;

/** Where a heading should land: just below the header. */
export const headingTarget = (el: Element) => pageTop(el) - parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop || '0');
