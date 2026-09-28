import { finePointer, reducedMotion, SMOOTH, SNAPPY, Spring, springAnimate } from './motion';
import { markUnread, readMarks } from './reading';

const ICON_BOOKMARK =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 3a2 2 0 0 1 2 2v16l-7-4-7 4V5a2 2 0 0 1 2-2Z"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/* Where you left off, on each entry --------------------------------------- */

function markProgress(list: HTMLElement) {
  const marks = readMarks();
  for (const entry of list.querySelectorAll<HTMLElement>('.entry')) {
    const mark = marks[entry.dataset.path ?? ''];
    const state = entry.querySelector<HTMLElement>('[data-state]');
    if (!state) continue;
    state.hidden = true;
    delete state.dataset.done;
    state.replaceChildren();
    if (!mark || mark.u || (!mark.d && mark.p < 0.06)) continue;
    if (mark.d) {
      state.dataset.done = '';
      state.innerHTML = `${ICON_CHECK}Read`;
      state.title = 'Read · Mark as unread';
    } else {
      state.innerHTML = `${ICON_BOOKMARK}${Math.round(mark.p * 100)}%`;
      state.title = `${Math.round(mark.p * 100)}% read · Mark as unread`;
    }
    state.hidden = false;
  }
}

/* One hover sheet for the whole list -------------------------------------- */

function hoverSheet(list: HTMLElement) {
  if (!finePointer.matches) return;
  list.classList.add('live');
  const sheet = document.createElement('span');
  sheet.className = 'entry-hover';
  sheet.setAttribute('aria-hidden', 'true');
  list.prepend(sheet);

  const y = new Spring(0, (v) => (sheet.style.translate = `0 ${v.toFixed(2)}px`), SNAPPY);
  const h = new Spring(0, (v) => (sheet.style.height = `${v.toFixed(2)}px`), SNAPPY);
  let current: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const show = (entry: HTMLElement) => {
    clearTimeout(hideTimer);
    if (entry === current) return;
    const top = entry.getBoundingClientRect().top - list.getBoundingClientRect().top;
    const height = entry.offsetHeight;
    // Appearing from nothing: start in place. Moving between rows: glide.
    if (!sheet.classList.contains('on')) {
      y.set(top);
      h.set(height);
    } else {
      y.to(top);
      h.to(height);
    }
    current = entry;
    sheet.classList.add('on');
  };
  const hide = () => {
    current = null;
    sheet.classList.remove('on');
  };

  list.addEventListener('pointerover', (e) => {
    const entry = (e.target as Element).closest<HTMLElement>('.entry');
    if (entry) show(entry);
  });
  list.addEventListener('pointerleave', () => {
    hideTimer = setTimeout(hide, 60);
  });
  list.addEventListener('focusin', (e) => {
    const entry = (e.target as Element).closest<HTMLElement>('.entry');
    if (entry) show(entry);
  });
  list.addEventListener('focusout', () => {
    hideTimer = setTimeout(hide, 60);
  });
  return hide;
}

/* Category tabs that filter in place -------------------------------------- */

