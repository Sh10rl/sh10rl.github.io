import type { AstroIntegration } from 'astro';
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import { visit } from 'unist-util-visit';
import { isDraftPath, slugify } from '../lib/slug';
import { site } from '../site.config';

class EditorError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const titleOf = (markdown: string) => {
  const parsed = parseFrontmatter(markdown);
  return String(parsed.frontmatter.title ?? parsed.content.match(/^#\s+(.+)$/m)?.[1] ?? '').trim();
};

export function localEditor(): AstroIntegration {
  let root = '';
  let renderer: ReturnType<typeof createMarkdownProcessor> | undefined;
  let createRenderer: () => ReturnType<typeof createMarkdownProcessor>;
  let writes: Promise<unknown> = Promise.resolve();

  const resolvePost = async (relative: string) => {
    if (!relative || relative.includes('\\') || relative.split('/').some((part) => !part || part.startsWith('.')) || !relative.endsWith('.md')) {
      throw new EditorError(400, 'Invalid article path.');
    }
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) throw new EditorError(400, 'Invalid article path.');
    const actual = await realpath(file);
    if (actual !== file || (await lstat(file)).isSymbolicLink()) throw new EditorError(400, 'Symlinks cannot be edited.');
    return file;
  };

  const list = async (folder = ''): Promise<string[]> => {
    const entries = await readdir(path.join(root, folder), { withFileTypes: true });
    const nested = await Promise.all(entries.filter((entry) => !entry.name.startsWith('.') && !entry.isSymbolicLink()).map(async (entry) => {
      const relative = path.posix.join(folder, entry.name);
      return entry.isDirectory() ? list(relative) : entry.name.endsWith('.md') ? [relative] : [];
    }));
    return nested.flat();
  };

  const open = async (relative: string) => {
    const markdown = await readFile(await resolvePost(relative), 'utf8');
    const id = (isDraftPath(relative) ? '_' : '') + slugify(path.basename(relative, '.md'));
    return { path: relative, markdown, version: hash(markdown), title: titleOf(markdown), url: `/posts/${encodeURIComponent(id)}/` };
  };

  const save = async (data: Record<string, unknown>) => {
    if (typeof data.markdown !== 'string' || !data.markdown.trim()) throw new EditorError(400, 'Write an article before saving.');
    const markdown = data.markdown.endsWith('\n') ? data.markdown : data.markdown + '\n';
    let relative: string;
    if (typeof data.path === 'string' && data.path) {
      relative = data.path;
      const file = await resolvePost(relative);
      const current = await readFile(file, 'utf8');
      if (data.version !== hash(current)) throw new EditorError(409, 'This file changed on disk. Reload it before saving. Your text is kept here.');
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, markdown, 'utf8');
      await rename(temporary, file);
    } else {
      const title = titleOf(markdown);
      if (!title) throw new EditorError(400, 'Start the article with a # title.');
      const category = typeof data.category === 'string' ? data.category.trim() : '';
      if (category && slugify(category) !== category) throw new EditorError(400, 'Use a simple category name.');
      const parts = new Intl.DateTimeFormat('en', { timeZone: site.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const date = ['year', 'month', 'day'].map((part) => parts.find((p) => p.type === part)!.value).join('-');
      const used = new Set((await list()).map((file) => slugify(path.basename(file, '.md'))));
      const base = slugify(title).slice(0, 80) || 'article';
      let slug = base;
      for (let suffix = 2; used.has(slug); suffix++) slug = `${base}-${suffix}`;
      relative = path.posix.join(category, `${date}-${slug}.md`);
      const folder = path.join(root, category);
      await mkdir(folder, { recursive: true });
      if (await realpath(folder) !== folder) throw new EditorError(400, 'Symlinks cannot be edited.');
      await writeFile(path.join(root, relative), markdown, { encoding: 'utf8', flag: 'wx' });
    }
    return open(relative);
  };

  return {
    name: 'local-markdown-editor',
    hooks: {
      'astro:config:setup': ({ command, config, injectRoute }) => {
        if (command !== 'dev') return;
        root = path.join(fileURLToPath(config.root), 'posts');
        const { markdown, image } = config;
        createRenderer = () => markdown.processor.createRenderer({ image, syntaxHighlight: markdown.syntaxHighlight, shikiConfig: markdown.shikiConfig, gfm: markdown.gfm, smartypants: markdown.smartypants });
        injectRoute({ pattern: '/write/', entrypoint: new URL('../dev/Editor.astro', import.meta.url), prerender: false });
      },
      'astro:server:setup': ({ server, refreshContent }) => {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/__editor/')) return next();
          const send = (status: number, value: unknown) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(value));
          };
          void (async () => {
            const url = new URL(req.url!, `http://${req.headers.host}`);
            if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new EditorError(403, 'The editor is available on localhost.');
            if (req.method === 'GET' && url.pathname === '/__editor/posts') {
              const files = await list();
              return send(200, await Promise.all(files.map(async (file) => ({ path: file, title: titleOf(await readFile(path.join(root, file), 'utf8')) || path.basename(file, '.md') }))));
            }
            if (req.method === 'GET' && url.pathname === '/__editor/post') return send(200, await open(url.searchParams.get('path') ?? ''));
            if (req.method !== 'POST' || !['/__editor/save', '/__editor/preview'].includes(url.pathname)) throw new EditorError(404, 'Not found.');
            if (req.headers.origin !== url.origin || !req.headers['content-type']?.startsWith('application/json')) throw new EditorError(403, 'Invalid editor request.');
            const chunks: Buffer[] = [];
            let bytes = 0;
            for await (const chunk of req) {
              bytes += chunk.length;
              if (bytes > 2 * 1024 * 1024) throw new EditorError(413, 'The article exceeds 2 MB.');
              chunks.push(Buffer.from(chunk));
            }
            let data: Record<string, unknown>;
            try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
            catch { throw new EditorError(400, 'Invalid JSON.'); }
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new EditorError(400, 'Invalid article.');
            if (url.pathname === '/__editor/preview') {
              if (typeof data.markdown !== 'string') throw new EditorError(400, 'Markdown is required.');
              renderer ??= createRenderer();
              const parsed = parseFrontmatter(data.markdown);
              const file = typeof data.path === 'string' && data.path ? await resolvePost(data.path) : path.join(root, '_editor.md');
              const result = await (await renderer).render(parsed.content, { frontmatter: parsed.frontmatter, fileURL: pathToFileURL(file) });
              const tree = fromHtml(result.code, { fragment: true });
              visit(tree, 'element', (node) => {
                if (node.tagName !== 'img') return;
                const placeholder = Object.keys(node.properties).find((key) => key.toLowerCase() === '__astro_image_');
                if (!placeholder) return;
                const props = JSON.parse(String(node.properties[placeholder]));
                if (typeof props.src !== 'string') return;
                if (!/^https?:\/\//i.test(props.src)) {
                  const image = path.resolve(path.dirname(file), props.src);
                  if (!image.startsWith(path.dirname(root) + path.sep)) return;
                  props.src = '/@fs' + encodeURI(image);
                }
                node.properties = { ...props, decoding: 'async' };
              });
              return send(200, { html: toHtml(tree), title: titleOf(data.markdown) });
            }
            const operation = writes.then(async () => {
              const article = await save(data);
              await refreshContent?.({ loaders: ['glob-loader'] });
              return article;
            });
            writes = operation.catch(() => {});
            send(200, await operation);
          })().catch((error: unknown) => {
            if (error instanceof EditorError) send(error.status, { error: error.message });
            else if ((error as NodeJS.ErrnoException).code === 'ENOENT') send(404, { error: 'Article not found.' });
            else send(400, { error: error instanceof Error ? error.message : 'Unable to save the article.' });
          });
        });
      },
    },
  };
}
