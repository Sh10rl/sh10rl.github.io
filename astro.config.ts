import { rehypeHeadingIds, unified } from '@astrojs/markdown-remark';
import { defineConfig } from 'astro/config';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { rehypeArticle, rehypeLegacyHtml, rehypeSections } from './src/lib/markdown/rehype';
import { remarkCallouts, remarkLegacy, remarkMeta } from './src/lib/markdown/remark';
import { shikiContrast } from './src/lib/markdown/shiki-contrast';
import { site } from './src/site.config';

// Lightning CSS encodes browser versions as (major << 16) | (minor << 8).
const v = (major: number, minor = 0) => (major << 16) | (minor << 8);

export default defineConfig({
  site: site.url,
  compressHTML: true,
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
      remarkPlugins: [remarkMath, remarkLegacy, remarkCallouts, remarkMeta],
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
      transformers: [shikiContrast()],
    },
  },
  vite: {
    css: {
      transformer: 'lightningcss',
      lightningcss: { targets: { chrome: v(100), edge: v(100), firefox: v(100), safari: v(15, 4), ios_saf: v(15, 4) } },
    },
    // Mermaid's chunks are large but load only on pages that contain a diagram.
    build: { cssMinify: 'lightningcss', chunkSizeWarningLimit: 2000 },
  },
});
