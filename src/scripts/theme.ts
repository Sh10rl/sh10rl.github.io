import { reducedMotion, SMOOTH, Spring } from './motion';

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

const root = document.documentElement;
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const forcedColors = matchMedia('(forced-colors: active)');
const THEME_COLOR: Record<Theme, string> = { light: '#f3f0e8', dark: '#161311' };

/**
 * The reader's choice. The page shows it in data-theme, which is always set (Base.astro sets it
 * before the first frame), so a change of the system theme shows only when this script fades it in.
 */
let wanted: ThemePreference = 'system';
try {
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') wanted = stored;
} catch {}

export const currentTheme = (): Theme => (wanted === 'system' ? (darkQuery.matches ? 'dark' : 'light') : wanted);
export const themePreference = (): ThemePreference => wanted;

function syncThemeColor(colour = THEME_COLOR[currentTheme()]) {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => (meta.content = colour));
}

/** Puts the wanted theme on the page; whatever paints in theme colours listens for themechange. */
function render() {
  root.dataset.theme = currentTheme();
  syncThemeColor();
  dispatchEvent(new Event('themechange'));
}

export function setTheme(pref: ThemePreference) {
  const from = root.dataset.theme;
  wanted = pref;
  try {
    if (pref === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', pref);
  } catch {}
  if (currentTheme() === from) render();
  else if (from === 'dark') dawn();
  else dusk();
}

/** The header toggle flips the look; choosing what the system already shows clears the override. */
export function toggleTheme() {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next === (darkQuery.matches ? 'dark' : 'light') ? 'system' : next);
}

/* Light to dark ----------------------------------------------------------------- */

let crossfade: ViewTransition | undefined;

/** Shows the wanted theme, whichever it is by now, and ends a fade to light if it is dark. */
function settle() {
  if (currentTheme() === 'dark') stopDawn();
  render();
}

/** Going darker never dazzles: the browser cross-fades a still of the page into the new look, quickly. */
function dusk() {
  crossfade?.skipTransition();
  if (!('startViewTransition' in document) || document.hidden) return settle();
  const transition = (crossfade = document.startViewTransition(settle));
  transition.finished.finally(() => {
    if (crossfade === transition) crossfade = undefined;
  });
}

/* Dark to light ----------------------------------------------------------------- */

const layer = document.querySelector<HTMLElement>('[data-dawn]');
const hud = layer?.querySelector<HTMLElement>('.dawn-hud');
const capsule = document.querySelector<HTMLElement>('[data-capsule]');
/** How long the rest of the fade takes once the reader asks for the light at once. */
const SKIP = 200;
/** The pill's shape: the theme button's circle at its round end, or the whole pill. */
const BUTTON = 'inset(0 0 0 calc(100% - 2.25rem) round 1.125rem)';
const WHOLE = 'inset(0 round 1.125rem)';
/** How long the pill takes to grow out of its button, fast and then ever slower (--ease-out). */
const GROW = 560;
/**
 * How long it takes to go back into it on the same curve: slow enough that SKIP after it sets off,
 * when a sun that was still coming up is up, it is still two and a half times the button's width.
 */
const RETRACT = 1100;
/** The fade's animations while it runs, and the pill's way back into its button once it goes. */
let rising: Animation[] | undefined;
let leaving: Animation | undefined;
/**
 * The pill's width, eased with the same spring as the header's own change of width so the two
 * change together; its least width, which fits its bar or its offer; and the frame that keeps it in
 * place.
 */
const pillWidth = new Spring(0, (value) => hud?.style.setProperty('--width', `${value}px`), SMOOTH);
let narrowest = 0;
let tracking = 0;

const forget = () => {
  try {
    sessionStorage.removeItem('dawn');
  } catch {}
};

/** The page turns light at once, under a veil that keeps it as dark as it was; then the veil lifts. */
function dawn() {
  crossfade?.skipTransition();
  render();
  lift(0);
}

/**
 * Lays the pill over the header's tools, its round end on the theme button and its sun on the
 * button's icon, so that the two are one. On an article's reading face, the button that opens the
 * display settings stands in for the theme button. The pill rides the header's right end, where
 * both buttons sit, so when the header grows or shrinks between its faces the pill goes with it,
 * frame for frame, and takes on the width of the face the header is turning to.
 */
