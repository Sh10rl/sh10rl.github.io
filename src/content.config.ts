import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { isDraftPath, slugify } from './lib/slug';

// Every field is optional: a post can be nothing but Markdown.
// Title falls back to the leading `# heading`, date to git history, category to the folder name.
// Empty keys (`date:`) parse as null, so everything accepts null too.
const text = z.union([z.string(), z.number()]).transform(String).nullish();
const list = z.union([z.array(z.union([z.string(), z.number()]).transform(String)), text]).nullish();

// Maps each URL slug to the file that owns it, so two posts can never silently share one.
const owners = new Map<string, string>();

function postId(entry: string): string {
  const name = path.basename(entry, path.extname(entry));
  // Drafts keep a leading underscore, so `_foo.md` and `foo.md` never compete for `/posts/foo/`.
  const id = (isDraftPath(entry) ? '_' : '') + (slugify(name) || encodeURIComponent(name));
  const owner = owners.get(id);
  if (owner && owner !== entry && existsSync(path.join('posts', owner))) {
    throw new Error(`posts/${owner} and posts/${entry} would both be published at /posts/${id}/. Rename one of them.`);
  }
  owners.set(id, entry);
  return id;
}

const posts = defineCollection({
  loader: glob({ base: './posts', pattern: '**/*.md', generateId: ({ entry }) => postId(entry) }),
  schema: z.object({
    title: text,
    date: z.union([z.date(), text]).nullish(),
    description: text,
    categories: list,
    category: text,
    tags: list,
    draft: z.boolean().nullish(),
  }),
});

const pages = defineCollection({
  loader: glob({ base: './pages', pattern: '*.md' }),
  schema: z.object({
    title: text,
    order: z.number().nullish(),
  }),
});

export const collections = { posts, pages };
