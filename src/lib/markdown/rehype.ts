import type { Element, ElementContent, Nodes, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';

interface HtmlFile {
  path?: string;
  data: { astro?: { frontmatter?: Record<string, any> } };
}

// Article text is at most 48rem; smaller screens subtract page and column gutters.
const IMAGE_SIZES = '(min-width: 56rem) 48rem, (min-width: 40rem) 86vw, (min-width: 31.25rem) 92vw, calc(100vw - 2.5rem)';
const IMAGE_WIDTHS = [480, 640, 800, 1200, 1600];

const el = (tagName: string, properties: Element['properties'], children: ElementContent[] = []): Element => ({
  type: 'element',
  tagName,
  properties,
  children,
});

const classes = (node: Element): string[] => {
  const c: unknown = node.properties?.className;
  return Array.isArray(c) ? c.map(String) : typeof c === 'string' ? c.split(' ') : [];
};

/** Raw HTML passed through from Markdown (`allowDangerousHtml`); hast's own types don't list it. */
interface Raw {
  type: 'raw';
  value: string;
}

const isRaw = (node: { type: string }): node is Raw => node.type === 'raw';

export function hastText(node: Nodes | Raw, skip?: (el: Element) => boolean): string {
  if (isRaw(node)) return node.value.replace(/<[^>]+>/g, ' ');
  if (node.type === 'text') return node.value;
  if (node.type === 'element' && skip?.(node)) return ' ';
  if ('children' in node) return node.children.map((c) => hastText(c as Nodes, skip)).join('');
  return '';
}

/** `<center>` and markdown backticks inside raw HTML blocks from the Jekyll days. */
export function rehypeLegacyHtml() {
  return (tree: Root) => {
    visit(tree, (node: { type: string }) => {
      if (!isRaw(node) || !/<(center|table)\b/i.test(node.value)) return;
      node.value = node.value
        .replace(/<center>/gi, '<p class="center">')
        .replace(/<\/center>/gi, '</p>')
        .replace(/`([^`\n]+)`/g, '<code>$1</code>');
    });
  };
}

/** An image within the first few blocks is likely the LCP element, so it should not be lazy. */
function leadingImage(tree: Root): Element | undefined {
  let seen = 0;
  for (const child of tree.children) {
    if (child.type !== 'element') continue;
    if (++seen > 4) return;
    let found: Element | undefined;
    visit(child, 'element', (node) => {
      if (node.tagName === 'img') {
        found = node;
        return false;
      }
    });
    if (found) return found;
  }
}

const CAPTION_NOISE = /^(img|image|图片|截图|screenshot|pic|photo)$|^image-\d+|\.(png|jpe?g|gif|webp|avif|svg)$|^[\w-]{18,}$|^\d+$/i;

export function rehypeArticle() {
  return (tree: Root, file: HtmlFile) => {
    const isPage = /[\\/]pages[\\/][^\\/]+$/.test(file.path ?? '');
    const lcp = leadingImage(tree);

    // The page title is the only h1, and levels never skip (## → #### becomes h3), which keeps
    // the outline valid for screen readers. A class preserves the size the author picked.
    let level = 1;
    visit(tree, 'element', (node) => {
      const depth = /^h([1-6])$/.exec(node.tagName)?.[1];
      if (!depth) return;
      const wanted = Math.max(2, Number(depth));
      const actual = Math.min(wanted, level + 1);
      if (actual !== Number(depth)) {
        node.tagName = `h${actual}`;
        node.properties.className = [...classes(node), `h${wanted}`];
      }
      level = actual;
    });

    visit(tree, 'element', (node, index, parent) => {
      if (!parent || index === undefined) return;
      const tag = node.tagName;

      if (/^h[2-4]$/.test(tag) && node.properties.id) {
        node.children.unshift(
          el('a', {
            className: ['anchor'],
            href: `#${node.properties.id}`,
            ariaLabel: `Link to “${hastText(node).trim()}”`,
          }),
        );
        // Step past the anchor; the heading's own links and images are still processed.
        return;
      }

      if (tag === 'pre' && !classes(node).includes('mermaid')) {
        const lang = String(node.properties.dataLanguage ?? '');
        const children: ElementContent[] = [
          node,
          el('button', { type: 'button', className: ['code-copy'], ariaLabel: 'Copy code', title: 'Copy' }),
        ];
        parent.children[index] = el(
          'div',
          {
            className: ['code'],
            dataLang: lang && lang !== 'plaintext' ? lang : undefined,
          },
          children,
        );
        return [SKIP, index + 1];
      }

      if (tag === 'table') {
        // The table's own children (links, images) are still visited after wrapping.
        parent.children[index] = el('div', { className: ['table'] }, [node]);
        return;
      }

      if (tag === 'p') {
        const kids = node.children.filter((c) => !(c.type === 'text' && !c.value.trim()));
        const only = kids.length === 1 ? kids[0] : undefined;
        const img =
          only?.type === 'element' && only.tagName === 'img'
            ? only
            : only?.type === 'element' && only.tagName === 'a' && only.children.length === 1 && (only.children[0] as Element).tagName === 'img'
              ? (only.children[0] as Element)
              : undefined;
        if (img) {
          node.tagName = 'figure';
          const alt = String(img.properties.alt ?? '').trim();
          if (alt && !CAPTION_NOISE.test(alt)) node.children = [...kids, el('figcaption', {}, [{ type: 'text', value: alt }])];
        }
        return;
      }

      if (tag === 'img') {
        const src = String(node.properties.src ?? '');
        if (!/^[a-z]+:/i.test(src)) {
          node.properties.sizes = IMAGE_SIZES;
          // Read by Astro's image service (number[]); hast types `widths` as the SVG string attribute.
          (node.properties as Record<string, unknown>).widths = [...IMAGE_WIDTHS];
        }
        if (node === lcp) {
          node.properties.loading = 'eager';
          node.properties.fetchpriority = 'high';
        } else {
          node.properties.loading = 'lazy';
        }
        node.properties.decoding = 'async';
        return;
      }

      if (tag === 'a') {
        const href = String(node.properties.href ?? '');
        if (/^https?:\/\//i.test(href) && !href.startsWith('https://sh10rl.top')) {
          node.properties.target = '_blank';
          node.properties.rel = ['noopener', 'noreferrer'];
          if (isPage) {
            try {
              node.properties.dataHost = new URL(href).host.replace(/^www\./, '');
            } catch {}
            // Calling cards on the friends page: a monogram in a colour of its own.
            const name = hastText(node).trim();
            const initial = [...name][0];
            if (initial) {
              node.properties.dataInitial = initial.toUpperCase();
              let hash = 0;
              for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
              node.properties.style = `--hue: ${hash % 360}`;
            }
          }
        }
      }
    });
  };
}

