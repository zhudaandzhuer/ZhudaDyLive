# 开发说明

```sh
npm ci
npm run setup
npm run dev
```

打开应用后直接进入场景工作台，不需要网络服务。修改 React 页面支持热更新；修改主进程、共享内核或插件资源后重新运行 `npm run dev`。

常用命令：

| 命令                     | 用途                           |
| ------------------------ | ------------------------------ |
| `npm run dev`            | 启动 Electron 工作台与开发页面 |
| `npm run build`          | 构建桌面资源和内置插件         |
| `npm run package`        | 打包当前平台                   |
| `npm run check`          | 格式、类型、简体中文和单元测试 |
| `npm run audio:generate` | 生成互动音效                   |

把插件 ZIP 放进应用的本机插件区即可测试更新，不需要运行服务端。开发环境和生产环境都不能提交 `.local/`、用户 Cookie、直播原始数据或私钥。

更多开发入口见 [README/AGENT.md](../README/AGENT.md)。
