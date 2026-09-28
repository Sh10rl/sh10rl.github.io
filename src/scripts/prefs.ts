import { setTheme, themePreference, type ThemePreference } from './theme';

const root = document.documentElement;
type Size = 's' | 'm' | 'l' | 'xl';
const currentSize = () => (root.dataset.size as Size | undefined) ?? 'm';

/** Changes the size without losing your place: the paragraph at the reading line stays put. */
function setSize(size: Size) {
  const line = innerHeight * 0.3;
  const blocks = [...document.querySelectorAll<HTMLElement>('[data-article] > *')];
  const anchor = blocks.find((el) => el.getBoundingClientRect().bottom > line);
  const before = anchor?.getBoundingClientRect();
  // The point of the anchor under the reading line (or its top, if it starts below the line).
  const ratio = before && before.top < line ? (line - before.top) / Math.max(1, before.height) : 0;
  const at = before && before.top < line ? line : (before?.top ?? 0);
  if (size === 'm') delete root.dataset.size;
  else root.dataset.size = size;
  try {
    if (size === 'm') localStorage.removeItem('text-size');
    else localStorage.setItem('text-size', size);
  } catch {}
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    scrollTo({ top: scrollY + r.top + ratio * r.height - at, behavior: 'instant' });
  }
  dispatchEvent(new Event('textsizechange'));
}

/** A paper thumb slides beneath the chosen segment. */
function segmented(group: HTMLElement, value: () => string, choose: (v: string, button: HTMLElement) => void) {
  const thumb = group.querySelector<HTMLElement>('.seg-thumb')!;
  const buttons = [...group.querySelectorAll<HTMLElement>('button[data-value]')];
  thumb.style.width = `calc((100% - 0.375rem) / ${buttons.length})`;
  let selected = value();
  const sync = (instant: boolean, next = value()) => {
    selected = next;
    const on = buttons.find((b) => b.dataset.value === selected) ?? buttons[0];
    buttons.forEach((b) => b.setAttribute('aria-checked', String(b === on)));
    thumb.style.transition = instant ? 'none' : '';
    thumb.style.translate = `${buttons.indexOf(on) * 100}% 0`;
  };
  group.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button[data-value]');
    if (!b || b.dataset.value === selected) return;
    choose(b.dataset.value!, b);
    sync(false, b.dataset.value);
  });
  // Arrow keys move the choice, as in any radio group.
  group.addEventListener('keydown', (e) => {
    const i = buttons.findIndex((b) => b.dataset.value === selected);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = buttons[(i + step + buttons.length) % buttons.length];
    choose(next.dataset.value!, next);
    next.focus();
    sync(false, next.dataset.value);
  });
  return sync;
}

export function initPrefs() {
  const panel = document.getElementById('ReadingPrefs');
  if (!panel) return;
  let lastY = scrollY;
  const sizeGroup = panel.querySelector<HTMLElement>('[data-group="size"]')!;
  const themeGroup = panel.querySelector<HTMLElement>('[data-group="theme"]')!;
  const syncSize = segmented(sizeGroup, currentSize, (v) => {
    setSize(v as Size);
    lastY = scrollY;
  });
  const syncTheme = segmented(themeGroup, themePreference, (v) => setTheme(v as ThemePreference));
  addEventListener('themechange', () => syncTheme(false));

  let opener: HTMLElement | null = null;
  document.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLElement>('[data-prefs-open]');
    if (!button) return;
    if (panel.matches(':popover-open') && opener === button) return;
    opener = button;
    // Hang it from the button that opened it, and grow out of that button.
    const r = button.getBoundingClientRect();
    const w = parseFloat(getComputedStyle(panel).width);
    const left = Math.min(root.clientWidth - w - 12, Math.max(12, r.left + r.width / 2 - w / 2));
    const top = r.bottom + 10;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.setProperty('--origin', `${r.left + r.width / 2 - left}px -10px`);
    syncSize(true);
    syncTheme(true);
  });
  panel.addEventListener('toggle', (e) => {
    const open = (e as ToggleEvent).newState === 'open';
    document.querySelectorAll('[data-prefs-open]').forEach((b) => b.setAttribute('aria-expanded', String(open && b === opener)));
    if (open) panel.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  });
  // Scrolling well away from it puts the panel away.
  panel.addEventListener('toggle', () => (lastY = scrollY));
  addEventListener('scroll', () => panel.matches(':popover-open') && Math.abs(scrollY - lastY) > 80 && panel.hidePopover(), { passive: true });
}
