/**
 * What a reader copies goes to the clipboard as Markdown, in plain text only. Inside an article a
 * selection reads back the way it was written: emphasis, code, links, images, lists, quotes,
 * callouts, tables, formulas and footnotes keep their syntax, code keeps its source, and nothing
 * the page adds around the text (heading anchors, copy buttons, fold bars, wrap hints) comes along.
 */

// Not text: controls, screen-reader labels, decorations, the page around the article, and captions
// that only repeat an image's alt text.
const SKIP = [
  'button',
  'input:not([type="checkbox"])',
  'script',
  'style',
  'template',
  'svg',
  '[hidden]',
  '[aria-hidden="true"]',
  '.anchor',
  '.sr-only',
  '.callout-title',
  'figcaption',
  '.code-fold',
  '.code-tools',
  '[data-footnote-backref]',
  '.toc-inline',
  '.post-meta',
  '.post-updated',
  '.post-foot',
  '.draft-badge',
].join(', ');
// Copied whole or not at all.
const ATOMIC = '.katex, pre.mermaid, [data-footnote-ref]';
const BLOCK = new Set([
  'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'dd', 'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul',
]);
// Selections inside these are a run of text, not blocks.
const PHRASING = 'p, h1, h2, h3, h4, h5, h6, td, th, figcaption, dt, summary';
const FOOTNOTE = 'user-content-fn-';
const WORD = /[\p{L}\p{N}]/u;

const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;
const longestTicks = (text: string) => Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
const indent = (text: string, width: number) => text.replace(/\n(?=.)/g, `\n${' '.repeat(width)}`);
const quote = (parts: string[]) =>
  parts.join('\n\n').split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');

/** Text as Markdown: characters that would turn into syntax are escaped, others left alone. */
const escapeText = (text: string) =>
  text
    .replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\')
    .replace(/[`$]/g, '\\$&')
    .replace(/\*/g, (star, i: number, s: string) => (/\s/.test(s[i - 1] ?? ' ') && /\s/.test(s[i + 1] ?? ' ') ? star : '\\*'))
    .replace(/_/g, (bar, i: number, s: string) => (WORD.test(s[i - 1] ?? '') && WORD.test(s[i + 1] ?? '') ? bar : '\\_'))
    .replace(/\](?=[([:])/g, '\\]')
    .replace(/<(?=[A-Za-z/!?])/g, '\\<')
    .replace(/&(?=#?\w+;)/g, '\\&');

/** A line of text that would otherwise start a heading, quote, list, rule or fence. */
const escapeLineStart = (line: string) =>
  line
    .replace(/^(#{1,6}(?=\s|$)|>|[-+](?=\s|$)|-+\s*$|=+\s*$|~~~)/, '\\$1')
    .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2');

const paragraph = (text: string) =>
  text
    .replace(/(\\\n\s*)+$/, '')
    .trim()
    .split('\n')
    .map((line) => escapeLineStart(line.trimStart()))
    .join('\n');

const wrap = (inner: string, mark: string) => {
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return core ? `${lead}${mark}${core}${mark}${trail}` : inner;
};

const codeSpan = (text: string) => {
  const code = text.replace(/\n/g, ' ');
  const ticks = '`'.repeat(longestTicks(code) + 1);
  const pad = code.trim() && /^[\s`]|[\s`]$/.test(code) ? ' ' : '';
  return code ? `${ticks}${pad}${code}${pad}${ticks}` : '';
};

const fence = (pre: Element) => {
  const mermaid = pre.classList.contains('mermaid');
  const code = ((mermaid && pre.getAttribute('data-source')) || pre.textContent || '').replace(/\n$/, '');
  const lang = mermaid ? 'mermaid' : (pre.getAttribute('data-language') ?? '').replace(/^plaintext$/, '');
  const ticks = '`'.repeat(Math.max(3, longestTicks(code) + 1));
  return `${ticks}${lang}\n${code}\n${ticks}`;
};

const tex = (el: Element) => (el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? el.textContent ?? '').trim();
const isDisplayMath = (el: Element) => el.matches('.katex') && !!el.querySelector('math[display="block"]');

const url = (href: string) => (/[\s()<>]/.test(href) ? `<${href.replace(/[\s<>]/g, encodeURIComponent)}>` : href);

const link = (a: HTMLAnchorElement) => {
  const href = a.getAttribute('href') ?? '';
  if (a.matches('[data-footnote-ref]')) return `[^${decodeURIComponent(href.replace(/^#user-content-fn-/, ''))}]`;
  const text = inline(a);
  if (!href || !text.trim()) return text;
  return a.textContent === href || a.textContent === a.href ? `<${a.href}>` : `[${text}](${url(a.href)})`;
};

function inline(parent: Node): string {
  let out = '';
  for (const node of parent.childNodes) out += inlineNode(node);
  return out;
}

function inlineNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.nodeValue ?? '');
  if (!isElement(node) || node.matches(SKIP)) return '';
  if (node.matches('.katex')) return isDisplayMath(node) ? `$$${tex(node)}$$` : `$${tex(node)}$`;
  switch (node.localName) {
    case 'br':
      return '\\\n';
    case 'strong':
    case 'b':
      return wrap(inline(node), '**');
    case 'em':
    case 'i':
      return wrap(inline(node), '*');
    case 'del':
    case 's':
      return wrap(inline(node), '~~');
    case 'code':
    case 'kbd':
    case 'samp':
      return codeSpan(node.textContent ?? '');
    case 'img': {
      const { alt, src } = node as HTMLImageElement;
      return src ? `![${alt.replace(/[[\]\\]/g, '\\$&')}](${url(src)})` : '';
    }
    case 'a':
      return link(node as HTMLAnchorElement);
    case 'input':
      return (node as HTMLInputElement).checked ? '[x] ' : '[ ] ';
    case 'math':
      return `$${tex(node)}$`;
  }
  // A block met inside a line keeps its words apart from their neighbours.
  return BLOCK.has(node.localName) ? ` ${inline(node)} ` : inline(node);
}

