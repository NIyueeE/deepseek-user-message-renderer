# DeepSeek 用户消息 Markdown 渲染器

[![CI](https://github.com/NIyueeE/deepseek-user-message-renderer/actions/workflows/ci.yml/badge.svg)](https://github.com/NIyueeE/deepseek-user-message-renderer/actions/workflows/ci.yml)

一个用户脚本,让 [DeepSeek 网页版](https://chat.deepseek.com) 中**你自己发送的消息**
以与助手回复一致的原生样式渲染 Markdown、LaTeX 公式和代码块——同时不影响编辑、
重新渲染和历史消息高亮。

> 已针对当前 DeepSeek 网页构建版本测试。脚本依赖一些哈希类名(如 `_9663006`),
> DeepSeek 偶尔会改动它们;其大型 UI 更新后可能需要小幅更新脚本中的类名。

## 功能特性

- **原生风格 Markdown**:标题、段落、列表、行内代码、链接、引用块,渲染效果与
  DeepSeek 自己的 Markdown 一致;单个换行按软换行(GFM 风格)渲染为换行,
  多行输入保持原有的换行。
- **LaTeX 公式**(KaTeX):`$...$`、`$$...$$`、`\(...\)`、`\[...\]`。
- **代码块重建为 DeepSeek 官方 `md-code-block` 结构**:带语言标签的横幅、
  原生浅色/深色主题、角标装饰,以及页面自带样式表中的 Prism 风格 token 配色。
- **代码块内硬换行完整保留**;未知语言(如 `mermaid`)保持为干净的代码块,
  不会在控制台产生警告。
- **安全的编辑流程**:点击"编辑"会在 DeepSeek 读取内容前恢复原始消息,编辑器
  不会崩溃;取消编辑后重新渲染;空的编辑占位节点会被清理。
- **原地渲染**:直接选中原始消息文本元素(哈希类名 `fbb737a4`;`_8271fc3`
  仅标记带附件的消息)原地变换为 DeepSeek 原生 `ds-markdown` 结构(段落带
  `ds-markdown-paragraph`),不新建气泡、不隐藏任何节点——附件卡片和原生
  气泡布局自然保持完整。
- **原生历史高亮**:原始气泡从未被替换,历史面板的高亮效果原生生效,
  无需任何镜像逻辑。
- **绝不删除或隐藏 DeepSeek 的原始节点**——文本元素原地渲染,宿主应用
  (React)持有的引用始终有效,重新渲染永远不会抛出 `NotFoundError`。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开下面的脚本原始链接,Tampermonkey 会提示安装:

   <https://raw.githubusercontent.com/NIyueeE/deepseek-user-message-renderer/master/src/deepseek-user-message-renderer.user.js>

   或者手动把 [`src/deepseek-user-message-renderer.user.js`](src/deepseek-user-message-renderer.user.js)
   的内容粘贴到新的 Tampermonkey 脚本中。
3. 打开 <https://chat.deepseek.com>。脚本通过 `@require` 从 CDN 加载
   marked / highlight.js / KaTeX。

> 在 Tampermonkey 中启用 `@updateURL` / `@downloadURL` 后,脚本会从 GitHub
> 自动更新。

## 开发

```bash
bun install       # 安装依赖
bun test          # 在模拟的 Tampermonkey + 浏览器环境中运行测试
bun run lint      # Biome 静态检查
bun run lint:fix  # 自动修复格式和 lint 问题
```

## 测试结构

- [`test/env.ts`](test/env.ts):用 happy-dom 模拟浏览器 DOM / MutationObserver /
  事件,stub 掉 Tampermonkey API `GM_addStyle` 和 `GM_getResourceText`,并暴露
  与生产脚本相同的 `marked` 版本。每个测试文件在独立进程中运行。
- [`test/render.test.ts`](test/render.test.ts):Markdown、原生 `md-code-block`
  结构、硬换行、样式类、资源注入、暗色模式,以及保留原始节点。
- [`test/security.test.ts`](test/security.test.ts):危险 HTML 会被转义——被禁止的
  标签(`iframe` / `base` / `meta` / `form` / `style` 等)、事件处理器、危险 URL
  协议(包括字符引用绕过)、不安全的 Markdown 链接/图片;安全标签和无害属性值保留。
- [`test/edit-restore.test.ts`](test/edit-restore.test.ts):编辑点击时恢复消息框、
  提交后重新渲染、编辑状态下跳过渲染。
- [`test/marked-quirk.test.ts`](test/marked-quirk.test.ts):marked 18 的回归
  防护(段落内容为 `---` 时,紧随其后的代码围栏正常解析为代码块;marked 12
  及以下版本会误判为 setext 标题)。

## CI / 发布

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml):每次 push 和 pull request
  运行 lint + 测试。
- [`.github/workflows/release.yml`](.github/workflows/release.yml):为每个 `v*`
  tag 构建脚本并创建 GitHub Release;配置 `GFU` / `GFP` /
  `GREASYFORK_TOTP_SECRET` secrets 后还会自动发布到 GreasyFork(GreasyFork
  没有官方 API,工作流用这些凭据登录后从 raw GitHub 地址导入脚本)。
- **OpenUserJS** 没有面向普通用户的发布 API(其 `/api` 端点仅限管理员),因此
  只能手动发布:在 <https://openuserjs.org/user/add/scripts> 上传脚本,或使用
  GitHub 登录后从本仓库导入。脚本元数据已包含 OpenUserJS 必需的
  `@license MIT`。

## 许可证

基于 [MIT 许可证](LICENSE) 发布。