function place() {
  const face = capsule?.querySelector<HTMLElement>(`[data-face="${capsule.dataset.state}"]`);
  const button = face?.querySelector<HTMLElement>('[data-theme-toggle]') ?? face?.querySelector<HTMLElement>('[data-prefs-open]');
  if (!layer || !hud || !capsule || !face || !button) return;
  const header = capsule.getBoundingClientRect();
  const box = button.getBoundingClientRect();
  // The button is the last thing in its face, so once the header has settled it stops this far
  // short of the header's end. (Measured in layout terms, a growing header would not yet hold the
  // long face, and the button would sit past its end.)
  const end = parseFloat(getComputedStyle(face).paddingRight);
  // As tall as a desktop button: the phone bar's taller buttons leave it a margin all round.
  const inset = (button.offsetHeight - hud.offsetHeight) / 2;
  // From the layer's right edge, which stops short of a scroll bar's gutter as the header does.
  hud.style.setProperty('--right', `${layer.clientWidth - header.right + end + inset}px`);
  hud.style.setProperty('--top', `${(box.top + box.bottom - hud.offsetHeight) / 2}px`);
  const width = Math.max(narrowest, (button.closest<HTMLElement>('.actions') ?? button).offsetWidth - 2 * inset);
  if (Math.abs(pillWidth.target - width) > 0.5) pillWidth.to(width);
}

// The header's width moves on a spring of its own: after each of its steps, once laid out and
// before it is painted, the pill moves with it.
if (capsule) new ResizeObserver(() => layer?.matches(':popover-open') && place()).observe(capsule);

/**
 * Every frame while the pill is up: keeps it in place as the header changes face or slides away
 * (out of sight while the header is), and the browser's own bars in the paper's colour.
 */
function track() {
  cancelAnimationFrame(tracking);
  const step = () => {
    if (!layer?.matches(':popover-open')) return;
    place();
    hud!.toggleAttribute('data-away', !!capsule?.hasAttribute('data-reading-hidden'));
    if (rising) syncThemeColor(getComputedStyle(root).backgroundColor);
    tracking = requestAnimationFrame(step);
  };
  step();
}

/**
 * Lifts the veil (styles: "Dawn" in global.css), starting `at` ms into the fade. The page beneath
 * is live throughout; only the pill takes the pointer.
 */
function lift(at: number) {
  if (rising || !layer || !hud) return;
  const css = getComputedStyle(root);
  const time = css.getPropertyValue('--dawn-time');
  const duration = parseFloat(time) * (time.trim().endsWith('ms') ? 1 : 1000);
  if (document.hidden || forcedColors.matches || !(at >= 0 && at < duration)) return forget();
  const veil = parseFloat(css.getPropertyValue('--dawn-veil'));
  const easing = css.getPropertyValue('--ease-dawn').trim();
  const out = css.getPropertyValue('--ease-out').trim();
  const easeIn = css.getPropertyValue('--ease-in').trim();
  const paper = css.backgroundColor;
  // The same paper under the veil, which lets 1 − veil of each channel through.
  const dimmed = `rgb(${paper.match(/[\d.]+/g)!.slice(0, 3).map((c) => +c * (1 - veil)).join(', ')})`;
  const part = (name: string) => layer.querySelector<HTMLElement>(`.dawn-${name}`)!;
  for (const a of hud.getAnimations({ subtree: true })) a.cancel();
  leaving = undefined;
  hud.inert = false;
  hud.style.removeProperty('--offer');
  if (!layer.matches(':popover-open')) layer.showPopover();
  // Its least width is its own content's: measured with no width asked of it.
  hud.style.setProperty('--width', '0px');
  narrowest = hud.offsetWidth;
  place();
  pillWidth.set(pillWidth.target);
  const timing: KeyframeAnimationOptions = { duration, fill: 'both' };
  const still = reducedMotion.matches;
  const parts = [
    part('veil').animate({ opacity: [veil, 0] }, { ...timing, easing }),
    // The paper a browser shows past the page's ends and beside its scroll bar dims with the page.
    root.animate({ backgroundColor: [dimmed, paper] }, { ...timing, easing }),
    part('fill').animate({ translate: ['-100% 0', '0 0'] }, timing),
    // The theme button's moon sets behind a horizon, the sun comes up over it, the horizon fades
    // and the rays open: the sun is up as the brightening slows, the rays open as it settles.
    part('horizon').animate({ opacity: [0, 1, 1, 0, 0], offset: [0, 0.06, 0.62, 0.78, 1] }, timing),
    part('rays').animate(
      still
        ? { opacity: [0, 0, 1], offset: [0, 0.66, 1] }
        : { opacity: [0, 0, 1], scale: [0.5, 0.5, 1], rotate: ['-45deg', '-45deg', '0deg'], offset: [0, 0.66, 1], easing: ['linear', out, 'linear'] },
      timing,
    ),
    part('moon').animate(
      still
        ? { opacity: [1, 0, 0], offset: [0, 0.08, 1] }
        : { opacity: [1, 1, 0, 0], translate: ['0 0', '0 17px', '0 17px', '0 17px'], offset: [0, 0.11, 0.12, 1], easing: [easeIn, 'linear', 'linear', 'linear'] },
      timing,
    ),
    part('disc').animate(
      still
        ? { opacity: [0, 0, 1, 1], offset: [0, 0.08, 0.2, 1] }
        : // It peeks over the horizon as soon as the moon is down, and slows near the top.
          { translate: ['0 13px', '0 13px', '0 0', '0 0'], offset: [0, 0.1, 0.62, 1], easing: ['linear', 'cubic-bezier(0.61, 1, 0.88, 1)', 'linear', 'linear'] },
      timing,
    ),
  ];
  for (const a of parts) a.currentTime = at;
  // The theme button grows into the pill, fast and then ever slower. On a page that goes on with a
  // fade, the pill has already grown: it is back where it was, at once.
  if (at > 0) hud.animate([{ offset: 0, opacity: 0 }], { duration: 160, easing: out });
  else if (!still) hud.animate({ clipPath: [BUTTON, WHOLE] }, { duration: GROW, easing: out });

  rising = parts;
  // A link followed before the end: the next page goes on with the fade (Base.astro).
  try {
    sessionStorage.setItem('dawn', String(Date.now() - at));
  } catch {}
  parts[0].finished.then(() => rising === parts && end(), () => {});
  track();
}

