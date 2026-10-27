# Electron 窗口验收

此目录保存需要真实 Electron 窗口的验收实现，由 `scripts/` 的启动器创建临时服务和隔离客户端数据，再通过开发构建入口加载。它们不属于生产应用模块，也不会由 Vitest 当作单元测试执行。

先运行 `npm run build`，再根据改动选择：

| 命令                      | 覆盖                                                 |
| ------------------------- | ---------------------------------------------------- |
| `npm run smoke:collector` | 直播间号码／网址、登录、停止连接与忙碌期间热键响应   |
| `npm run smoke:scene`     | 编辑器、媒体、保存和完整重启，以及主要来源与展示行为 |
| `npm run smoke:platform`  | 媒体、场景包、权限、更新、错误恢复与平台行为         |
| `npm run smoke`           | 旧游戏资源包兼容路径                                 |

可设置 `LIVE_SMOKE_ARTIFACTS` 为自己的截图输出目录。场景启动器支持 `LIVE_SCENE_SMOKE_MODES_ONLY`、`LIVE_SCENE_SMOKE_DRAGON_ONLY`、`LIVE_SCENE_SMOKE_MOBILE_ONLY`、`LIVE_SCENE_SMOKE_RESOLUTION_ONLY`、`LIVE_SCENE_SMOKE_HOTKEYS_ONLY`，值为 `1` 时只运行对应专项。Windows PowerShell 可先用 `$env:变量名 = '1'` 设置变量。

启动器的 `-- --app <可执行文件>` 用于相同版本的开发封装包；生产构建主动移除 smoke 入口，不能用这些测试入口控制正式客户端。生产包仍需在原生平台按 [验收说明](../../docs/ACCEPTANCE.md) 手动验证。

测试可能打开并关闭多个窗口，不应同时运行多个 smoke 或在过程中操作窗口。不得使用生产用户目录或真实采集会话作为夹具。自动检查不能代替真实 Windows 捕捉、系统热键、手机扫码与声音试听。
