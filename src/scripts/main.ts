import { consumePendingHighlight } from './highlight';
import { initHeaderGlow } from './header-glow';
import { initIndex } from './index';
import { finePointer, scrollToY } from './motion';
import { initPrefs } from './prefs';
import { initProse } from './prose';
import { initReading } from './reading';
import { toggleTheme } from './theme';
import { copy } from './toast';
import { prefetchSearch } from './search';
import { toggleSearch } from './search-dialog';

const root = document.documentElement;

// Styles that depend on this script (image fade-in) key off this class, so a failed
// script load never leaves content hidden.
root.classList.add('fx');

/* Search ---------------------------------------------------------------------- */

document.querySelectorAll('[data-search-open]').forEach((el) => {
  el.addEventListener('pointerenter', prefetchSearch, { once: true });
  el.addEventListener('focus', prefetchSearch, { once: true });
});

if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
  document.querySelectorAll('[data-mod-key]').forEach((kbd) => (kbd.textContent = 'Ctrl K'));
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

document.addEventListener('keydown', (e) => {
  const trigger = document.querySelector('.search-btn');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    toggleSearch(trigger);
  } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
    e.preventDefault();
    toggleSearch(trigger);
  }
});

/* Clicks ------------------------------------------------------------------------ */

document.addEventListener('click', (e) => {
  const target = e.target as Element;

  const searchButton = target.closest('[data-search-open]');
  if (searchButton) {
    e.preventDefault();
    toggleSearch(searchButton);
    return;
  }

  const themeButton = target.closest('[data-theme-toggle]');
  if (themeButton) {
    toggleTheme();
    return;
  }

  const linkButton = target.closest<HTMLElement>('[data-copy-link]');
  if (linkButton) {
    copy(linkButton.dataset.copyLink || location.href, 'Link copied');
    return;
  }

  if (target.closest('[data-share]')) {
    navigator.share?.({ title: document.title, url: location.href }).catch(() => {});
    return;
  }

  if (target.closest('[data-scroll-top]')) {
    e.preventDefault();
    history.replaceState(history.state, '', location.pathname + location.search);
    scrollToY(0);
    return;
  }

  if (target.closest('[data-scroll-bottom]')) {
    e.preventDefault();
    const end = document.getElementById('PostEnd');
    if (end) {
      history.replaceState(history.state, '', '#PostEnd');
      scrollToY(end.getBoundingClientRect().top + scrollY - 24, () => end.focus({ preventScroll: true }));
    }
  }
});

if ('share' in navigator && !finePointer.matches) {
  document.querySelectorAll<HTMLElement>('[data-share]').forEach((el) => (el.hidden = false));
}

/* Pages ---------------------------------------------------------------------------- */

initHeaderGlow();
initIndex();
initReading();
initProse();
initPrefs();
consumePendingHighlight();