function blocks(parent: Node): string[] {
  const out: string[] = [];
  let line = '';
  const flush = () => {
    const text = paragraph(line);
    if (text) out.push(text);
    line = '';
  };
  for (const node of parent.childNodes) {
    if (isElement(node) && (BLOCK.has(node.localName) || isDisplayMath(node))) {
      if (node.matches(SKIP)) continue;
      flush();
      const text = block(node);
      if (text) out.push(text);
    } else line += inlineNode(node);
  }
  flush();
  return out;
}

function block(el: Element): string {
  const heading = /^h([1-6])$/.exec(el.localName);
  if (heading) {
    const text = paragraph(inline(el)).replace(/\s*\n\s*/g, ' ');
    // A heading drawn at another size than its level (rehype.ts) was written at that size.
    const level = /(?:^|\s)h([1-6])(?:\s|$)/.exec(el.className)?.[1] ?? heading[1];
    return text && `${'#'.repeat(Number(level))} ${text}`;
  }
  if (isDisplayMath(el)) return `$$\n${tex(el)}\n$$`;
  if (el.matches('.callout')) {
    const [first = '', ...rest] = blocks(el);
    return quote([`[!${(el.getAttribute('data-kind') ?? 'note').toUpperCase()}]\n${first}`.trimEnd(), ...rest]);
  }
  switch (el.localName) {
    case 'p':
      return paragraph(inline(el));
    case 'hr':
      return '---';
    case 'pre':
      return fence(el);
    case 'blockquote':
      return quote(blocks(el));
    case 'ul':
    case 'ol':
      return list(el);
    case 'table':
      return table(el);
  }
  return blocks(el).join('\n\n');
}

