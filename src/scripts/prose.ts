import { finePointer, reducedMotion, SMOOTH, Spring } from './motion';
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
    const label = button.querySelector('span')!;

    // A pointer shortcut beside Copy at the top of a long expanded listing. It shows only while
    // the listing is taller than the window, so it never shares the screen with the one below.
    const copyButton = block.querySelector('.code-copy');
    const tools = document.createElement('div');
    tools.className = 'code-tools';
    const less = document.createElement('button');
    less.type = 'button';
    less.className = 'code-less';
    less.tabIndex = -1;
    less.hidden = true;
    less.setAttribute('aria-hidden', 'true');
    less.innerHTML = `${CHEVRON}<span>Show less</span>`;
    const syncLess = () => {
      less.hidden = block.classList.contains('folded')
        || button.getBoundingClientRect().top - tools.getBoundingClientRect().bottom <= innerHeight;
    };

    // While folding, the pressed control stays where it was and the page moves instead.
    let pin: Element | undefined;
    let pinTop = 0;
    const release = () => {
      pin = undefined;
      removeEventListener('wheel', release);
      removeEventListener('touchstart', release);
      removeEventListener('keydown', release);
    };
    const height = new Spring(
      0,
      (value) => {
        pre.style.height = `${value}px`;
        const offset = pin ? pin.getBoundingClientRect().top - pinTop : 0;
        if (offset) {
          scrollBy({ top: offset, behavior: 'instant' });
          dispatchEvent(new Event('textsizechange'));
        }
        if (height.moving) return;
        release();
        delete block.dataset.moving;
        pre.style.removeProperty('height');
        pre.style.removeProperty('max-height');
        pre.style.removeProperty('overflow-y');
      },
      { ...SMOOTH, precision: 0.5 },
    );

    const toggle = (control: HTMLButtonElement) => {
      const folding = !block.classList.contains('folded');
      // Folding takes the bar out of the flow, so the listing starts at the whole block's height.
      const from = (folding ? block : pre).getBoundingClientRect().height;
      const rect = control.getBoundingClientRect();
      release();
      if (folding && rect.bottom > 0 && rect.top < innerHeight) {
        pin = control === less ? block : button;
        pinTop = pin.getBoundingClientRect().top;
        addEventListener('wheel', release, { passive: true });
        addEventListener('touchstart', release, { passive: true });
        addEventListener('keydown', release);
      }
      block.dataset.moving = '';
      block.classList.toggle('folded', folding);
      button.setAttribute('aria-expanded', String(!folding));
      label.textContent = folding ? `Show all ${lines} lines` : 'Show less';
      pre.style.removeProperty('height');
      pre.style.removeProperty('max-height');
      const to = pre.getBoundingClientRect().height;
      pre.style.height = `${from}px`;
      pre.style.maxHeight = 'none';
      pre.style.overflowY = 'hidden';
      syncLess();
      height.value = from;
      if (from === to) height.set(to);
      else height.to(to);
      dispatchEvent(new Event('textsizechange'));
    };

    button.addEventListener('click', () => toggle(button));
    if (copyButton) {
      copyButton.before(tools);
      tools.append(less, copyButton);
      less.addEventListener('click', () => toggle(less));
      new ResizeObserver(syncLess).observe(block);
      addEventListener('resize', syncLess, { passive: true });
    }
  }
}

/* Inline code: mark visual continuations without changing the text ---------- */

function inlineCodeWraps(prose: HTMLElement) {
  const entries: { code: HTMLElement; hints: HTMLSpanElement | null }[] = [];
  for (const code of prose.querySelectorAll<HTMLElement>(':not(pre) > code')) {
    if (!code.closest('pre') && !code.querySelector('br')) entries.push({ code, hints: null });
  }
  if (!entries.length) return;

  const update = () => {
    for (const entry of entries) {
      const rects = entry.code.getClientRects();
      if (rects.length < 2) {
        entry.hints?.remove();
        entry.hints = null;
        continue;
      }

      let hints = entry.hints;
      if (!hints) {
        hints = document.createElement('span');
        hints.className = 'code-wrap-hints';
        hints.setAttribute('aria-hidden', 'true');
        entry.code.append(hints);
        entry.hints = hints;
      }
      const origin = hints.getBoundingClientRect();
      let top = rects[0].top;
      let count = 0;
      for (const rect of rects) {
        if (!rect.width || !rect.height || Math.abs(rect.top - top) < 1) continue;
        top = rect.top;
        let hint = hints.children[count] as HTMLSpanElement | undefined;
        if (!hint) {
          hint = document.createElement('span');
          hints.append(hint);
        }
        hint.style.left = `${rect.left - origin.left}px`;
        hint.style.top = `${rect.top + rect.height / 2 - origin.top}px`;
        count++;
      }
      while (hints.children.length > count) hints.lastElementChild!.remove();
      if (!count) {
        hints.remove();
        entry.hints = null;
      }
    }
  };

  let frame = 0;
  const queue = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };
  new ResizeObserver(queue).observe(prose);
  document.fonts.ready.then(queue);
  addEventListener('fontchange', queue);
  addEventListener('textsizechange', queue);
  queue();
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
  inlineCodeWraps(prose);
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
      const table = button.dataset.markdown;
      const text = table ?? (button.closest('.code')?.querySelector('pre')?.textContent ?? '').replace(/\n$/, '');
      if (await copy(text, table === undefined ? 'Code copied' : 'Table copied', button)) {
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
