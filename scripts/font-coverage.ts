import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

// Chinese is set in Noto Serif SC from two subsets that scripts/generate-fonts.py makes from the
// built pages: `home` for the index pages, `articles` for every other page. A character a page
// shows that its subsets lack loads a Google Fonts shard of 15 to 85 KB, or for an index page the
// whole `articles` subset. New posts did that to the home page unnoticed (590 KB of fonts for 14
// characters), so the build reports it. Latin is set in Source Serif 4 from one such subset, and a
// character of Google's Latin range that it lacks loads Google's whole file, 122 KB.

const HOME = 'noto-serif-sc-home.woff2';
const ARTICLES = 'noto-serif-sc-articles.woff2';
const LATIN = /source-serif-4-normal-latin\.woff2\) format\('woff2'\);\s*unicode-range:\s*([^;]+);/;

function codepoints(ranges: string) {
  const out = new Set<number>();
  for (const [, start, end] of ranges.matchAll(/U\+([0-9A-F]+)(?:-([0-9A-F]+))?/gi)) {
    for (let point = parseInt(start, 16); point <= parseInt(end ?? start, 16); point++) out.add(point);
  }
  return out;
}

/** What a page shows, as generate-fonts.py reads it: no scripts, styles, icons or Japanese. */
function shown(html: string) {
  return html
    .replace(/<(script|style|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(\w+)\b[^>]*\blang="ja[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*\bplaceholder="([^"]*)"[^>]*>/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' ');
}

export function fontCoverage(): AstroIntegration {
  let root: string;

  return {
    name: 'font-coverage',
    hooks: {
      'astro:config:done': ({ config }) => {
        root = fileURLToPath(config.root);
      },
      'astro:build:done': async ({ dir, logger }) => {
        const styles = (file: string) => readFile(path.join(root, 'src/styles', file), 'utf8');
        // Every face of Noto Serif SC, the shards' too: the code points the pages set in it.
        const cjk = (await styles('fonts-cjk.css')) + (await styles('fonts-cjk-shards.css'));
        const faces = new Map([...cjk.matchAll(/noto-serif-sc\/([^)]+)\)[^}]*?unicode-range:\s*([^;]+);/g)].map(([, file, ranges]) => [file, codepoints(ranges)]));
        const covered = new Set([...faces.values()].flatMap((points) => [...points]));
        const home = faces.get(HOME) ?? new Set<number>();
        const articles = faces.get(ARTICLES) ?? new Set<number>();
        // Source Serif 4's subset (fonts-latin.css) is taken before Google's Latin file (fonts.css).
        const google = codepoints((await styles('fonts.css')).match(LATIN)?.[1] ?? '');
        const site = codepoints((await styles('fonts-latin.css')).match(/unicode-range:\s*([^;]+);/)?.[1] ?? '');
        const out = fileURLToPath(dir);
        const index = new Set<string>();
        const other = new Set<string>();
        const latin = new Set<string>();
        for (const page of (await readdir(out, { recursive: true })).filter((file) => file.endsWith('.html'))) {
          const isIndex = page === 'index.html' || page.startsWith(`categories${path.sep}`);
          for (const char of shown(await readFile(path.join(out, page), 'utf8'))) {
            const point = char.codePointAt(0)!;
            if (google.has(point) && !site.has(point)) latin.add(char);
            if (!covered.has(point) || home.has(point) || (!isIndex && articles.has(point))) continue;
            (isIndex ? index : other).add(char);
          }
        }
        if (!index.size && !other.size && !latin.size) {
          logger.info('The font subsets cover every page.');
          return;
        }
        const lines = [];
        if (index.size) lines.push(`The index pages show ${index.size} Chinese characters missing from the home font subset, so they load larger font files: ${[...index].join('')}`);
        if (other.size) lines.push(`Pages show ${other.size} Chinese characters that neither font subset has, so they load extra font files: ${[...other].join('')}`);
        if (latin.size) lines.push(`Pages show ${latin.size} Latin characters missing from the Source Serif 4 subset, so they load Google's whole Latin file: ${[...latin].map((char) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')} ${char}`).join(', ')}`);
        logger.warn(`${lines.join('\n')}\nRun \`uv run scripts/generate-fonts.py\`, then build again.`);
      },
    },
  };
}
