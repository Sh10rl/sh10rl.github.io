import { finePointer, reducedMotion, SMOOTH, SNAPPY, Spring, springAnimate } from './motion';
import { flash, goToHeading } from './reading';
import { currentTheme } from './theme';
import { copy } from './toast';

const FOLD_AFTER = 36;
const CHEVRON =
  '<svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

/* Code: copy, and fold very long listings ---------------------------------- */

function codeBlocks(prose: HTMLElement) {
  for (const block of prose.querySelectorAll<HTMLElement>('.code')) {
    const pre = block.querySelector('pre');
    if (!pre) continue;
    const lines = pre.querySelectorAll('.line').length || (pre.textContent ?? '').split('\n').length;
    if (lines <= FOLD_AFTER) continue;
    block.classList.add('folded');
    const bar = document.createElement('div');
    bar.className = 'code-fold';
    bar.innerHTML = `<button type="button">${CHEVRON}Show all ${lines} lines</button>`;
    block.append(bar);
    bar.querySelector('button')!.addEventListener('click', () => {
      const from = pre.getBoundingClientRect().height;
      block.classList.remove('folded');
      const to = pre.scrollHeight;
      bar.remove();
      springAnimate(pre, [{ height: `${from}px`, overflow: 'hidden' }, { height: `${to}px`, overflow: 'hidden' }], SMOOTH);
    });
  }
}

/* Tables: shade the edge that has more table beyond it ----------------------- */

function tables(prose: HTMLElement) {
  for (const box of prose.querySelectorAll<HTMLElement>('.table')) {
    const update = () => {
      const max = box.scrollWidth - box.clientWidth;
      const left = box.scrollLeft > 1;
      const right = box.scrollLeft < max - 1;
      const more = max <= 1 ? '' : left && right ? 'both' : left ? 'left' : right ? 'right' : '';
      if (box.dataset.more !== more) box.dataset.more = more;
    };
    box.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(box);
  }
}

/* Footnotes: a glass preview beside the reference -------------------------- */

function footnotes() {
  const pop = document.getElementById('FootnotePreview');
  if (!pop) return;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let shownFor: HTMLAnchorElement | null = null;
  const hide = () => {
    shownFor = null;
    if (pop.matches(':popover-open')) pop.hidePopover();
  };

  const show = (ref: HTMLAnchorElement) => {
    const note = document.getElementById(decodeURIComponent(ref.hash.slice(1)));
    if (!note) return;
    clearTimeout(hideTimer);
    if (shownFor === ref) return;
    shownFor = ref;
    const body = note.cloneNode(true) as HTMLElement;
    body.querySelectorAll('[data-footnote-backref]').forEach((b) => b.remove());
    body.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    pop.replaceChildren(...body.childNodes);
    if (!pop.matches(':popover-open')) pop.showPopover();
    const r = ref.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const below = r.top - h - 12 < 72;
    const left = Math.min(innerWidth - w - 12, Math.max(12, r.left + r.width / 2 - w / 2));
    const top = below ? r.bottom + 10 : r.top - h - 10;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    // It grows out of the little number that was pointed at.
    pop.style.setProperty('--origin', `${r.left + r.width / 2 - left}px ${below ? 0 : h}px`);
  };

  const refOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLAnchorElement>('[data-footnote-ref]') : null);

  if (finePointer.matches) {
    document.addEventListener('pointerover', (e) => {
      const ref = refOf(e.target);
      if (ref) show(ref);
    });
    document.addEventListener('pointerout', (e) => {
      if (refOf(e.target)) hideTimer = setTimeout(hide, 140);
    });
  } else {
    // Touch: the first tap previews, a second tap on the same number follows the link.
    document.addEventListener('click', (e) => {
      const ref = refOf(e.target);
      if (ref && shownFor !== ref) {
        e.preventDefault();
        show(ref);
      } else if (!ref) hide();
    });
  }
  document.addEventListener('focusin', (e) => {
    const ref = refOf(e.target);
    if (ref) show(ref);
    else hide();
  });
  addEventListener('scroll', hide, { passive: true });
}

/* Images: zoom on a spring; drag to throw them back --------------------------- */

function largestSource(img: HTMLImageElement): string {
  let best = img.currentSrc || img.src;
  let bestWidth = 0;
  for (const candidate of img.srcset.split(',')) {
    const [url, descriptor] = candidate.trim().split(/\s+/);
    const width = parseInt(descriptor, 10);
    if (url && width > bestWidth) {
      best = new URL(url, location.href).href;
      bestWidth = width;
    }
  }
  return best;
}

