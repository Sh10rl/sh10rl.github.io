import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark';
import type { AstroIntegration } from 'astro';
import { remarkLegacy } from '../src/lib/markdown/remark';

const IMAGE = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i;

async function filesIn(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function unusedImages(): AstroIntegration {
  let root: string;
  let dispose: (() => void) | undefined;

  return {
    name: 'unused-images',
    hooks: {
      'astro:config:done': ({ config }) => {
        root = fileURLToPath(config.root);
      },
      'astro:server:setup': async ({ server, logger }) => {
        const contentDirs = ['posts', 'pages'].map((dir) => path.join(root, dir));
        const imageDir = path.join(root, 'assets/img');
        // Reuse the site's parser and legacy URL handling, including reference-style images and Typora HTML.
        const processor = await createMarkdownProcessor({
          remarkPlugins: [remarkLegacy],
          syntaxHighlight: false,
          smartypants: false,
        });
        const cache = new Map<string, { source: string; images: string[] }>();
        let previous: string | undefined;
        let timer: NodeJS.Timeout | undefined;
        let running = false;
        let pending = false;
        let imagesChanged = false;
        let closed = false;

        async function scan() {
          if (closed) return;
          if (running) {
            pending = true;
            return;
          }
          running = true;
          try {
            if (imagesChanged) {
              cache.clear();
              imagesChanged = false;
            }
            const [images, ...content] = await Promise.all([imageDir, ...contentDirs].map(filesIn));
            const markdown = content.flat().filter((file) => file.endsWith('.md'));
            const used = new Set<string>();
            for (const file of markdown) {
              const source = await readFile(file, 'utf8');
              let entry = cache.get(file);
              if (entry?.source !== source) {
                const { content, frontmatter } = parseFrontmatter(source);
                const result = await processor.render(content, { fileURL: pathToFileURL(file), frontmatter });
                entry = { source, images: result.metadata.localImagePaths };
                cache.set(file, entry);
              }
              for (const image of entry.images) used.add(path.resolve(path.dirname(file), image));
            }
            const existing = new Set(markdown);
            for (const file of cache.keys()) if (!existing.has(file)) cache.delete(file);
            const unused = images
              .filter((file) => IMAGE.test(file) && !used.has(file))
              .map((file) => path.relative(root, file).split(path.sep).join('/'))
              .sort();
            const report = unused.join('\n');
            if (!closed && report !== previous) {
              if (unused.length) {
                logger.warn(`Found ${unused.length} image${unused.length === 1 ? '' : 's'} not referenced in Markdown (report only; nothing is deleted automatically):\n${unused.map((file) => `  ${file}`).join('\n')}`);
              } else {
                logger.info('All images in assets/img are referenced in Markdown.');
              }
              previous = report;
            }
          } catch (error) {
            previous = undefined;
            if (!closed) logger.error(`Unused image check failed: ${error instanceof Error ? error.message : String(error)}`);
          } finally {
            running = false;
            if (pending) {
              pending = false;
              schedule();
            }
          }
        }

        function schedule() {
          if (closed) return;
          clearTimeout(timer);
          timer = setTimeout(() => void scan(), 250);
        }

        function onChange(event: string, file: string) {
          if (!['add', 'change', 'unlink', 'addDir', 'unlinkDir'].includes(event)) return;
          const relative = path.relative(root, file).split(path.sep).join('/');
          if (/^assets\/img(?:\/|$)/.test(relative)) {
            // A newly added file can change how a legacy image URL resolves.
            imagesChanged = true;
            schedule();
          } else if (/^(?:posts|pages)(?:\/|$)/.test(relative) && (relative.endsWith('.md') || event.endsWith('Dir'))) {
            schedule();
          }
        }

        server.watcher.add([imageDir, ...contentDirs]);
        server.watcher.on('all', onChange);
        dispose = () => {
          closed = true;
          clearTimeout(timer);
          server.watcher.off('all', onChange);
        };
        await scan();
      },
      'astro:server:done': () => dispose?.(),
    },
  };
}
