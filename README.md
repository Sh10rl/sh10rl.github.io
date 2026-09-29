需要 Node.js 22.12+ 和 pnpm。

```sh
pnpm install
pnpm dev
```

打开终端显示的地址，在 `/write/` 编辑文章，或直接修改 `posts/` 下的 Markdown。详见[写作说明](docs/writing.md)。

检查与构建预览：

```sh
pnpm check
pnpm build
pnpm preview
```

推送到 `main` 后自动部署。
