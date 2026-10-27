# 测试与验收

```sh
npm ci
npm run check
npm run build
```

`npm run check` 包含格式、公开源码检查、TypeScript、简体文案和 Vitest。测试覆盖协议解码、礼物去重、插件 ZIP 扫描与更新、SDK 生命周期、场景存档、图片／视频边界、热键、音频和玩法状态。

Electron 回归按需执行：

- `npm test`：共享内核、场景、图片／视频、缩放、输出、保存、事件与手机预览。
- `npm run smoke`：内置游戏包和锁链表现。

正式发行前在 macOS 和 Windows 打开完整目录，测试横竖版、图层移动缩放、透明／绿幕输出、捕捉、热键、长时间运行和同网手机预览。真实礼物测试应使用自己的直播间，避免提交 Cookie、昵称、房间标识或本机路径。
