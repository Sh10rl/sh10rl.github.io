新建 `posts/2026-11-09-my-article.md`：

```md
# 文章标题

正文。
```

不用填写 YAML。标题用 `#`，日期默认取文件名。

- 分类：放进 `posts/learn/` 等分类目录。
- 草稿：文件或目录名以 `_` 开头，只在本地预览中显示。

需要标签时，在文章开头添加：

```yaml
---
tags: [Linux]
---
```

需要指定日期时，在同一区域添加 `date: 2026-11-09`。

公式用 `$...$` 或 `$$...$$`；图表用 `mermaid` 代码块。不需要填写 `math`、`mermaid` 字段。

代码块的语言别名在 `astro.config.ts` 的 `markdown.shikiConfig.langAlias` 中配置（不是 `longAlias`）。例如 `pwndbg: 'bash'` 使用 Bash 高亮，语言标签保留 `pwndbg`。修改配置后重启本地预览；支持悬停的设备上，未悬停时显示标签，悬停后显示复制按钮。

行内代码续行左侧的箭头表示自动折行；复制时不会带入箭头或额外换行。

词语需要悬停注释（如中文译名）时，在它第一次出现处写成 `<span data-tooltip="加载器" tabindex="0">loader</span>`，文中之后的同一词语会自动带上相同的注释（代码和链接里的除外）。这些词语带虚线下划线，鼠标悬停时注释立即显示在上方，颜色与页面相反；`tabindex="0"` 让键盘和触屏也能显示注释。

中文和西文字体都只包含网站已经用到的字。发布新文章前运行一次：

```sh
pnpm build && uv run scripts/generate-fonts.py && pnpm build
```

如果有页面用到了字体子集里没有的字，`pnpm build` 结尾会给出提醒并列出这些字。
