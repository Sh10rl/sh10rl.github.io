# Shiori's Coffee Nook

Source for [sh10rl.top](https://sh10rl.top). Built with [Astro](https://astro.build): static HTML, about 12 KB of JavaScript (gzipped), no web fonts, every asset self-hosted.

## Writing

Add a Markdown file to `posts/`. That's it.

```md
# Title of the post

Text starts here.
```

Nothing else is required:

| | Where it comes from | Override (optional) |
| --- | --- | --- |
| Title | the leading `# heading` | `title:` in front matter |
| Date | the commit that first added the file | `2026-09-28-` file name prefix, or `date:` |
| Category | the folder, e.g. `posts/ctf/foo.md` | `categories: [ctf]` |
| Summary | the first paragraph | `description:` |
| URL | the file name: `posts/foo.md` → `/posts/foo/` | |

- **Images**: any relative path works. Typora's "copy image to `./../assets/img/${filename}`" setting keeps working, as does putting images next to the post.
- **Drafts**: prefix the file name (or a folder) with `_`, e.g. `posts/_idea.md`. Drafts show up in `pnpm dev` only.
- **File names are URLs**: two posts with the same file name would share one URL, so the build stops and names both files.
- **Extras**: math with `$…$` / `$$…$$`, callouts with `> [!NOTE]` (`TIP`, `IMPORTANT`, `WARNING`, `CAUTION`), diagrams with a `mermaid` code block, footnotes with `[^1]`.
- **Pages**: `pages/about.md` becomes `/about/`, and every page in `pages/` gets a link in the header.

## Local development

Requires Node 22.12+ and pnpm.

```bash
pnpm install
pnpm dev                      # http://localhost:4321, live reload
pnpm build && pnpm preview    # production build, served at http://localhost:4321
pnpm check                    # type-check
```

## Deploying

Push to `main`. `.github/workflows/pages-deploy.yml` builds the site and publishes it to GitHub Pages.

## Design

The whole site sits on one flat colour with a fine print grain, and code, cards and chips are lighter slips laid on it. The header, search and popovers are frosted glass floating above.

- `src/styles/tokens.css` holds the colours, the type scale, the two materials and the springs. Components name a role such as `--type-meta` or `--spring-snappy` instead of a raw value.
- Text is set in each platform's own fonts, which are drawn to pair Latin with Chinese.
- Motion runs on springs. CSS gets them as `linear()` curves, and `src/scripts/motion.ts` uses the same constants, so a motion that gets interrupted keeps its speed and turns toward the new target.
- Each post remembers how far you read, in `localStorage` only, and offers to pick up there on your next visit.
- Click a reading status in the list or choose “Mark as unread” at the end of a post to reset it.

## Layout

```
posts/          articles
pages/          standalone pages (about, friends)
assets/img/     post images
public/         files served as-is (favicons, robots.txt)
src/            site code: layouts, styles, Markdown pipeline
```
