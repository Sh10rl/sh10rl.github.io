import type { ShikiTransformer } from '@shikijs/types';

export const shikiFold = (): ShikiTransformer => ({
  name: 'fold-code-preview',
  code(node) {
    if (this.lines.length <= 36) return;
    const start = node.children.indexOf(this.lines[18]);
    if (start < 0) return;
    // Preserve all code text while excluding the folded tail from layout.
    node.children.push({ type: 'element', tagName: 'span', properties: { className: ['code-tail'] }, children: node.children.splice(start) });
  },
});
