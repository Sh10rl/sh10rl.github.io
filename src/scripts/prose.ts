import { finePointer, reducedMotion, SMOOTH, springAnimate } from './motion';
import { zoom } from './gallery';
import { flash, goToHeading } from './reading';
import { currentTheme } from './theme';
import { copy } from './toast';

const CHEVRON =
  '<svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

/* Code: copy, and fold very long listings ---------------------------------- */

function codeBlocks(prose: HTMLElement) {
  let index = 0;
  for (const block of prose.querySelectorAll<HTMLElement>('.code[data-lines]')) {
    const pre = block.querySelector('pre');
    if (!pre) continue;
    const lines = Number(block.dataset.lines);
    const bar = document.createElement('div');
    bar.className = 'code-fold';
    pre.id ||= `CodeLines-${++index}`;
    bar.innerHTML = `<button type="button" aria-expanded="false" aria-controls="${pre.id}">${CHEVRON}<span>Show all ${lines} lines</span></button>`;
    block.append(bar);
    const button = bar.querySelector('button')!;
    let animation: Animation | undefined;
    button.addEventListener('click', () => {
      const from = pre.getBoundingClientRect().height;
      const before = button.getBoundingClientRect();
      const expanding = block.classList.contains('folded');
      animation?.cancel();
      block.classList.toggle('folded', !expanding);
      button.setAttribute('aria-expanded', String(expanding));
      button.querySelector('span')!.textContent = expanding ? 'Show less' : `Show all ${lines} lines`;
      if (expanding) {
        const to = pre.scrollHeight;
        animation = springAnimate(pre, [{ height: `${from}px`, overflow: 'hidden' }, { height: `${to}px`, overflow: 'hidden' }], SMOOTH);
      } else {
        if (before.top >= 0 && before.top < innerHeight) {
          scrollBy({ top: button.getBoundingClientRect().top - before.top, behavior: 'instant' });
        }
        if (!reducedMotion.matches) bar.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
      }
      dispatchEvent(new Event('textsizechange'));
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
    if (img && !img.closest('a')) zoom(img, [...prose.querySelectorAll<HTMLImageElement>('figure img')].filter(image => !image.closest('a')));
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
