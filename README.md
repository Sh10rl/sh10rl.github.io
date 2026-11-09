需要 Node.js 22.12+ 和 pnpm。

```sh
pnpm install
pnpm dev
```

直接编辑 `posts/` 下的 Markdown，在终端显示的地址预览。详见[写作说明](docs/writing.md)。

检查与构建预览：

```sh
pnpm check
pnpm build
pnpm preview
```

推送到 `main` 后自动部署。

手机顶部导航按文字宽度留白，使用 13px 常规字重。选中底板高 32px，点击区域仍为 44px；调整样式时需检查 320px 窄屏及文章阅读状态，避免文字与工具按钮重叠。