/** At full light the pill stays a moment, then goes back into the theme button. */
function end() {
  for (const a of rising!) a.cancel();
  rising = undefined;
  forget();
  syncThemeColor();
  if (leaving?.playState === 'finished') layer!.hidePopover();
  else retract(450);
}

/**
 * The pill goes back into its button, fast and then ever slower, and melts into the header: its bar
 * or offer goes at once, and its dark glass clears on the way in, so the pill is gone by the time it
 * nears the button's size. The layer goes once the light is full as well.
 */
function retract(delay: number) {
  if (!hud || leaving) return;
  // From here on a click is meant for the header's own buttons, which the pill is about to show.
  hud.inert = true;
  const css = getComputedStyle(root);
  const timing: KeyframeAnimationOptions = { delay, easing: css.getPropertyValue('--ease-out').trim(), fill: 'forwards' };
  if (!reducedMotion.matches) {
    // The wait is held in the keyframes: Chrome draws a clip-path animation that has a delay as a
    // jump to its end.
    hud.animate([{ clipPath: WHOLE }, { offset: delay / (delay + RETRACT), clipPath: WHOLE, easing: timing.easing }, { clipPath: BUTTON }], {
      duration: delay + RETRACT,
      fill: 'forwards',
    });
    hud.querySelector('.dawn-swap')!.animate({ opacity: 0 }, { ...timing, duration: 160 });
  }
  // The glass clears once the sun is up and while the pill is still about twice the button's
  // width, from what the pill shows now: nothing, while the header has slid away.
  const exit = (leaving = hud.animate(
    { opacity: 0 },
    { ...timing, delay: delay + SKIP, duration: 130, easing: css.getPropertyValue('--ease-in-out').trim() },
  ));
  exit.finished.then(() => !rising && leaving === exit && layer!.hidePopover(), () => {});
}

/** The reader would rather not wait: the rest of the fade, quickly, and the pill sets off back at the click. */
function skip() {
  if (!rising) return;
  const [veil] = rising;
  const left = Number(veil.effect!.getComputedTiming().endTime) - Number(veil.currentTime);
  const rate = Math.max(1, left / SKIP);
  for (const a of rising) a.updatePlaybackRate(rate);
  // It goes as it is: the offer stays put rather than turning back into the bar under the pointer.
  hud!.style.setProperty('--offer', getComputedStyle(hud!).getPropertyValue('--offer'));
  retract(0);
}

/** Takes the veil and the pill away at once. */
function stopDawn() {
  if (!layer) return;
  rising?.forEach((a) => a.cancel());
  rising = undefined;
  forget();
  for (const a of hud?.getAnimations({ subtree: true }) ?? []) a.cancel();
  leaving = undefined;
  if (layer.matches(':popover-open')) layer.hidePopover();
}

/* Wiring ------------------------------------------------------------------------- */

darkQuery.addEventListener('change', () => {
  if (wanted !== 'system' || root.dataset.theme === currentTheme()) return;
  if (darkQuery.matches) dusk();
  else dawn();
});

hud?.addEventListener('click', skip);

// Whatever opens over the veil (a popover, a dialog) goes back under it before it is painted, so
// nothing shows brighter than the page around it. Not sooner: no popover may open while another
// one is opening.
document.addEventListener(
  'beforetoggle',
  (e) => {
    if (!rising || e.target === layer || (e as ToggleEvent).newState !== 'open') return;
    requestAnimationFrame(() => {
      if (!rising || !layer?.matches(':popover-open')) return;
      layer.hidePopover();
      layer.showPopover();
    });
  },
  true,
);

// Back on a page the browser kept in memory, its fade is long over.
addEventListener('pageshow', (e) => {
  if (e.persisted) skip();
});

syncThemeColor();

// Base.astro has gone on with a fade that a link cut short; the veil here takes over from its own.
if (root.dataset.dawning !== undefined) {
  delete root.dataset.dawning;
  root.style.removeProperty('--dawn-at');
  let start = NaN;
  try {
    start = Number(sessionStorage.getItem('dawn'));
  } catch {}
  lift(Date.now() - start);
}
