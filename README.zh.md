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
  多行输入保持原有的换行。空行仍会正确结束引用块、列表项和表格,不会再让下一行
  被当作 Markdown 的懒继续而吞进上一个块(因此 `> test` + 空行 + `你好`
  不再把两行都渲染成引用)。
- **助手消息 raw / 渲染切换**:每条助手回复的操作栏里(复制按钮旁)会注入一个
  原生风格按钮,可在渲染后的 Markdown(默认)与助手实际产出的原始 Markdown
  之间切换;原文从 React 内部数据中读取(取回复正文的 `markdown`,绝不会取到
  思维链的 `content`)。它只是视图切换:从不修改消息自身的 DOM,切换完全无损,
  并且在宿主重新渲染后仍保持一致。该按钮直接克隆相邻的原生操作按钮,因此自带
  宿主的 hover/active/focus 样式;图标尺寸、线宽与配色同样取自原生图标,视觉重心
  与相邻按钮完全对齐;提示气泡也用页面自己的 tooltip 变量绘制,而非浏览器默认的
  title 小方框。raw 原文则使用 DeepSeek 自己的设计变量与 markdown 容器类渲染,
  字体、配色与原生气质一致,并自动跟随明暗主题。
- **LaTeX 公式**(KaTeX):`$...$`、`$$...$$`、`\(...\)`、`\[...\]`。
- **代码块重建为 DeepSeek 官方 `md-code-block` 结构**:带语言标签的横幅、
  原生浅色/深色主题、角标装饰,以及页面自带样式表中的 Prism 风格 token 配色。
- **代码块内硬换行完整保留**;未知语言(如 `mermaid`)保持为干净的代码块,
  不会在控制台产生警告。
- **安全的编辑流程**:点击"编辑"会在 DeepSeek 读取内容前恢复原始消息,编辑器
  不会崩溃;取消编辑后重新渲染;空的编辑占位节点会被清理。
- **原地渲染**:直接选中原始消息文本元素(哈希类名 `fbb737a4`;`_8271fc3`
  仅标记带附件的消息)原地变换为 DeepSeek 原生 `ds-markdown` 结构(段落带
  `ds-markdown-paragraph`),不新建气泡——附件卡片和原生气泡布局自然保持完整。
  被 DeepSeek 折叠容器(`ds-collapsible-text`)包裹的长消息会渲染到容器内的
  **兄弟容器**中:宿主应用自己的子节点始终保留在 DOM 里(通过注入的样式规则
  隐藏,且保持可测量),它的收起/展开提交永远不会崩溃——切换按钮保持可用,
  展开后的高度也会自动修正以完整显示渲染后的 Markdown。
- **原生历史高亮**:原始气泡从未被替换,历史面板的高亮效果原生生效,
  无需任何镜像逻辑。
- **绝不删除 DeepSeek 的原始节点**——扁平消息原地渲染;折叠消息将宿主自身
  的子节点完整保留在 DOM 中(仅视觉隐藏,且保持可测量),宿主应用(React)
  持有的引用始终有效,它的提交永远不会抛出 `NotFoundError`。

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
- [`test/collapsible.test.ts`](test/collapsible.test.ts):被折叠容器包裹的长消息
  渲染到兄弟容器中,宿主自身的子节点始终存活;覆盖切换后的重查、编辑还原、
  取消重渲染、主题重建,以及展开时的过期高度修正。
- [`test/assistant-raw.test.ts`](test/assistant-raw.test.ts):助手消息的
  raw / 渲染切换——按钮注入到复制按钮所在行、默认渲染状态、无损切换、
  多次扫描下的幂等、宿主重新渲染后自动补回、各消息互不影响,以及用户消息不被触碰。
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
