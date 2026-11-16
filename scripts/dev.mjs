// `pnpm dev`: `astro dev` plus the blog's own flags, which `--help` lists after Astro's.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const astro = fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url));

// Laid out like Astro's own table: flags right-aligned, descriptions from column 28.
const HELP = `   Blog flags
   -c, --clean-img <post>  Delete the post's unreferenced images once, at startup.
                           Any part of its path works (case-insensitive), e.g. -c shengsai. Repeatable.
`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Case-insensitive substring of a post's path; a whole path or file name beats a longer match. */
function resolvePost(request, files) {
  const needle = request.replaceAll('\\', '/').replace(/\.md$/i, '').toLowerCase();
  const names = files.map((file) => file.replace(/\.md$/i, '').toLowerCase());
  const exact = files.filter((_, i) => names[i] === needle || path.posix.basename(names[i]) === needle);
  const matches = exact.length ? exact : files.filter((_, i) => names[i].includes(needle));
  if (matches.length === 1) return path.join(root, matches[0]);
  if (matches.length) fail(`--clean-img ${request} 匹配到 ${matches.length} 篇文章，请写得更具体：\n${matches.map((file) => `  ${file}`).join('\n')}`);
  fail(`--clean-img 找不到文章：${request}（只查找 posts/、pages/ 下的 .md 文件）。`);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  spawnSync(process.execPath, [astro, 'dev', '--help'], { stdio: 'inherit' });
  console.log(HELP);
  process.exit(0);
}

const rest = [];
const requests = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const inline = arg.startsWith('--clean-img=') ? arg.slice('--clean-img='.length) : undefined;
  if (arg !== '-c' && arg !== '--clean-img' && inline === undefined) {
    rest.push(arg);
    continue;
  }
  const value = inline ?? args[++i];
  if (!value || value.startsWith('-')) fail(`${arg} 需要指定文章，例如：pnpm dev -c shengsai`);
  requests.push(value);
}

if (requests.length) {
  const files = ['posts', 'pages'].flatMap((dir) => {
    try {
      return readdirSync(path.join(root, dir), { recursive: true })
        .filter((file) => file.endsWith('.md'))
        .map((file) => `${dir}/${file.split(path.sep).join('/')}`);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  });
  // Read once by the unused-images integration (scripts/unused-images.ts) when the server starts.
  process.env.CLEAN_IMG = JSON.stringify(requests.map((request) => resolvePost(request, files)));
}

// Astro's own CLI, in this process, so its signals, lock file and restarts behave as usual.
process.argv = [process.argv[0], astro, 'dev', ...rest];
await import(pathToFileURL(astro).href);