function zoom(img: HTMLImageElement) {
  const rect = img.getBoundingClientRect();
  const naturalWidth = Number(img.getAttribute('width')) || img.naturalWidth;
  const margin = innerWidth < 640 ? 12 : 40;
  const scale = Math.min((innerWidth - margin * 2) / rect.width, (innerHeight - margin * 2) / rect.height, Math.max(1, (naturalWidth / rect.width) * 1.5));
  if (scale < 1.08) return;

  const overlay = document.createElement('div');
  overlay.className = 'zoom-overlay';
  const clone = document.createElement('img');
  clone.className = 'zoom-image';
  clone.alt = img.alt;
  clone.src = img.currentSrc || img.src;
  clone.draggable = false;
  Object.assign(clone.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  document.body.append(overlay, clone);
  img.style.visibility = 'hidden';

  const hiRes = largestSource(img);
  if (hiRes !== clone.src) {
    const loader = new Image();
    loader.src = hiRes;
    loader.decode().then(() => (clone.src = hiRes), () => {});
  }

  const tx = (innerWidth - rect.width * scale) / 2 - rect.left;
  const ty = (innerHeight - rect.height * scale) / 2 - rect.top;
  let p = 0;
  let dx = 0;
  let dy = 0;
  let closing = false;
  let closeFrom = rect;
  let closeOpacity = 1;
  const render = () => {
    if (closing) {
      // The page keeps scrolling during dismissal, so follow the source's live position.
      const target = img.getBoundingClientRect();
      const x = target.left + (closeFrom.left - target.left) * p;
      const y = target.top + (closeFrom.top - target.top) * p;
      const w = target.width + (closeFrom.width - target.width) * p;
      const h = target.height + (closeFrom.height - target.height) * p;
      clone.style.transform = `translate(${x - rect.left}px, ${y - rect.top}px) scale(${w / rect.width}, ${h / rect.height})`;
      overlay.style.opacity = String(closeOpacity * Math.max(0, Math.min(1, p)));
      return;
    }
    const s = 1 + (scale - 1) * p;
    clone.style.transform = `translate(${tx * p + dx}px, ${ty * p + dy}px) scale(${s})`;
    overlay.style.opacity = String(Math.max(0, Math.min(1, p) * (1 - Math.min(1, Math.hypot(dx, dy) / 420))));
  };
  const open = new Spring(0, (v) => ((p = v), render()), { stiffness: 320, damping: 32, precision: 0.001 });
  const sx = new Spring(0, (v) => ((dx = v), render()), SNAPPY);
  const sy = new Spring(0, (v) => ((dy = v), render()), SNAPPY);
  open.to(1);

  const close = () => {
    if (closing) return;
    closeFrom = clone.getBoundingClientRect();
    closeOpacity = Number(overlay.style.opacity);
    closing = true;
    overlay.style.pointerEvents = 'none';
    clone.style.pointerEvents = 'none';
    removeEventListener('keydown', onKey);
    removeEventListener('wheel', close);
    removeEventListener('scroll', close);
    removeEventListener('resize', close);
    sx.stop();
    sy.stop();
    open.config = { stiffness: 380, damping: 36, precision: 0.002 };
    open.set(1);
    open.to(0);
    const done = () => {
      if (open.moving) return requestAnimationFrame(done);
      sx.stop();
      sy.stop();
      overlay.remove();
      clone.remove();
      img.style.visibility = '';
    };
    requestAnimationFrame(done);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();

  // Drag: follows the finger 1:1; let go fast or far and it flies home, otherwise it settles back.
  let start: { x: number; y: number; t: number } | null = null;
  let moved = false;
  let vx = 0;
  let vy = 0;
  let lx = 0;
  let ly = 0;
  let lt = 0;
  const down = (e: PointerEvent) => {
    if (closing) return;
    start = { x: e.clientX - dx, y: e.clientY - dy, t: e.timeStamp };
    lx = e.clientX;
    ly = e.clientY;
    lt = e.timeStamp;
    moved = false;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!start || closing) return;
    const nx = e.clientX - start.x;
    const ny = e.clientY - start.y;
    if (!moved && Math.hypot(nx, ny) < 6) return;
    moved = true;
    clone.classList.add('dragging');
    const dt = Math.max(1, e.timeStamp - lt);
    vx = ((e.clientX - lx) / dt) * 1000;
    vy = ((e.clientY - ly) / dt) * 1000;
    lx = e.clientX;
    ly = e.clientY;
    lt = e.timeStamp;
    sx.set(nx);
    sy.set(ny);
  };
  const up = (e: PointerEvent) => {
    if (!start) return;
    start = null;
    clone.classList.remove('dragging');
    if (!moved) return close();
    if (e.timeStamp - lt >= 100) vx = vy = 0;
    if (Math.hypot(dx, dy) > 110 || Math.hypot(vx, vy) > 900) {
      sx.velocity = vx;
      sy.velocity = vy;
      close();
    } else {
      sx.velocity = vx;
      sy.velocity = vy;
      sx.to(0);
      sy.to(0);
    }
  };
  for (const el of [overlay, clone]) {
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  addEventListener('keydown', onKey);
  addEventListener('wheel', close, { passive: true });
  addEventListener('scroll', close, { passive: true });
  addEventListener('resize', close);
}

/* Diagrams ------------------------------------------------------------------ */

function diagrams(prose: HTMLElement) {
  const nodes = [...prose.querySelectorAll<HTMLElement>('pre.mermaid')];
  if (!nodes.length) return;
  for (const el of nodes) el.dataset.source = el.textContent ?? '';
  const mermaidModule = import('mermaid');
  const draw = async () => {
    const { default: mermaid } = await mermaidModule;
    const dark = currentTheme() === 'dark';
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      fontFamily: getComputedStyle(document.body).fontFamily,
      themeVariables: {
        darkMode: dark,
        background: dark ? '#161311' : '#f3f0e8',
        primaryColor: dark ? '#221f1b' : '#fbfaf6',
        primaryTextColor: dark ? '#f0ece5' : '#231d17',
        primaryBorderColor: dark ? '#4a453e' : '#cfc7ba',
        lineColor: dark ? '#a29d95' : '#6a635d',
        secondaryColor: dark ? '#1f2b22' : '#e3ecdf',
        tertiaryColor: dark ? '#1e1b17' : '#ebe7dd',
      },
    });
    // Diagrams are drawn to SVG, so a theme change means drawing them again from source.
    for (const el of nodes) {
      el.removeAttribute('data-processed');
      el.textContent = el.dataset.source ?? '';
    }
    await mermaid.run({ nodes });
  };
  draw();
  addEventListener('themechange', draw);
}

