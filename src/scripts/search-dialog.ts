export const dialog = document.querySelector<HTMLDialogElement>('[data-search]')!;
export const input = dialog.querySelector('input')!;
export const form = dialog.querySelector('form')!;
export const list = dialog.querySelector<HTMLElement>('.search-results')!;
export let composing = false;
const clear = dialog.querySelector<HTMLButtonElement>('[data-search-clear]')!;
const root = document.documentElement;
let pagePosition: { x: number; y: number } | undefined;

function lockPage() {
  pagePosition = { x: scrollX, y: scrollY };
  root.style.setProperty('--search-page-top', `${-scrollY}px`);
  root.setAttribute('data-search-active', '');
}

function unlockPage() {
  if (!pagePosition) return;
  const { x, y } = pagePosition;
  pagePosition = undefined;
  root.removeAttribute('data-search-active');
  root.style.removeProperty('--search-page-top');
  scrollTo({ left: x, top: y, behavior: 'instant' });
}

/** Focus stays in the tap handler so iOS can open its software keyboard. */
export function toggleSearch(from?: Element | null) {
  if (dialog.open) return closeSearch();
  dialog.classList.remove('instant');
  dialog.classList.remove('keyboard-selection');
  clear.hidden = !input.value;
  if (!list.hasChildNodes()) list.innerHTML = '<p class="search-empty">Loading…</p>';
  lockPage();
  fitViewport();
  dialog.showModal();
  if (from) {
    const r = from.getBoundingClientRect();
    const d = dialog.getBoundingClientRect();
    dialog.style.setProperty('--origin', `${r.left + r.width / 2 - d.left}px ${r.top + r.height / 2 - d.top}px`);
  }
  input.focus({ preventScroll: true });
  input.select();
  dialog.dispatchEvent(new Event('search:open'));
}

export function closeSearch(immediate = false) {
  if (!dialog.open) return;
  dialog.classList.toggle('instant', immediate);
  input.blur();
  dialog.close();
  unlockPage();
}

function fitViewport() {
  const viewport = visualViewport;
  if (!viewport) return;
  dialog.style.setProperty('--search-viewport-height', `${viewport.height}px`);
  dialog.style.setProperty('--search-viewport-top', `${viewport.offsetTop}px`);
}

visualViewport?.addEventListener('resize', () => { if (dialog.open) fitViewport(); });
visualViewport?.addEventListener('scroll', () => { if (dialog.open) fitViewport(); });

// Native form submission must never navigate away from the page.
form.addEventListener('submit', (event) => event.preventDefault());
dialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeSearch();
});
dialog.querySelector('[data-search-close]')?.addEventListener('click', () => closeSearch());
dialog.addEventListener('click', (event) => { if (event.target === dialog) closeSearch(); });
dialog.addEventListener('close', () => {
  if (!dialog.open) { composing = false; unlockPage(); }
});
clear.addEventListener('click', () => {
  composing = false;
  input.value = '';
  input.focus({ preventScroll: true });
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
input.addEventListener('input', () => { clear.hidden = !input.value; });
input.addEventListener('compositionstart', () => { composing = true; });
input.addEventListener('compositionend', () => { composing = false; });
input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !composing && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    closeSearch();
  }
});
