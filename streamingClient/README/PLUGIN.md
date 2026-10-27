# 插件开发

## ZIP 结构

```text
my-plugin.zip
├── plugin.json
├── index.html
├── app.js
├── style.css
└── assets/*
```

`plugin.json` 至少包含：

```json
{
  "kind": "plugin",
  "apiVersion": 1,
  "id": "plugin.example",
  "version": "1.0.0",
  "minAppVersion": "0.3.1",
  "name": "示例插件",
  "description": "一句话说明插件用途",
  "publisher": "你的名字",
  "category": "stream",
  "entry": "index.html",
  "permissions": ["storage", "scene-events"]
}
```

插件描述中不要写 `files`，工作站会根据 ZIP 内文件自动补齐。插件包不包含账号、授权或远程下载字段。

## 事件与 SDK

插件通过 `window.plugin` 调用 SDK。`scene-events` 权限允许接收工作站统一分发的礼物、消息和连接状态。礼物映射在工作站设置；插件只声明自己支持的事件和参数，不读取直播平台凭据。

插件页面应支持窄屏和手机预览，避免把状态文字固定在直播画面的人脸区域。音频、视频和图片只能引用 ZIP 内已声明的资源。

## 安装与更新

在桌面端插件面板点击「打开插件区」，把 ZIP 复制进去即可。文件变化会自动触发扫描；同一 ID 的更高版本会安装并保留回退信息。删除 ZIP 不会卸载已经安装的版本，卸载请在插件面板操作。

本地验证：

```sh
npm run typecheck
npm test -- tests/plugin-manager.test.ts tests/plugin-sdk.test.ts
```
