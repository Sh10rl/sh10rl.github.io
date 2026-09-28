import { finePointer, headingTarget, pageTop, reducedMotion, scrollToY, SMOOTH, SNAPPY, Spring, springAnimate } from './motion';
import { toast } from './toast';

/* Reading position, remembered per post ------------------------------------ */

const STORE = 'reading';
export interface Mark {
  /** How far through the article body, from 0 to 1. */
  p: number;
  /** When it was last read (ms). */
  t: number;
  /** Finished. */
  d?: 1;
  /** An explicit reset, preserved across reloads until reading starts again. */
  u?: 1;
}

export function readMarks(): Record<string, Mark> {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}') ?? {};
  } catch {
    return {};
  }
}

function writeMark(path: string, mark: Mark) {
  try {
    const all = readMarks();
    all[path] = mark;
    // Keep the fifty most recent.
    const keep = Object.entries(all)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, 50);
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(keep)));
    return true;
  } catch {
    return false;
  }
}

export function markUnread(path: string) {
  const saved = writeMark(path, { p: 0, t: Date.now(), u: 1 });
  if (saved) dispatchEvent(new CustomEvent('readingreset', { detail: path }));
  toast(saved ? 'Marked as unread' : 'Couldn’t save reading status', !saved);
  return saved;
}

/* Flash: a highlighter stroke where the eye should land ------------------- */

export function flash(target: Element | null) {
  if (!target || reducedMotion.matches) return;
  target.classList.remove('flash');
  void (target as HTMLElement).offsetWidth;
  target.classList.add('flash');
  target.addEventListener('animationend', () => target.classList.remove('flash'), { once: true });
}

export function goToHeading(id: string, pushHash = true) {
  const el = document.getElementById(id);
  if (!el) return;
  if (pushHash) history.replaceState(history.state, '', `#${encodeURIComponent(id)}`);
  scrollToY(headingTarget(el), () => flash(el));
}

/* The article ------------------------------------------------------------- */

