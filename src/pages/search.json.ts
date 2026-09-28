import type { APIRoute } from 'astro';
import { categoryLabel, formatDate, getPosts } from '../lib/posts';

export const GET: APIRoute = async () => {
  const posts = await getPosts();
  const index = posts.map((post) => ({
    u: post.url,
    t: post.title,
    d: post.date.toISOString().slice(0, 10),
    f: formatDate(post.date),
    c: post.category ? categoryLabel(post.category) : '',
    s: post.meta.sections ?? [],
  }));
  return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
