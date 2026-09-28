import { HIGHLIGHT_KEY, highlightTerms } from './highlight';
import { flash } from './reading';
import { finePointer, headingTarget, scrollToY } from './motion';
import { closeSearch, composing, dialog, form, input, list } from './search-dialog';

type Section = [id: string, heading: string, text: string];
interface Doc {
  u: string;
  t: string;
  d: string;
  f: string;
  c: string;
  s: Section[];
}
interface Indexed extends Doc {
  title: string;
  lower: Section[];
  all: string;
}
interface Hit {
  doc: Indexed;
  score: number;
  sections: { index: number; score: number; pos: number }[];
}

const count = dialog.querySelector<HTMLElement>('[data-search-count]')!;

let docs: Indexed[] | undefined;
let loading: Promise<void> | undefined;
let failed = false;
let items: HTMLAnchorElement[] = [];
let cursor: HTMLElement | null = null;
let selected = 0;

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function load() {
  loading ??= fetch('/search.json')
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<Doc[]>;
    })
    .then((data) => {
      failed = false;
      docs = data.map((doc) => {
        const lower = doc.s.map(([id, h, t]) => [id, h.toLowerCase(), t.toLowerCase()] as Section);
        const title = doc.t.toLowerCase();
        return { ...doc, title, lower, all: `${title} ${lower.map((s) => `${s[1]} ${s[2]}`).join(' ')}` };
      });
      count.textContent = `${docs.length} posts`;
      render();
    })
    .catch(() => {
      loading = undefined;
      failed = true;
      render();
    });
  return loading;
}

export function prefetch() {
  load();
}

let fresh = false;

export function open() {
  fresh = true;
  load();
  render();
}

function terms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
}

function occurrences(text: string, term: string) {
  let n = 0;
  for (let i = text.indexOf(term); i !== -1 && n < 5; i = text.indexOf(term, i + term.length)) n++;
  return n;
}

function search(query: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const doc of docs ?? []) {
    if (!query.every((t) => doc.all.includes(t))) continue;
    let score = 0;
    for (const t of query) if (doc.title.includes(t)) score += 12;
    const sections: Hit['sections'] = [];
    doc.lower.forEach(([, heading, text], index) => {
      let s = 0;
      let pos = -1;
      for (const t of query) {
        if (heading.includes(t)) s += 5;
        const at = text.indexOf(t);
        if (at !== -1) {
          s += 1 + occurrences(text, t) * 0.3;
          if (pos === -1 || at < pos) pos = at;
        }
      }
      if (s > 0) sections.push({ index, score: s, pos });
    });
    sections.sort((a, b) => b.score - a.score);
    score += sections[0]?.score ?? 0;
    hits.push({ doc, score, sections: sections.slice(0, 2) });
  }
  return hits.sort((a, b) => b.score - a.score || b.doc.d.localeCompare(a.doc.d)).slice(0, 12);
}