export function initReading() {
  const post = document.querySelector<HTMLElement>('.post');
  const prose = post?.querySelector<HTMLElement>('.prose');
  const capsule = document.querySelector<HTMLElement>('[data-capsule]');
  if (!post || !prose || !capsule) return;

  const root = document.documentElement;
  const faceNav = capsule.querySelector<HTMLElement>('[data-face="nav"]')!;
  const faceRead = capsule.querySelector<HTMLElement>('[data-face="read"]')!;
  const nowText = capsule.querySelector<HTMLElement>('[data-now]');
  const nowButton = capsule.querySelector<HTMLElement>('[data-toc-open]');
  const progressRing = capsule.querySelector<SVGCircleElement>('.ring-fill');
  const toc = document.querySelector<HTMLElement>('[data-toc]');
  const tocInner = toc?.querySelector<HTMLElement>('.toc-inner');
  const rail = toc?.querySelector<HTMLElement>('.toc-rail');
  const fill = toc?.querySelector<HTMLElement>('.toc-fill');
  const dot = toc?.querySelector<HTMLElement>('.toc-dot');
  const sheet = document.getElementById('TocSheet');
  const headings = [...prose.querySelectorAll<HTMLElement>(':scope > h2[id], :scope > h3[id]')];
  const path = post.dataset.post || location.pathname;
  const title = post.dataset.title || document.title;
  const linkSets = [toc, sheet].map((box) => [...(box?.querySelectorAll<HTMLAnchorElement>('ol a') ?? [])]);

  /* Geometry, measured once per layout change ----------------------------- */

  let bodyTop = 0;
  let bodyHeight = 1;
  let tops: number[] = [];
  let railAnchors: [number, number][] = [];
  let railHeight = 1;

  const tocEdges = () => {
    if (!tocInner) return;
    const max = tocInner.scrollHeight - tocInner.clientHeight;
    const top = tocInner.scrollTop > 1;
    const bottom = tocInner.scrollTop < max - 1;
    const edges = max <= 1 ? '' : top && bottom ? 'both' : top ? 'top' : 'bottom';
    if (tocInner.dataset.edges !== edges) tocInner.dataset.edges = edges;
  };
  if (tocInner) {
    tocInner.addEventListener('scroll', tocEdges, { passive: true });
    new ResizeObserver(tocEdges).observe(tocInner);
  }

  const measure = () => {
    bodyTop = pageTop(prose);
    bodyHeight = Math.max(1, prose.offsetHeight);
    tops = headings.map(pageTop);
    if (rail && linkSets[0].length) {
      const railBox = rail.getBoundingClientRect();
      railHeight = Math.max(1, railBox.height);
      // Piecewise map from page position to rail position: article start → rail top,
      // each heading → the middle of its entry, article end → rail bottom.
      railAnchors = [[bodyTop, 0]];
      linkSets[0].forEach((a, i) => {
        const r = a.getBoundingClientRect();
        railAnchors.push([tops[i], Math.min(railHeight, Math.max(0, r.top + r.height / 2 - railBox.top))]);
      });
      railAnchors.push([bodyTop + bodyHeight, railHeight]);
    }
    tocEdges();
  };

  /* Capsule: navigation face ↔ reading face ------------------------------- */

  type State = 'nav' | 'read';
  let state: State = 'nav';
  let travel = 0;
  let lastY = scrollY;
  let headerHidden = false;
  const hideHeader = (hidden: boolean) => {
    if (headerHidden === hidden) return;
    headerHidden = hidden;
    capsule.toggleAttribute('data-reading-hidden', hidden);
  };
  const revealHeader = () => {
    hideHeader(false);
    travel = 0;
  };
  addEventListener('pointermove', (event) => {
    if (headerHidden && finePointer.matches && event.clientY <= 24) revealHeader();
  }, { passive: true });
  addEventListener('keydown', (event) => {
    if (event.key === 'Tab') revealHeader();
  });
  capsule.addEventListener('focusin', revealHeader);

  const navWidth = () => {
    const prev = capsule.style.width;
    capsule.style.width = '';
    const w = capsule.getBoundingClientRect().width;
    capsule.style.width = prev;
    return w;
  };
  const readWidth = () => Math.min(faceRead.scrollWidth, innerWidth - 16);

  const width = new Spring(0, (w) => {
    capsule.style.width = state === 'nav' && !width.moving ? '' : `${w.toFixed(2)}px`;
  }, SMOOTH);

  const setState = (next: State, instant = false) => {
    if (next === 'nav') hideHeader(false);
    if (next === state) return;
    const from = capsule.getBoundingClientRect().width;
    state = next;
    capsule.dataset.state = next;
    for (const [face, on] of [[faceNav, next === 'nav'], [faceRead, next === 'read']] as const) {
      face.inert = !on;
      face.setAttribute('aria-hidden', String(!on));
    }
    const to = next === 'read' ? readWidth() : navWidth();
    // Start from the width on screen (without drawing an intermediate frame).
    if (!width.moving) width.value = width.target = from;
    if (instant) width.set(to);
    else width.to(to, SMOOTH);
  };

  /* Current section -------------------------------------------------------- */

  let active = -2;
  let sectionAnimation: Animation | undefined;
  const setNow = (text: string) => {
    if (!nowText || nowText.textContent === text) return;
    nowText.textContent = text;
    sectionAnimation?.cancel();
    sectionAnimation = springAnimate(nowText, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], SNAPPY);
    if (state === 'read') width.to(readWidth(), SNAPPY);
  };

  const setActive = (index: number) => {
    if (index === active) return;
    active = index;
    for (const links of linkSets) {
      links.forEach((a, i) => {
        if (i === index) a.setAttribute('aria-current', 'location');
        else a.removeAttribute('aria-current');
        a.classList.toggle('read', i < index);
      });
    }
    setNow(index >= 0 ? (headings[index].textContent ?? '').trim() : title);
    // Keep the margin list's current entry in view.
    const link = linkSets[0][index];
    if (tocInner && link) {
      const box = tocInner.getBoundingClientRect();
      const r = link.getBoundingClientRect();
      if (r.top < box.top + 24 || r.bottom > box.bottom - 48) {
        tocInner.scrollTo({ top: tocInner.scrollTop + r.top - box.top - box.height / 3, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
      }
    }
  };

  /* The rail follows the page continuously; a spring irons out jumps. */
  const railSpring = new Spring(0, (y) => {
    const at = Math.max(0, Math.min(railHeight, y));
    if (fill) fill.style.scale = `1 ${(at / Math.max(1, railHeight)).toFixed(4)}`;
    if (dot) dot.style.transform = `translate3d(0, ${at.toFixed(2)}px, 0)`;
  }, SNAPPY);

  const railAt = (y: number) => {
    for (let i = 1; i < railAnchors.length; i++) {
      const [y1, r1] = railAnchors[i];
      if (y <= y1) {
        const [y0, r0] = railAnchors[i - 1];
        return y1 === y0 ? r1 : r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
      }
    }
    return railHeight;
  };

  /* Scroll ------------------------------------------------------------------ */

  let progress = 0;
  const update = () => {
    // Reads first, then writes, so a scroll frame never forces a synchronous layout.
    const y = scrollY;
    const atEnd = y + innerHeight >= root.scrollHeight - 4;
    const line = y + innerHeight * 0.35;
    progress = Math.min(1, Math.max(0, (line - bodyTop) / bodyHeight));
    if (progressRing) progressRing.style.strokeDashoffset = (1 - progress).toFixed(4);

    let index = -1;
    for (let i = 0; i < tops.length && tops[i] <= line; i++) index = i;
    if (headings.length && atEnd && line > bodyTop) index = headings.length - 1;
    setActive(index);

    if (fill && railAnchors.length) railSpring.to(Math.max(0, Math.min(railHeight, railAt(line))));

    // Reading face while inside the article; a determined scroll up brings the navigation back.
    const dy = y - lastY;
    lastY = y;
    const inBody = line > bodyTop + 24 && y + innerHeight * 0.5 < bodyTop + bodyHeight;
    if (!inBody || document.querySelector('.search[open]')) {
      travel = 0;
      hideHeader(false);
      if (!inBody) setState('nav');
      return;
    }
    travel = dy > 0 ? Math.max(0, travel) + dy : dy < 0 ? Math.min(0, travel) + dy : travel;
    if (state === 'nav' && travel > 16) {
      setState('read');
      revealHeader();
    } else if (state === 'read' && travel < -240) {
      setState('nav');
    } else if (travel < -12) {
      hideHeader(false);
    } else if (state === 'read' && travel > 96) {
      const interacting = capsule.matches(':hover') || capsule.querySelector(':focus-visible')
        || document.querySelector('.prefs:popover-open, .toc-sheet:popover-open');
      if (!interacting) hideHeader(true);
    }
  };

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
      saveSoon();
    });
  };

  const relayout = () => {
    measure();
    if (state === 'read') width.set(readWidth());
    update();
  };

  let layoutFrame = 0;
  const queueLayout = () => {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      relayout();
    });
  };

  measure();
  // Landing mid-article (a link to a section, a restored scroll): start in reading mode.
  const line0 = scrollY + innerHeight * 0.35;
  if (line0 > bodyTop + 24 && scrollY + innerHeight * 0.5 < bodyTop + bodyHeight) setState('read', true);
  update();
  railSpring.set(railSpring.target);

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', queueLayout, { passive: true });
  addEventListener('textsizechange', () => {
    // Keeping the paragraph in place is not a change in the reader's scroll direction.
    lastY = scrollY;
    travel = 0;
    queueLayout();
  });
  new ResizeObserver(queueLayout).observe(prose);
  document.fonts?.ready.then(queueLayout);

  /* Contents: the margin list, the inline list and the sheet ---------------- */

  document.addEventListener('click', (e) => {
    const link = (e.target as Element).closest<HTMLAnchorElement>('.toc ol a, .toc-sheet ol a, .toc-inline ol a');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    const id = decodeURIComponent(link.hash.slice(1));
    if (sheet?.matches(':popover-open')) sheet.hidePopover();
    link.closest('details')?.removeAttribute('open');
    goToHeading(id);
  });

  nowButton?.addEventListener('click', () => {
    if (!sheet) scrollToY(0);
  });

  sheet?.addEventListener('toggle', (e) => {
    const open = (e as ToggleEvent).newState === 'open';
    nowButton?.setAttribute('aria-expanded', String(open));
    // Focus goes to where you are in the list; closing hands it back to the header.
    if (open) {
      if (nowButton) {
        const r = nowButton.getBoundingClientRect();
        const s = sheet.getBoundingClientRect();
        sheet.style.setProperty('--origin', `${r.left + r.width / 2 - s.left}px ${r.top + r.height / 2 - s.top}px`);
      }
      const active = sheet.querySelector<HTMLElement>('[aria-current]');
      active?.scrollIntoView({ block: 'center' });
      (active ?? sheet.querySelector<HTMLElement>('ol a'))?.focus({ preventScroll: true });
    } else if (!document.activeElement || document.activeElement === document.body) nowButton?.focus({ preventScroll: true });
  });

  // On phones the sheet rises from the bottom and can be flicked away.
  if (sheet && !finePointer.matches) {
    let startY = 0;
    let lastMoveY = 0;
    let lastT = 0;
    let velocity = 0;
    let dragging = false;
    sheet.addEventListener('pointerdown', (e) => {
      const list = sheet.querySelector('ol');
      if (list && list.contains(e.target as Node) && sheet.scrollTop > 0) return;
      dragging = true;
      startY = lastMoveY = e.clientY;
      lastT = e.timeStamp;
      velocity = 0;
    });
    sheet.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (dy < 4 && !sheet.style.translate) return;
      sheet.style.transition = 'none';
      // Past the top it resists, like pulling against the table.
      sheet.style.translate = `0 ${dy > 0 ? dy : dy / 4}px`;
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = ((e.clientY - lastMoveY) / dt) * 1000;
      lastMoveY = e.clientY;
      lastT = e.timeStamp;
    });
    const resetDrag = () => {
      dragging = false;
      sheet.style.transition = '';
      requestAnimationFrame(() => (sheet.style.translate = ''));
    };
    const release = (e: PointerEvent) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      const releaseVelocity = e.timeStamp - lastT < 100 ? velocity : 0;
      resetDrag();
      if (dy > 110 || releaseVelocity > 700) sheet.hidePopover();
    };
    sheet.addEventListener('pointerup', release);
    sheet.addEventListener('pointercancel', resetDrag);
  }

  /* Remember the place, and offer it back next time ------------------------- */

  const unreadButton = post.querySelector<HTMLButtonElement>('[data-mark-unread]');
  const resume = document.querySelector<HTMLElement>('[data-resume]');
  const mark = readMarks()[path];
  let allowSave = !mark?.u;
  let resetThisVisit = false;
  let dismissResume = () => { if (resume) resume.hidden = true; };
  const syncUnreadButton = () => {
    const stored = readMarks()[path];
    if (unreadButton) unreadButton.hidden = !stored || !!stored.u || (!stored.d && stored.p < 0.02);
  };
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    if (!allowSave) return;
    if (progress < 0.02 && !readMarks()[path]) return;
    const done = progress > 0.96;
    const previous = readMarks()[path];
    if (writeMark(path, { p: +progress.toFixed(3), t: Date.now(), ...(done || previous?.d ? { d: 1 as const } : {}) })) syncUnreadButton();
  };
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  };
  addEventListener('pagehide', save);

  const reset = () => {
    allowSave = false;
    resetThisVisit = true;
    clearTimeout(saveTimer);
    dismissResume();
    syncUnreadButton();
  };
  unreadButton?.addEventListener('click', () => markUnread(path));
  addEventListener('readingreset', (event) => {
    if ((event as CustomEvent<string>).detail === path) reset();
  });
  const syncStored = () => {
    if (readMarks()[path]?.u) reset();
    else syncUnreadButton();
  };
  addEventListener('storage', (event) => {
    if (event.key === STORE || event.key === null) syncStored();
  });
  addEventListener('pageshow', (event) => { if (event.persisted) syncStored(); });
  // A restored scroll position must not undo a reset. A new visit can start recording
  // again when the reader scrolls or chooses a section; resetting this visit stays put.
  const startReading = () => { if (!resetThisVisit) allowSave = true; };
  addEventListener('wheel', startReading, { passive: true });
  addEventListener('touchmove', startReading, { passive: true });
  addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)
      && !(event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)))) startReading();
  });
  document.addEventListener('click', (event) => {
    if ((event.target as Element).closest('.toc ol a, .toc-sheet ol a, .toc-inline ol a, [data-scroll-top], [data-scroll-bottom]')) startReading();
  });
  syncUnreadButton();

  if (resume && mark && !mark.d && mark.p > 0.06 && mark.p < 0.94 && !location.hash && scrollY < innerHeight * 0.5) {
    const target = () => bodyTop + mark.p * bodyHeight - innerHeight * 0.35;
    const at = bodyTop + mark.p * bodyHeight;
    let section = title;
    tops.forEach((top, i) => {
      if (top <= at) section = (headings[i].textContent ?? '').trim();
    });
    const where = resume.querySelector<HTMLElement>('[data-resume-where]');
    if (where) where.textContent = `${section} · ${Math.round(mark.p * 100)}%`;
    const hide = () => {
      resume.hidden = true;
      removeEventListener('scroll', watch);
    };
    dismissResume = hide;
    const startY = scrollY;
    const watch = () => {
      if (scrollY - startY > innerHeight * 0.6) hide();
    };
    setTimeout(() => {
      if (!allowSave || readMarks()[path]?.u) return;
      resume.hidden = false;
      addEventListener('scroll', watch, { passive: true });
      setTimeout(hide, 14000);
    }, 650);
    resume.querySelector('[data-resume-go]')?.addEventListener('click', () => {
      hide();
      scrollToY(target());
    });
    resume.querySelector('[data-resume-close]')?.addEventListener('click', hide);
  }
}
