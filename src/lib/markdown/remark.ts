import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Blockquote, Code, Image, Nodes, Paragraph, Root, Text } from 'mdast';
import { SKIP, visit } from 'unist-util-visit';

interface MdFile {
  path?: string;
  data: { astro?: { frontmatter?: Record<string, any> } };
}

const ROOT = process.cwd();

export function toText(node: Nodes): string {
  if ('value' in node && node.type !== 'html') return node.value;
  if ('children' in node) return node.children.map((c) => toText(c as Nodes)).join('');
  return '';
}

/* ------------------------------------------------------------------------ */
/* Legacy Jekyll/Chirpy syntax. Handled here so post sources stay untouched. */
/* ------------------------------------------------------------------------ */

const PROMPT_KIND: Record<string, string> = {
  info: 'note',
  tip: 'tip',
  warning: 'warning',
  danger: 'caution',
};
const PROMPT_RE = /\s*\{:\s*\.prompt-(\w+)\s*\}\s*$/;
// kramdown only accepts a span IAL written directly after the element, with no space between.
const IAL_RE = /^\{:[^}]*\}/;

const LANG_ALIAS: Record<string, string> = {
  plain: 'plaintext',
  text: 'plaintext',
  txt: 'plaintext',
  assembly: 'asm',
  'c++': 'cpp',
  sh: 'bash',
  shell: 'bash',
  ps1: 'powershell',
};

function lastText(node: Nodes): Text | undefined {
  if (node.type === 'text') return node;
  if (!('children' in node)) return;
  for (let i = node.children.length - 1; i >= 0; i--) {
    const hit = lastText(node.children[i] as Nodes);
    if (hit) return hit;
  }
}

function isBlank(node: Nodes): boolean {
  return toText(node).trim() === '' && !hasMedia(node);
}

function hasMedia(node: Nodes): boolean {
  if (node.type === 'image' || node.type === 'imageReference' || node.type === 'html') return true;
  return 'children' in node && node.children.some((c) => hasMedia(c as Nodes));
}

