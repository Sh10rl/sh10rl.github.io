export const HIGHLIGHT_KEY = 'search:highlight';

let clearOnEscape: ((e: KeyboardEvent) => void) | undefined;

/** Marks every occurrence of `terms` in the article with the CSS Custom Highlight API, then scrolls to the first one. */
export function highlightTerms(terms: string[], reveal = true) {
  const article = document.querySelector('[data-article]');
  if (!article || !terms.length || !('highlights' in CSS)) return;

  const needles = terms.map((t) => t.toLowerCase()).filter(Boolean);
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.data.toLowerCase();
    if (text.length !== node.data.length) continue;
    for (const needle of needles) {
      for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) {
        const range = new Range();
        range.setStart(node, i);
        range.setEnd(node, i + needle.length);
        ranges.push(range);
      }
    }
  }
  if (!ranges.length) return;
  ranges.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));
  CSS.highlights.set('search', new Highlight(...ranges));

  const section = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  const first =
    (section && ranges.find((r) => section.compareDocumentPosition(r.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING)) ||
    ranges[0];
  const rect = first.getBoundingClientRect();
  if (reveal && (rect.top < 80 || rect.bottom > innerHeight - 40)) {
    scrollTo({ top: scrollY + rect.top - innerHeight / 3, behavior: 'instant' });
  }

  // Esc clears the marks; other keys leave them alone.
  if (clearOnEscape) removeEventListener('keydown', clearOnEscape);
  clearOnEscape = (e) => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    CSS.highlights.delete('search');
    removeEventListener('keydown', clearOnEscape!);
    clearOnEscape = undefined;
  };
  addEventListener('keydown', clearOnEscape);
}

function consume() {
  let pending: { path: string; terms: string[] } | undefined;
  try {
    const raw = sessionStorage.getItem(HIGHLIGHT_KEY);
    sessionStorage.removeItem(HIGHLIGHT_KEY);
    pending = raw ? JSON.parse(raw) : undefined;
  } catch {}
  if (pending && pending.path === location.pathname) highlightTerms(pending.terms);
}

export function consumePendingHighlight() {
  // A page prerendered on hover runs its scripts before the click stores the terms.
  if ((document as Document & { prerendering?: boolean }).prerendering) {
    document.addEventListener('prerenderingchange', consume, { once: true });
  } else {
    consume();
  }
}
