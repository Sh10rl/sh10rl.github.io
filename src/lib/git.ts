import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

export interface FileDates {
  /** First commit where the file existed under a published (non `_`) name. */
  created?: Date;
  /** Latest commit that changed the body, ignoring renames and front-matter-only edits. */
  updated?: Date;
}

// Diff lines that only touch Jekyll-era front matter don't count as content updates.
const FRONT_MATTER_LINE =
  /^(---\s*|\s*|(title|date|description|categories|category|tags|pin|math|mermaid|toc|comments|image|layout|author|authors|published|hidden|media_subpath|render_with_liquid|last_modified_at|lang|draft)\s*:.*)$/;

const cache = new Map<string, FileDates>();

/** Draft-ness is judged below the posts folder; the old Jekyll folder was itself called `_posts`. */
const isDraft = (target: string) =>
  target
    .replace(/^_?posts\//, '')
    .split('/')
    .some((part) => part.startsWith('_'));

export function fileDates(file: string): FileDates {
  const hit = cache.get(file);
  if (hit) return hit;

  let log = '';
  try {
    log = execFileSync(
      'git',
      // quotePath=false keeps non-ASCII paths (中文.md) unquoted in diff headers.
      ['-c', 'core.quotePath=false', 'log', '--follow', '--no-color', '--unified=0', '--format=%x1e%aI', '-p', '--', file],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {}

  const commits = log
    .split('\x1e')
    .slice(1)
    .map((record) => {
      const nl = record.indexOf('\n');
      const patch = nl < 0 ? '' : record.slice(nl + 1);
      const target = patch.match(/^diff --git a\/.*? b\/(.*)$/m)?.[1] ?? file;
      const changed = patch
        .split('\n')
        .some((line) => /^[+-](?![+-]{2}( |$))/.test(line) && !FRONT_MATTER_LINE.test(line.slice(1)));
      return { date: new Date(record.slice(0, nl < 0 ? undefined : nl).trim()), target, changed };
    })
    .reverse();

  const dates: FileDates = {};
  for (const commit of commits) {
    if (!dates.created) {
      if (!isDraft(commit.target)) dates.created = commit.date;
    } else if (commit.changed) {
      dates.updated = commit.date;
    }
  }
  if (!dates.created) {
    try {
      const stat = statSync(file);
      dates.created = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime;
    } catch {
      dates.created = new Date();
    }
  }

  cache.set(file, dates);
  return dates;
}