function tabs(bar: HTMLElement, list: HTMLElement, hideHover?: () => void) {
  const links = [...bar.querySelectorAll<HTMLAnchorElement>('a[data-filter]')];
  if (!links.length) return;

  // A second copy of the labels, light on dark and clipped to the chip. As the chip slides,
  // each label turns light only where the chip covers it.
  const ink = document.createElement('div');
  ink.className = 'tabs-ink';
  ink.setAttribute('aria-hidden', 'true');
  for (const a of links) {
    const span = document.createElement('span');
    span.innerHTML = a.querySelector('.tab-label')!.outerHTML + a.querySelector('.tab-count')!.outerHTML;
    ink.append(span);
  }
  bar.append(ink);
  bar.classList.add('live');

  let x0 = 0;
  let w0 = 0;
  let total = 0;
  const geometry = new Map<HTMLAnchorElement, { left: number; width: number }>();
  const paint = () => {
    ink.style.clipPath = `inset(0 ${(total - x0 - w0).toFixed(2)}px 0 ${x0.toFixed(2)}px round var(--r-pill))`;
  };
  const x = new Spring(0, (v) => {
    x0 = v;
    paint();
  }, SNAPPY);
  const w = new Spring(0, (v) => {
    w0 = v;
    paint();
  }, SNAPPY);

  const place = (a: HTMLAnchorElement, instant: boolean) => {
    const { left, width } = geometry.get(a)!;
    if (instant) {
      x.set(left);
      w.set(width);
    } else {
      x.to(left);
      w.to(width);
    }
  };

  const current = () => links.find((a) => a.hasAttribute('aria-current')) ?? links[0];
  const measure = () => {
    total = ink.scrollWidth;
    const origin = links[0].offsetLeft;
    for (const a of links) geometry.set(a, { left: a.offsetLeft - origin, width: a.offsetWidth });
    place(current(), true);
  };
  measure();
  new ResizeObserver(measure).observe(bar);
  document.fonts?.ready.then(measure);

  const entries = [...list.querySelectorAll<HTMLElement>('.entry')];
  const years = [...list.querySelectorAll<HTMLElement>('.year')];
  const labels = years.map((year) => year.querySelector<HTMLElement>('.year-label')!);
  const visible = (el: HTMLElement) => !el.hidden && !el.closest<HTMLElement>('.year')?.hidden;
  let animations: Animation[] = [];
  const stopAnimations = () => {
    animations.forEach((animation) => animation.cancel());
    animations = [];
  };
  const track = (animation: Animation) => {
    animations.push(animation);
    return animation;
  };
  const apply = (a: HTMLAnchorElement, push: boolean) => {
    const key = a.dataset.filter ?? '';
    const wanted = (e: HTMLElement) => !key || e.dataset.cat === key;
    const entering = entries.filter((e) => e.hidden && wanted(e));
    const stay = [...entries.filter(wanted), ...labels].filter(visible);
    // Retarget from the current visual position, including an interrupted animation.
    const before = new Map(reducedMotion.matches ? [] : stay.map((e) => [e, {
      top: e.getBoundingClientRect().top + scrollY,
      opacity: Number(getComputedStyle(e).opacity),
    }] as const));
    stopAnimations();
    entries.forEach((entry) => entry.removeAttribute('data-reveal'));
    links.forEach((l) => (l === a ? l.setAttribute('aria-current', 'page') : l.removeAttribute('aria-current')));
    place(a, false);
    a.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    if (push) history.pushState({ filter: key }, '', a.href);
    document.title = a.dataset.title ?? document.title;
    hideHover?.();

    // Commit the filter before animating so every click sees the current results.
    for (const e of entries) e.hidden = !wanted(e);
    for (const y of years) y.hidden = !y.querySelector('.entry:not([hidden])');
    if (reducedMotion.matches) return;
    // Finish all layout reads before starting any animation.
    const moves = [...before].filter(([e]) => visible(e)).map(([e, from]) => [e, from.top - e.getBoundingClientRect().top - scrollY, from.opacity] as const);
    for (const [e, dy, opacity] of moves) {
      if (Math.abs(dy) > 0.5 || opacity < 1) {
        track(springAnimate(e, [{ opacity, transform: `translateY(${dy}px)` }, { opacity: 1, transform: 'none' }], SMOOTH));
      }
    }
    // Rows and year labels animate separately to avoid translating rows twice.
    entering.forEach((e, i) => {
      track(springAnimate(e, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], SMOOTH, {
        delay: Math.min(i, 8) * 28,
        fill: 'backwards',
      }));
    });
    for (const label of labels) {
      if (visible(label) && !before.has(label)) track(springAnimate(label, [{ opacity: 0 }, { opacity: 1 }], SMOOTH));
    }
  };

  bar.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-filter]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (a.hasAttribute('aria-current')) return;
    apply(a, true);
  });

  addEventListener('popstate', () => {
    const a = links.find((l) => new URL(l.href).pathname === location.pathname);
    if (a && !a.hasAttribute('aria-current')) apply(a, false);
  });
}

export function initIndex() {
  const list = document.querySelector<HTMLElement>('[data-entries]');
  if (!list) return;
  markProgress(list);
  list.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-mark-unread]');
    if (!button?.dataset.markUnread) return;
    if (markUnread(button.dataset.markUnread)) button.closest('.entry')?.querySelector<HTMLAnchorElement>('.entry-link')?.focus({ preventScroll: true });
  });
  addEventListener('readingreset', () => markProgress(list));
  addEventListener('pageshow', () => markProgress(list));
  addEventListener('storage', (event) => {
    if (event.key === 'reading' || event.key === null) markProgress(list);
  });
  const hideHover = hoverSheet(list);
  const bar = document.querySelector<HTMLElement>('[data-tabs]');
  if (bar) tabs(bar, list, hideHover);
}
