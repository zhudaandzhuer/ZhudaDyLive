# Agent 开发入口

打开仓库后先运行：

```sh
npm ci
npm run typecheck
npm test
```

## 复制给 Agent 的提示词

在猪大直播的「插件区」点击「复制 README 提示词」，然后把下面这段完整粘贴给 Agent：

```text
你正在为“猪大直播”开发一个插件或互动小游戏。

开始前请先阅读项目根目录的 README.md、README/AGENT.md、README/PLUGIN.md 和 README/GAME.md，并遵守其中的目录、权限、事件与安全约束。

开发要求：
- 插件必须放进本机插件区，以 ZIP 形式被工作台扫描；声明唯一的 plugin.id、版本号、入口文件和最小权限。
- 玩法通过工作站提供的统一礼物、消息、点赞、关注和热键事件运行，不自行登录抖音、不读取 Cookie、不抓包、不依赖远程服务。
- 场景来源要支持横版、竖版、窄屏和手机预览；默认画面简洁，重要内容不要遮挡直播主脸部。
- 使用 SVG 或 Canvas 制作动画，事件状态由工作站驱动；完成特效必须能被下一次事件中断并正确清理。
- 先运行 npm run typecheck、npm test 和 npm run check，再把可安装 ZIP 放入插件区验证。

请先检查现有插件和 contracts 的事件接口，复用已有模式；完成后说明改动文件、事件映射、权限和验证结果。
```

工作区由四层组成：

1. `packages/contracts` 定义 IPC、场景来源、插件 manifest 和事件协议。
2. `packages/core` 负责本机 ZIP 安全校验、文件哈希和 SQLite 存储。
3. `client/src/main` 是 Electron 主进程，负责采集、全局事件分发、场景和插件生命周期。
4. `client/src/renderer` 是编辑器和观测界面；插件页面运行在受限的 `zhuda-plugin://` 协议下。

修改后使用 `npm run check`。不要提交 `.local/`、用户数据、构建产物、私钥、Cookie 或直播原始数据。界面文案使用简体中文，路径处理必须拒绝 `..`、绝对路径和符号链接逃逸。

真实直播事件进入主进程后只保存必要的观测和去重结果，再按场景层分发给所有已插入插件。插件不应自己登录抖音、抓取 Cookie 或依赖远程服务。