/* Wiring ----------------------------------------------------------------------- */

export function initProse() {
  const prose = document.querySelector<HTMLElement>('[data-article]');
  if (!prose) return;
  codeBlocks(prose);
  tables(prose);
  footnotes();
  diagrams(prose);

  // Lazy images develop in as they arrive.
  for (const img of prose.querySelectorAll<HTMLImageElement>('img[loading="lazy"]')) {
    const done = () => img.classList.add('is-loaded');
    if (img.complete) done();
    else {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    }
  }

  prose.addEventListener('click', async (e) => {
    const target = e.target as Element;

    const button = target.closest<HTMLButtonElement>('.code-copy');
    if (button) {
      const code = button.parentElement?.querySelector('pre')?.textContent ?? '';
      if (await copy(code.replace(/\n$/, ''), 'Code copied')) {
        delete button.dataset.copied;
        void button.offsetWidth;
        button.dataset.copied = '';
        clearTimeout(Number(button.dataset.timer));
        button.dataset.timer = String(setTimeout(() => delete button.dataset.copied, 1800));
      }
      return;
    }

    const anchor = target.closest<HTMLAnchorElement>('.anchor');
    if (anchor) {
      e.preventDefault();
      const id = decodeURIComponent(new URL(anchor.href).hash.slice(1));
      goToHeading(id);
      copy(location.href, 'Link to section copied');
      return;
    }

    // In-page links (footnote back-references, cross references) glide instead of jumping.
    const link = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (link && !link.matches('[data-footnote-ref]') && link.hash.length > 1) {
      const id = decodeURIComponent(link.hash.slice(1));
      if (document.getElementById(id)) {
        e.preventDefault();
        goToHeading(id);
      }
      return;
    }

    const img = target.closest<HTMLImageElement>('figure img');
    if (img && !img.closest('a')) zoom(img);
  });

  // A footnote reference on a fine pointer: glide to the note too.
  if (finePointer.matches) {
    prose.addEventListener('click', (e) => {
      const ref = (e.target as Element).closest<HTMLAnchorElement>('[data-footnote-ref]');
      if (!ref || e.defaultPrevented) return;
      e.preventDefault();
      goToHeading(decodeURIComponent(ref.hash.slice(1)));
    });
  }

  if (location.hash) {
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (el && !reducedMotion.matches) requestAnimationFrame(() => flash(el));
  }
}
