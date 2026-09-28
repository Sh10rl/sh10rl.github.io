import path from 'node:path';
import { type CollectionEntry, getCollection } from 'astro:content';
import { site } from '../site.config';
import { fileDates } from './git';
import type { DerivedMeta } from './markdown/remark';
import { DATE_PREFIX, isDraftPath, jekyllSlug, slugify } from './slug';

export type PostEntry = CollectionEntry<'posts'>;
export type PageEntry = CollectionEntry<'pages'>;

export interface Post {
  id: string;
  url: string;
  title: string;
  description: string;
  date: Date;
  updated?: Date;
  category?: string;
  minutes: number;
  lang: string;
  draft: boolean;
  entry: PostEntry;
  meta: DerivedMeta;
}



/** Calendar dates in front matter / file names are treated as dates, not instants. */
function calendarDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const m = typeof value === 'string' ? value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) : null;
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : undefined;
}

export const categoryLabel = (key: string) => site.categories[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

/** Metadata computed by the Markdown pipeline (see `remarkMeta`). */
export const derivedOf = (entry: PostEntry | PageEntry) =>
  (entry.rendered?.metadata?.frontmatter as { derived?: DerivedMeta } | undefined)?.derived;

function toPost(entry: PostEntry): Post {
  const meta: DerivedMeta = derivedOf(entry) ?? { minutes: 1, lang: 'en', mermaid: false };
  const file = entry.filePath ?? '';
  const base = path.basename(file, path.extname(file));
  const git = fileDates(file);
  const data = entry.data;

  const date = calendarDate(data.date) ?? calendarDate(base) ?? git.created ?? new Date();
  const updated = git.updated && git.updated.getTime() - date.getTime() > 36 * 3600 * 1000 ? git.updated : undefined;

  const folder = path.dirname(path.relative('posts', file));
  const folderCategory = folder.split(/[\\/]/).find((part) => part !== '.' && !part.startsWith('_'));
  const rawCategory = [data.categories].flat()[0] ?? data.category ?? folderCategory;
  const category = rawCategory ? slugify(String(rawCategory)) || undefined : undefined;

  const title = data.title?.trim() || meta.title || base.replace(DATE_PREFIX, '').replace(/[-_]+/g, ' ').trim();

  return {
    id: entry.id,
    url: `/posts/${entry.id}/`,
    title,
    description: data.description?.trim() || meta.excerpt || '',
    date,
    updated,
    category,
    minutes: meta.minutes,
    lang: meta.lang,
    draft: Boolean(data.draft) || isDraftPath(path.relative('posts', file)),
    entry,
    meta,
  };
}

let cached: Post[] | undefined;

export async function getPosts(): Promise<Post[]> {
  if (cached && import.meta.env.PROD) return cached;
  const entries = await getCollection('posts');
  cached = entries
    .map(toPost)
    .filter((post) => import.meta.env.DEV || !post.draft)
    .sort((a, b) => b.date.getTime() - a.date.getTime() || a.title.localeCompare(b.title));
  return cached;
}

export interface Tag {
  slug: string;
  label: string;
}

/** Tags are optional front matter; their URLs keep Chirpy's /tags/<slug>/ shape. */
export function tagsOf(post: Post): Tag[] {
  const seen = new Set<string>();
  const tags: Tag[] = [];
  for (const raw of [post.entry.data.tags ?? []].flat()) {
    const label = String(raw ?? '').trim();
    const slug = jekyllSlug(label);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    tags.push({ slug, label });
  }
  return tags;
}

export async function getTags(): Promise<(Tag & { posts: Post[] })[]> {
  const map = new Map<string, Tag & { posts: Post[] }>();
  for (const post of await getPosts()) {
    for (const tag of tagsOf(post)) {
      const entry = map.get(tag.slug) ?? { ...tag, posts: [] };
      entry.posts.push(post);
      map.set(tag.slug, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.posts.length - a.posts.length || a.label.localeCompare(b.label));
}

/** Posts that share the most tags (then the category), newest first; `exclude` keeps pager entries out. */
export function relatedTo(post: Post, all: Post[], exclude: Post[] = [], limit = 3): Post[] {
  const mine = new Set(tagsOf(post).map((t) => t.slug));
  const skip = new Set([post.id, ...exclude.map((p) => p.id)]);
  return all
    .filter((p) => !skip.has(p.id))
    .map((p) => {
      const shared = tagsOf(p).filter((t) => mine.has(t.slug)).length;
      const score = shared * 2 + (p.category && p.category === post.category ? 1 : 0);
      return { p, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.p.date.getTime() - a.p.date.getTime())
    .slice(0, limit)
    .map(({ p }) => p);
}

export async function getCategories(): Promise<{ key: string; label: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const post of await getPosts()) if (post.category) counts.set(post.category, (counts.get(post.category) ?? 0) + 1);
  return [...counts]
    .map(([key, count]) => ({ key, label: categoryLabel(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function getPages() {
  const pages = await getCollection('pages');
  return pages
    .map((entry) => ({
      entry,
      id: entry.id,
      url: `/${entry.id}/`,
      title: entry.data.title?.trim() || derivedOf(entry)?.title || categoryLabel(entry.id),
      order: entry.data.order ?? 99,
    }))
    .sort((a, b) => a.order - b.order);
}

const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: site.timezone, year: 'numeric', month: 'short', day: 'numeric' });
const shortFormat = new Intl.DateTimeFormat('en-US', { timeZone: site.timezone, month: 'short', day: 'numeric' });
const yearFormat = new Intl.DateTimeFormat('en-US', { timeZone: site.timezone, year: 'numeric' });

export const formatDate = (date: Date) => dateFormat.format(date);
export const formatShortDate = (date: Date) => shortFormat.format(date);
export const yearOf = (date: Date) => yearFormat.format(date);
export const isoDate = (date: Date) => date.toISOString();
