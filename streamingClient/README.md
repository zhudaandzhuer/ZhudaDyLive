# 猪大直播工作台

猪大直播是一个本机优先的 TypeScript 直播场景工作站。打开应用即可搭建场景、连接抖音直播数据、预览输出，并让场景中的插件响应全局礼物和热键事件。

[开发入口](README/AGENT.md) · [插件开发](README/PLUGIN.md) · [游戏开发](README/GAME.md) · [架构](README/ARCHITECTURE.md) · [贡献指南](CONTRIBUTING.md) · [MIT](LICENSE)

## 直接运行

需要 Node.js 24+、npm 和 Git。桌面运行需要 macOS 或 Windows；Linux 可用于构建和测试。

```sh
npm ci
npm run setup
npm run dev
```

应用直接进入工作台，不需要账号服务或插件网络。场景、插件设置、直播会话和素材都保存在本机用户数据目录。

## 本机插件区

把插件 ZIP 放进应用显示的「插件区」即可。工作台启动时和文件变化时会自动扫描：

- 从 ZIP 的 `plugin.json` 读取插件描述并校验文件路径、大小和 SHA-256。
- 同一个 `plugin.id` 只启用最高的语义化版本；新版本自动安装，旧版本保留以便场景回退。
- 插件不需要官网签章或联网下载。ZIP 可以由任何开发者在本机制作。
- 插件拥有独立数据、权限声明和场景来源；收到的礼物事件由工作站统一分发。

## 开发检查

```sh
npm run check       # 格式、公开源码检查、类型、简体中文和测试
npm run build       # 构建桌面资源和内置插件
npm run package     # 打包当前平台
```

桌面客户端不依赖官网或远程服务启动、更新插件或处理直播事件。

## 目录

| 目录                   | 用途                                       |
| ---------------------- | ------------------------------------------ |
| `client/`              | Electron 主进程、预加载桥接和 React 工作台 |
| `packages/contracts/`  | 场景、插件、事件和共享类型                 |
| `packages/core/`       | ZIP 校验、SQLite 本机存储和安全路径处理    |
| `packages/plugin-sdk/` | 插件调用工作站能力的 SDK                   |
| `../plugins/`          | 内置插件和插件开发样例                     |
| `games/`               | 兼容的互动游戏资源和渲染器                 |
| `README/`              | 给 Agent 和开发者的最短开发说明            |
| `docs/`                | 详细架构、素材、部署和验收文档             |
| `tests/`               | 单元、集成和 Electron 验收测试             |

## 许可

原创代码按 [MIT](LICENSE) 发布。第三方依赖和素材许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [素材说明](docs/ASSETS.md)。
