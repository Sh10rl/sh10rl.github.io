import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { render } from 'astro:content';
import type { Element, Root } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import { SKIP, visit } from 'unist-util-visit';
import { categoryLabel, getPosts } from '../lib/posts';
import { site } from '../site.config';

const DROP_PROPS = /^(srcSet|sizes|loading|decoding|fetchPriority|tabIndex|style|data[A-Z].*)$/;

const classes = (node: Element) => (Array.isArray(node.properties.className) ? node.properties.className.map(String) : []);

/** Feed readers get the full article without interactive chrome, with absolute URLs. */
function forFeed(html: string, base: string): string {
  const tree: Root = fromHtml(html, { fragment: true });
  visit(tree, 'element', (node, index, parent) => {
    if (!parent || index === undefined) return;
    if (node.tagName === 'button' || (node.tagName === 'a' && classes(node).includes('anchor'))) {
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
    if (node.tagName === 'pre') {
      // Plain code: token colours come from site CSS that readers don't have.
      const text = (function collect(n: any): string {
        return n.type === 'text' ? n.value : (n.children ?? []).map(collect).join('');
      })(node);
      node.properties = {};
      node.children = [{ type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: text }] }];
      return SKIP;
    }
    for (const key of Object.keys(node.properties)) if (DROP_PROPS.test(key)) delete node.properties[key];
    for (const key of ['src', 'href'] as const) {
      const value = node.properties[key];
      if (typeof value === 'string' && !value.startsWith('#')) node.properties[key] = new URL(value, base).href;
    }
  });
  return toHtml(tree);
}

export const GET: APIRoute = async (context) => {
  const origin = (context.site ?? new URL(site.url)).origin;
  const container = await AstroContainer.create();
  const posts = await getPosts();

  const items = await Promise.all(
    posts.map(async (post) => {
      const { Content } = await render(post.entry);
      const html = await container.renderToString(Content);
      return {
        title: post.title,
        link: post.url,
        pubDate: post.date,
        description: post.description || undefined,
        content: forFeed(html, new URL(post.url, origin).href),
        categories: post.category ? [categoryLabel(post.category)] : undefined,
      };
    }),
  );

  return rss({
    title: site.title,
    description: site.description,
    site: origin,
    items,
    trailingSlash: true,
    customData: `<language>${site.lang}</language>`,
  });
};