function list(el: Element): string {
  const items = [...el.children].filter((child) => child.localName === 'li' && !child.matches(SKIP));
  if (items.length && items.every((li) => li.id.startsWith(FOOTNOTE))) {
    return items
      .map((li) => `[^${decodeURIComponent(li.id.slice(FOOTNOTE.length))}]: ${indent(blocks(li).join('\n\n'), 4)}`)
      .join('\n\n');
  }
  const first = Number(el.getAttribute('data-md-start') ?? el.getAttribute('start') ?? 1);
  const loose = items.some((li) => [...li.children].some((child) => child.localName === 'p'));
  return items
    .map((li, i) => {
      const marker = el.localName === 'ol' ? `${first + i}. ` : '- ';
      return marker + indent(blocks(li).join(loose ? '\n\n' : '\n'), marker.length);
    })
    .join(loose ? '\n\n' : '\n');
}

function table(el: Element): string {
  const rows = [...el.querySelectorAll('tr')]
    .filter((tr) => tr.closest('table') === el)
    .map((tr) => [...tr.children].filter((cell) => cell.localName === 'th' || cell.localName === 'td'));
  if (!rows.length) return '';
  const text = rows.map((cells) => cells.map((cell) => paragraph(inline(cell)).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')));
  const width = Math.max(...text.map((cells) => cells.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  const align = Array.from({ length: width }, (_, i) => {
    const side = rows[0][i]?.getAttribute('align');
    return side === 'center' ? ':---:' : side === 'right' ? '---:' : side === 'left' ? ':---' : '---';
  });
  return [line(text[0]), `| ${align.join(' | ')} |`, ...text.slice(1).map(line)].join('\n');
}

function rangeMarkdown(selected: Range, root: Element): string {
  const range = selected.cloneRange();
  if (!root.contains(range.startContainer)) range.setStart(root, 0);
  if (!root.contains(range.endContainer)) range.setEnd(root, root.childNodes.length);
  const element = (node: Node) => (isElement(node) ? node : node.parentElement);
  const startAtom = element(range.startContainer)?.closest(ATOMIC);
  const endAtom = element(range.endContainer)?.closest(ATOMIC);
  if (startAtom) range.setStartBefore(startAtom);
  if (endAtom) range.setEndAfter(endAtom);
  const context = element(range.commonAncestorContainer)!;

  // Code is copied as it stands, without fences or escapes.
  if (context.closest('pre, code, kbd, samp')) return range.cloneContents().textContent ?? '';

  // An ordered list copied from its third item still starts at 3: the clones carry the number.
  const numbered: Element[] = [];
  for (let el = element(range.startContainer); el && el !== root; el = el.parentElement) {
    const ol = el.parentElement;
    if (el.localName !== 'li' || ol?.localName !== 'ol') continue;
    ol.setAttribute('data-md-start', String(Number(ol.getAttribute('start') ?? 1) + [...ol.children].indexOf(el)));
    numbered.push(ol);
  }
  try {
    const fragment = range.cloneContents();
    // A selection within one list, quote or table keeps that structure around its pieces.
    if (context.matches('ol, ul, blockquote, .callout, table')) {
      const shell = context.cloneNode(false) as Element;
      shell.append(fragment);
      return block(shell);
    }
    if (context.matches('thead, tbody, tfoot, tr')) {
      const source = context.closest('table')!;
      const shell = source.cloneNode(false) as Element;
      if (context.localName !== 'thead' && source.tHead) shell.append(source.tHead.cloneNode(true));
      const section = (context.localName === 'tr' ? context.parentElement! : context).cloneNode(false) as Element;
      const row = context.localName === 'tr' ? (context.cloneNode(false) as Element) : section;
      row.append(fragment);
      if (row !== section) section.append(row);
      shell.append(section);
      return table(shell);
    }
    if (context.matches(PHRASING) || !BLOCK.has(context.localName)) return paragraph(inline(fragment));
    return blocks(fragment).join('\n\n');
  } finally {
    for (const ol of numbered) ol.removeAttribute('data-md-start');
  }
}

/** The selection as Markdown; outside an article, its plain text. */
export function selectionMarkdown(selection: Selection): string {
  const prose = document.querySelector('[data-article]');
  const root = prose?.closest('article') ?? prose;
  const parts: string[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    if (root && range.intersectsNode(root)) parts.push(rangeMarkdown(range, root));
  }
  return parts.filter(Boolean).join('\n\n') || selection.toString();
}