const SEARCH_SKIP = (node: Element) => {
  const c = classes(node);
  return c.includes('katex') || c.includes('anchor') || node.tagName === 'button' || c.includes('callout-title');
};

/** Splits the article into [id, heading, text] sections for the search index. */
export function rehypeSections() {
  return (tree: Root, file: HtmlFile) => {
    const derived = file.data.astro?.frontmatter?.derived;
    if (!derived) return;
    const sections: [string, string, string][] = [['', '', '']];
    const toc: { depth: number; slug: string; text: string }[] = [];
    for (const node of tree.children) {
      if (node.type === 'element' && /^h[23]$/.test(node.tagName)) {
        const text = hastText(node, SEARCH_SKIP).replace(/\s+/g, ' ').trim();
        const slug = String(node.properties.id ?? '');
        sections.push([slug, text, '']);
        if (slug) toc.push({ depth: Number(node.tagName[1]), slug, text });
        continue;
      }
      let text = hastText(node as Nodes, SEARCH_SKIP);
      if (node.type === 'element' && classes(node).includes('code')) text = text.slice(0, 1500);
      sections[sections.length - 1][2] += ` ${text}`;
    }
    derived.toc = toc;
    derived.sections = sections
      .map(([id, heading, text]) => [id, heading, text.replace(/\s+/g, ' ').trim()] as [string, string, string])
      .filter(([, heading, text]) => heading || text);
  };
}
