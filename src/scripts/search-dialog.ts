export const dialog = document.querySelector<HTMLDialogElement>('[data-search]')!;
export const input = dialog.querySelector('input')!;
export const form = dialog.querySelector('form')!;
export const list = dialog.querySelector<HTMLElement>('.search-results')!;
export let composing = false;

let searchModule: Promise<typeof import('./search')> | undefined;
const loadSearch = () => (searchModule ??= import('./search').catch((error) => {
  searchModule = undefined;
  throw error;
}));

function loadFailed() {
  if (!dialog.open) return;
  list.innerHTML = '<p class="search-empty">Couldn’t load search. Check your connection and try again.</p>';
}

export function prefetchSearch() {
  void loadSearch().then((module) => module.prefetch()).catch(loadFailed);
}

/** Focus stays in the tap handler so iOS can open its software keyboard. */
export function toggleSearch(from?: Element | null) {
  if (dialog.open) return closeSearch();
  dialog.classList.remove('instant');
  if (!list.hasChildNodes()) list.innerHTML = '<p class="search-empty">Loading…</p>';
  fitViewport();
  dialog.showModal();
  if (from) {
    const r = from.getBoundingClientRect();
    const d = dialog.getBoundingClientRect();
    dialog.style.setProperty('--origin', `${r.left + r.width / 2 - d.left}px ${r.top + r.height / 2 - d.top}px`);
  }
  input.focus({ preventScroll: true });
  input.select();
  void loadSearch().then((module) => { if (dialog.open) module.open(); }).catch(loadFailed);
}

export function closeSearch(immediate = false) {
  if (!dialog.open) return;
  dialog.classList.toggle('instant', immediate);
  dialog.close();
}

function fitViewport() {
  const viewport = visualViewport;
  if (!viewport) return;
  dialog.style.setProperty('--search-viewport-height', `${viewport.height}px`);
  dialog.style.setProperty('--search-viewport-top', `${viewport.offsetTop}px`);
}

visualViewport?.addEventListener('resize', () => { if (dialog.open) fitViewport(); });
visualViewport?.addEventListener('scroll', () => { if (dialog.open) fitViewport(); });

// Keep close and submit safe even while the search module is still loading.
form.addEventListener('submit', (event) => event.preventDefault());
dialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeSearch();
});
dialog.querySelector('[data-search-close]')?.addEventListener('click', () => closeSearch());
dialog.addEventListener('click', (event) => { if (event.target === dialog) closeSearch(); });
dialog.addEventListener('close', () => { composing = false; });
input.addEventListener('compositionstart', () => { composing = true; });
input.addEventListener('compositionend', () => { composing = false; });
input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !composing && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    closeSearch();
  }
});