/** Rewrites image URLs to paths relative to the post, so `/assets/..`, `assets/..` and `../assets/..` all work. */
function resolveImage(url: string, dir: string): string {
  if (/^[a-z][a-z\d+.-]*:|^\/\/|^#/i.test(url)) return url;
  let clean = url;
  try {
    clean = decodeURI(url);
  } catch {}
  clean = clean.split(/[?#]/)[0];
  const candidates = [
    clean.startsWith('/') ? path.join(ROOT, clean) : path.resolve(dir, clean),
    path.join(ROOT, clean.replace(/^(\.{1,2}\/)+|^\//g, '')),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    let rel = path.relative(dir, file).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return encodeURI(rel);
  }
  return url;
}

export function remarkLegacy() {
  return (tree: Root, file: MdFile) => {
    const dir = file.path ? path.dirname(file.path) : ROOT;
    const imageRefs = new Set<string>();

    visit(tree, (node, index, parent) => {
      if (node.type === 'image') {
        node.url = resolveImage(node.url, dir);
        return;
      }
      if (node.type === 'imageReference') {
        imageRefs.add(node.identifier.toLowerCase());
        return;
      }
      // Typora writes `<img src="…" style="zoom:50%">` when an image is resized.
      if (node.type === 'html' && parent && index !== undefined) {
        const image = htmlImage(node.value, dir);
        if (!image) return;
        parent.children[index] = (PHRASING_PARENT.has(parent.type) ? image : { type: 'paragraph', children: [image] }) as any;
        return SKIP;
      }
      if (node.type === 'code') {
        normalizeCode(node, index, parent);
        return SKIP;
      }
      // Span attribute lists directly after an element: `![](x.png){: width="972" }`, `[![](x)](url){: .normal }`
      if (node.type === 'text' && index && parent && parent.children[index - 1]?.type !== 'text') {
        node.value = node.value.replace(IAL_RE, '');
      }
    });

    // `[r]: /assets/img/x.png` used by `![alt][r]`
    if (imageRefs.size) {
      visit(tree, 'definition', (node) => {
        if (imageRefs.has(node.identifier.toLowerCase())) node.url = resolveImage(node.url, dir);
      });
    }

    // `> quote` + `{: .prompt-info }` on the following line (lazy continuation)
    visit(tree, 'blockquote', (node) => {
      const text = lastText(node);
      const m = text?.value.match(PROMPT_RE);
      if (!text || !m) return;
      text.value = text.value.slice(0, m.index);
      prune(node);
      markCallout(node, PROMPT_KIND[m[1].toLowerCase()] ?? 'note');
    });

    // Stand-alone attribute lists. After a blank `>` line or a fenced block, a prompt
    // marker is no longer part of the quote, so it arrives here as its own paragraph.
    visit(tree, 'paragraph', (node, index, parent) => {
      if (!parent || index === undefined) return;
      const value = toText(node);
      if (hasMedia(node) || !/^\s*(\{:[^}]*\}\s*)+$/.test(value)) return;
      const prompt = value.match(/\.prompt-(\w+)/);
      const prev = parent.children[index - 1];
      if (prompt && prev?.type === 'blockquote' && !isCallout(prev)) {
        markCallout(prev, PROMPT_KIND[prompt[1].toLowerCase()] ?? 'note');
      }
      parent.children.splice(index, 1);
      return [SKIP, index];
    });
  };
}

const PHRASING_PARENT = new Set(['paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link', 'linkReference', 'tableCell']);

function htmlImage(value: string, dir: string): Image | undefined {
  const tag = value.trim().match(/^<img\b([^>]*?)\/?>$/i);
  if (!tag) return;
  const attrs: Record<string, string> = {};
  for (const m of tag[1].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  if (!attrs.src) return;
  return { type: 'image', url: resolveImage(attrs.src, dir), alt: attrs.alt ?? '', title: attrs.title ?? null };
}

const isCallout = (node: Blockquote) => {
  const { hProperties } = (node.data ?? {}) as { hProperties?: { className?: unknown } };
  return Array.isArray(hProperties?.className) && hProperties.className.includes('callout');
};

function normalizeCode(node: Code, index: number | undefined, parent: any) {
  const lang = node.lang?.toLowerCase();
  node.lang = lang ? (LANG_ALIAS[lang] ?? lang) : lang;
  if (node.lang === 'mermaid' && parent && index !== undefined) {
    const escaped = node.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    parent.children[index] = { type: 'html', value: `<pre class="mermaid">${escaped}</pre>` };
  }
}

/** Drops paragraphs / list items left empty after stripping attribute lists. */
function prune(node: Nodes) {
  if (!('children' in node)) return;
  for (const child of node.children as Nodes[]) prune(child);
  (node as any).children = (node.children as Nodes[]).filter(
    (c) => !((c.type === 'paragraph' || c.type === 'listItem' || c.type === 'list') && isBlank(c)),
  );
  const last = lastText(node);
  if (last) last.value = last.value.replace(/\s+$/, '');
}

/* ------------------------------------------------------------------------ */
/* GitHub-style callouts: > [!NOTE]                                          */
/* ------------------------------------------------------------------------ */

const CALLOUT_LABEL: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};
const CALLOUT_RE = /^\[!(note|tip|important|warning|caution)\][ \t]*\n?/i;

function markCallout(node: Blockquote, kind: string) {
  node.data = {
    ...node.data,
    hName: 'div',
    hProperties: { className: ['callout'], dataKind: kind, role: 'note' },
  };
  const title: Paragraph = {
    type: 'paragraph',
    data: { hProperties: { className: ['callout-title'] } },
    children: [{ type: 'text', value: CALLOUT_LABEL[kind] }],
  };
  node.children.unshift(title);
}

export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, 'blockquote', (node) => {
      const first = node.children[0];
      if (first?.type !== 'paragraph') return;
      const head = first.children[0];
      if (head?.type !== 'text') return;
      const m = head.value.match(CALLOUT_RE);
      if (!m) return;
      head.value = head.value.slice(m[0].length);
      if (!head.value) first.children.shift();
      if (first.children[0]?.type === 'break') first.children.shift();
      if (!first.children.length) node.children.shift();
      markCallout(node, m[1].toLowerCase());
    });
  };
}

/* ------------------------------------------------------------------------ */
/* Derived metadata: title, excerpt, reading time, language                 */
/* ------------------------------------------------------------------------ */

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
const WORD = /[A-Za-z\u00c0-\u024f\d]+(?:['\u2019][A-Za-z]+)?/g;

function truncate(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max).join('');
  const soft = Math.max(cut.lastIndexOf(' '), cut.search(/[，。；、,.;][^，。；、,.;]*$/));
  return `${(soft > max * 0.6 ? cut.slice(0, soft) : cut).replace(/[\s,.;:，。；：、]+$/, '')}…`;
}

export interface DerivedMeta {
  title?: string;
  excerpt?: string;
  minutes: number;
  lang: string;
  mermaid: boolean;
  sections?: [string, string, string][];
  toc?: { depth: number; slug: string; text: string }[];
}

export function remarkMeta() {
  return (tree: Root, file: MdFile) => {
    const astro = (file.data.astro ??= {});
    const fm = (astro.frontmatter ??= {});
    const meta: DerivedMeta = { minutes: 1, lang: 'en', mermaid: false };

    // A leading `# Title` is the post title, not part of the body. It stays in the body
    // when front matter already names a different title, so no writing is lost.
    let lead = 0;
    while (
      tree.children[lead]?.type === 'definition' ||
      (tree.children[lead]?.type === 'html' && /^\s*<!--[\s\S]*-->\s*$/.test((tree.children[lead] as { value: string }).value))
    ) {
      lead++;
    }
    const first = tree.children[lead];
    if (first?.type === 'heading' && first.depth === 1) {
      const heading = toText(first).replace(/\s+/g, ' ').trim();
      const given = fm.title == null ? '' : String(fm.title).trim();
      if (!given || given === heading) {
        meta.title = heading;
        tree.children.splice(lead, 1);
      }
    }

    for (const node of tree.children) {
      if (node.type !== 'paragraph') continue;
      const text = toText(node).replace(/\s+/g, ' ').trim();
      if ([...text].length >= 12) {
        meta.excerpt = truncate(text, 150);
        break;
      }
    }

    let cjk = 0;
    let words = 0;
    let code = 0;
    visit(tree, (node) => {
      if (node.type === 'text' || node.type === 'inlineCode') {
        cjk += node.value.match(CJK)?.length ?? 0;
        words += node.value.match(WORD)?.length ?? 0;
      } else if (node.type === 'code') {
        code += node.value.match(WORD)?.length ?? 0;
        return SKIP;
      } else if (node.type === 'html' && node.value.startsWith('<pre class="mermaid"')) {
        meta.mermaid = true;
      }
    });
    meta.minutes = Math.max(1, Math.round(cjk / 400 + words / 230 + code / 600));
    meta.lang = cjk > words * 0.6 ? 'zh-CN' : 'en';

    fm.derived = meta;
  };
}
