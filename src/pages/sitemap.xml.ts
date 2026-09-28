import type { APIRoute } from 'astro';
import { getCategories, getPages, getPosts, getTags } from '../lib/posts';

// Served at the same URL the old Jekyll site used, so search engines keep finding it.
export const GET: APIRoute = async ({ site }) => {
  const posts = await getPosts();
  const url = (path: string) => new URL(path, site).href;
  const day = (date?: Date) => (date ? `<lastmod>${date.toISOString().slice(0, 10)}</lastmod>` : '');

  const entries = [
    { loc: url('/'), lastmod: posts[0]?.updated ?? posts[0]?.date },
    ...posts.map((post) => ({ loc: url(post.url), lastmod: post.updated ?? post.date })),
    ...(await getPages()).map((page) => ({ loc: url(page.url), lastmod: undefined })),
    ...(await getCategories()).map((c) => ({ loc: url(`/categories/${c.key}/`), lastmod: undefined })),
    { loc: url('/tags/'), lastmod: undefined },
    ...(await getTags()).map((t) => ({ loc: url(`/tags/${t.slug}/`), lastmod: undefined })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <url><loc>${e.loc}</loc>${day(e.lastmod)}</url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
