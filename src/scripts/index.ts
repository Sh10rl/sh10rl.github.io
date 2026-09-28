import { reducedMotion, SNAPPY, Spring } from './motion';

/* One hover sheet for the whole list -------------------------------------- */

function hoverSheet(list: HTMLElement) {
  const hover = matchMedia('(min-width: 40.0625rem) and (hover: hover) and (pointer: fine)');
  if (!hover.matches) return;
  list.classList.add('live');
  const sheet = document.createElement('span');
  sheet.className = 'entry-hover';
  sheet.setAttribute('aria-hidden', 'true');
  list.prepend(sheet);

  const y = new Spring(0, (v) => (sheet.style.translate = `0 ${v.toFixed(2)}px`), SNAPPY);
  const h = new Spring(0, (v) => (sheet.style.height = `${v.toFixed(2)}px`), SNAPPY);
  let current: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const show = (entry: HTMLElement) => {
    if (!hover.matches) return;
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
    current?.removeAttribute('data-active');
    current = entry;
    entry.setAttribute('data-active', '');
    sheet.classList.add('on');
  };
  const hide = () => {
    clearTimeout(hideTimer);
    current?.removeAttribute('data-active');
    current = null;
    hovered = null;
    sheet.classList.remove('on');
  };
  const restore = () => {
    const focused = document.activeElement?.matches(':focus-visible')
      ? document.activeElement.closest<HTMLElement>('.entry')
      : null;
    const entry = hovered ?? (focused && list.contains(focused) ? focused : null);
    if (entry && !entry.hidden) show(entry);
    else hide();
  };

  list.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const entry = (e.target as Element).closest<HTMLElement>('.entry');
    if (entry) {
      hovered = entry;
      show(entry);
    }
  });
  list.addEventListener('pointerleave', () => {
    hovered = null;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(restore, 60);
  });
  list.addEventListener('focusin', (e) => {
    if (!(e.target as Element).matches(':focus-visible')) return;
    const entry = (e.target as Element).closest<HTMLElement>('.entry');
    if (entry) show(entry);
  });
  list.addEventListener('focusout', () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(restore, 0);
  });
  addEventListener('fontchange', () => {
    if (!current) return;
    y.set(current.getBoundingClientRect().top - list.getBoundingClientRect().top);
    h.set(current.offsetHeight);
  });
  hover.addEventListener('change', () => { if (!hover.matches) hide(); });
  return hide;
}

/* Category tabs that filter in place -------------------------------------- */

function tabs(bar: HTMLElement, list: HTMLElement, hideHover?: () => void) {
  const links = [...bar.querySelectorAll<HTMLAnchorElement>('a[data-filter]')];
  if (!links.length) return;

  const indicator = document.createElement('span');
  indicator.className = 'tab-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  bar.prepend(indicator);
  bar.classList.add('live');

  const geometry = new Map<HTMLAnchorElement, { left: number; width: number }>();
  const x = new Spring(0, (v) => {
    indicator.style.translate = `${v.toFixed(2)}px 0`;
  }, SNAPPY);
  const w = new Spring(0, (v) => {
    indicator.style.width = `${Math.max(0, v).toFixed(2)}px`;
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
    const origin = links[0].offsetLeft;
    for (const a of links) geometry.set(a, { left: a.offsetLeft - origin, width: a.offsetWidth });
    place(current(), true);
  };
  measure();
  new ResizeObserver(measure).observe(bar);
  document.fonts?.ready.then(measure);
  addEventListener('fontchange', measure);

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
        track(e.animate([{ opacity, transform: `translateY(${dy}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }));
      }
    }
    // Rows and year labels animate separately to avoid translating rows twice.
    entering.forEach((e, i) => {
      track(e.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
        duration: 150,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        delay: Math.min(i, 5) * 8,
        fill: 'backwards',
      }));
    });
    for (const label of labels) {
      if (visible(label) && !before.has(label)) track(label.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' }));
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
  const hideHover = hoverSheet(list);
  const bar = document.querySelector<HTMLElement>('[data-tabs]');
  if (bar) tabs(bar, list, hideHover);
}
