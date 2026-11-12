import { fileURLToPath } from 'node:url';
import { rehypeHeadingIds, unified } from '@astrojs/markdown-remark';
import { defineConfig } from 'astro/config';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { fontCoverage } from './scripts/font-coverage';
import { unusedImages } from './scripts/unused-images';
import { rehypeArticle, rehypeLegacyHtml, rehypeSections } from './src/lib/markdown/rehype';
import { remarkCallouts, remarkLegacy, remarkMathLines, remarkMeta, remarkTableSource } from './src/lib/markdown/remark';
import { shikiContrast } from './src/lib/markdown/shiki-contrast';
import { shikiFold } from './src/lib/markdown/shiki-fold';
import { site } from './src/site.config';

// Lightning CSS encodes browser versions as (major << 16) | (minor << 8).
const v = (major: number, minor = 0) => (major << 16) | (minor << 8);

export default defineConfig({
  site: site.url,
  compressHTML: true,
  // GitHub Pages lets browsers keep a file for ten minutes. A linked stylesheet costs a first visit
  // a round trip before anything is painted, and the fonts and the paper's grain it names are only
  // found once it has arrived. In the page, the CSS comes with the HTML.
  build: { inlineStylesheets: 'always' },
  integrations: [unusedImages(), fontCoverage()],
  devToolbar: { enabled: false },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  redirects: {
    '/page2/': '/',
    '/archives/': '/',
    '/categories/': '/',
  },
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: { webp: { quality: 82, effort: 5, smartSubsample: true } },
    },
  },
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath, remarkMathLines, remarkLegacy, remarkCallouts, remarkTableSource, remarkMeta],
      rehypePlugins: [
        rehypeLegacyHtml,
        [rehypeKatex, { output: 'mathml', throwOnError: false, strict: false }],
        rehypeHeadingIds,
        rehypeArticle,
        rehypeSections,
      ],
      remarkRehype: { footnoteBackContent: () => [] },
    }),
    shikiConfig: {
      themes: { light: 'vitesse-light', dark: 'vitesse-dark' },
      defaultColor: false,
      transformers: [shikiContrast(), shikiFold()],
    },
  },
  vite: {
    server: {
      // Native file events are lost on WSL Windows mounts; poll only there.
      watch: process.env.WSL_DISTRO_NAME && /^\/mnt\/[a-z]\//i.test(new URL('.', import.meta.url).pathname)
        ? {
            usePolling: true,
            interval: 500,
            // Images and fonts rarely change; checking them less often keeps polling cheap.
            binaryInterval: 3000,
            // Do not poll legacy Jekyll dependencies, generated sites or Astro's build scratch space.
            ignored: ['vendor', '_site', '.jekyll-cache', '.astro/.prerender'].map((dir) => fileURLToPath(new URL(dir, import.meta.url))),
          }
        : undefined,
    },
    css: {
      transformer: 'lightningcss',
      lightningcss: { targets: { chrome: v(100), edge: v(100), firefox: v(100), safari: v(15, 4), ios_saf: v(15, 4) } },
    },
    // Mermaid's chunks are large but load only on pages that contain a diagram.
    build: { cssMinify: 'lightningcss', chunkSizeWarningLimit: 2000 },
  },
});
