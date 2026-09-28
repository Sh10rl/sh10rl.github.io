const DATE_PREFIX = /^(\d{4})-(\d{1,2})-(\d{1,2})-/;

/** `2025-2-3-hgame-week1-writeup` → `hgame-week1-writeup` (the Jekyll `:title`). */
export const slugify = (name: string) =>
  name
    .replace(DATE_PREFIX, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

/** Jekyll's default `slugify`, which Chirpy used for `/tags/<tag>/` URLs. */
export const jekyllSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');

/** A file or any folder above it starting with `_` marks a draft. */
export const isDraftPath = (file: string) => file.split(/[\\/]/).some((part) => part.startsWith('_'));

export { DATE_PREFIX };