/** Wraps every match in <mark>. Matching runs on the raw text, so escaped entities are never split. */
function mark(text: string, query: string[]): string {
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return escape(text);
  const ranges: [number, number][] = [];
  for (const t of query) {
    for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + t.length)) ranges.push([i, i + t.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let html = '';
  let pos = 0;
  for (const [start, end] of ranges) {
    if (end <= pos) continue;
    const from = Math.max(start, pos);
    html += `${escape(text.slice(pos, from))}<mark>${escape(text.slice(from, end))}</mark>`;
    pos = end;
  }
  return html + escape(text.slice(pos));
}

function snippet(text: string, pos: number, query: string[]): string {
  if (!text) return '';
  const chars = [...text];
  const at = pos < 0 ? 0 : [...text.slice(0, pos)].length;
  const start = Math.max(0, at - 36);
  const end = Math.min(chars.length, start + 150);
  return `${start > 0 ? '…' : ''}${mark(chars.slice(start, end).join(''), query)}${end < chars.length ? '…' : ''}`;
}

const ICON = {
  file: '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8m8 4H8m2-8H8"/></svg>',
  hash: '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h16M4 15h16M10 3 8 21m8-18-2 18"/></svg>',
};

function item(href: string, icon: string, title: string, sub: string, body: string, query: string[]) {
  return `<a class="search-item" role="option" href="${escape(href)}" data-terms="${escape(JSON.stringify(query))}">${icon}<span class="search-title"><span class="search-name">${title}</span>${sub ? `<small>${sub}</small>` : ''}</span>${body ? `<span class="search-snippet">${body}</span>` : ''}</a>`;
}

function render() {
  const query = terms(input.value.trim());
  let html = '';

  if (!docs) {
    if (failed) html = '<div class="search-empty">Couldn’t load the search index. Check your connection and try again.</div>';
    else if (query.length) html = '<div class="search-empty">Loading…</div>';
  } else if (!query.length) {
    html = '<p class="search-group">Recent</p>';
    for (const doc of docs.slice(0, 6)) html += item(doc.u, ICON.file, escape(doc.t), escape(doc.c ? `${doc.c} · ${doc.f}` : doc.f), '', []);
  } else {
    const hits = search(query);
    if (!hits.length) {
      html = `<div class="search-empty">No results for “${escape(input.value.trim())}”</div>`;
    }
    for (const { doc, sections } of hits) {
      const [first, second] = sections;
      const section = first ? doc.s[first.index] : undefined;
      const href = section?.[0] ? `${doc.u}#${section[0]}` : doc.u;
      html += item(
        href,
        ICON.file,
        mark(doc.t, query),
        section?.[1] ? escape(section[1]) : '',
        first ? snippet(section![2], first.pos, query) : '',
        query,
      );
      if (second) {
        const s = doc.s[second.index];
        html += item(s[0] ? `${doc.u}#${s[0]}` : doc.u, ICON.hash, mark(s[1] || doc.t, query), '', snippet(s[2], second.pos, query), query);
      }
    }
  }

  list.innerHTML = html ? `<div class="search-cursor instant" aria-hidden="true"></div>${html}` : '';
  cursor = list.querySelector<HTMLElement>('.search-cursor');
  items = [...list.querySelectorAll<HTMLAnchorElement>('.search-item')];
  items.forEach((el, i) => (el.id = `SearchOption${i}`));
  [...list.children].forEach((el, i) => (el as HTMLElement).style.setProperty('--i', String(i)));
  // Results cascade in when the dialog opens; while typing they update in place.
  list.classList.toggle('fresh', fresh);
  if (items.length) fresh = false;
  select(0, false);
  requestAnimationFrame(() => cursor?.classList.remove('instant'));
}

function select(index: number, scroll = true) {
  if (!items.length) {
    input.removeAttribute('aria-activedescendant');
    return;
  }
  selected = (index + items.length) % items.length;
  const item = items[selected];
  items.forEach((el, i) => el.setAttribute('aria-selected', String(i === selected)));
  input.setAttribute('aria-activedescendant', item.id);
  if (cursor) {
    cursor.style.setProperty('--y', `${item.offsetTop}px`);
    cursor.style.setProperty('--h', `${item.offsetHeight}px`);
  }
  if (scroll) item.scrollIntoView({ block: 'nearest' });
}

function go(el: HTMLAnchorElement, newTab = false) {
  const url = new URL(el.href);
  const query = JSON.parse(el.dataset.terms || '[]') as string[];
  if (newTab) return window.open(url, '_blank', 'noopener');
  const samePage = url.pathname === location.pathname;
  closeSearch(!samePage);
  if (samePage) {
    history.replaceState(history.state, '', url.hash || location.pathname);
    const target = url.hash ? document.getElementById(decodeURIComponent(url.hash.slice(1))) : null;
    highlightTerms(query, false);
    // Glide there, and mark the landing.
    scrollToY(target ? headingTarget(target) : 0, () => flash(target));
    return;
  }
  try {
    if (query.length) sessionStorage.setItem(HIGHLIGHT_KEY, JSON.stringify({ path: url.pathname, terms: query }));
  } catch {}
  location.href = url.href;
}

input.addEventListener('input', () => {
  if (!docs && !loading) load();
  render();
});
// A mobile keyboard can submit the form without a preceding Enter key event.
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!composing && items[selected]) go(items[selected]);
});

input.addEventListener('keydown', (e) => {
  if (composing || e.isComposing || e.keyCode === 229) return;
  if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
    e.preventDefault();
    select(selected + 1);
  } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
    e.preventDefault();
    select(selected - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (items[selected]) go(items[selected], e.metaKey || e.ctrlKey);
  }
});

list.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' || !finePointer.matches) return;
  const el = (e.target as Element).closest<HTMLAnchorElement>('.search-item');
  const index = el ? items.indexOf(el) : -1;
  if (index !== -1 && index !== selected) select(index, false);
});

list.addEventListener('click', (e) => {
  const el = (e.target as Element).closest<HTMLAnchorElement>('.search-item');
  if (!el || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  go(el);
});
