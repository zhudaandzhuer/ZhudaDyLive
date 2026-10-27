# 插件系统

所有特殊需求都通过插件扩展，工作台本身不区分个人版、公会版、试玩版或正式版。插件加入场景后立即待命，直播礼物和全局热键由工作站统一分发。

## 本机安装

在插件面板点击「打开插件区」，把根目录包含 `plugin.json` 与 `index.html` 的 ZIP 放入目录。工作台会在启动和文件变化时扫描并校验：ZIP 不超过 30 MiB，解压内容不超过 100 MiB，路径不能穿越，全部文件会计算 SHA-256。

同一 `plugin.id` 只运行最高版本。更新会写入新的版本目录，并保留旧版本和插件数据以便回退。删除 ZIP 不会卸载已安装版本；卸载和禁用在插件面板完成。安装只读取本机插件区，不需要官网或网络。

## manifest

```json
{
  "kind": "plugin",
  "apiVersion": 1,
  "id": "plugin.example",
  "version": "1.0.0",
  "minAppVersion": "0.3.1",
  "name": "示例插件",
  "description": "插件用途",
  "publisher": "开发者名称",
  "category": "stream",
  "entry": "index.html",
  "permissions": ["storage", "scene-events"]
}
```

`files` 由工作站从 ZIP 自动生成。插件包不应声明账号或远程下载字段。

## 宿主边界

插件在隔离 iframe 中运行。`storage` 保存插件自己的 JSON；`folders` 只能访问用户亲自选择的目录；`scene-events` 接收工作站分发的事件；`external-links` 只能打开 HTTPS。插件不能读取 Cookie、直播原始封包、绝对路径或其他插件数据。

游戏参数、礼物映射、主题和显示部件都由插件 manifest 声明，再由场景编辑器提供配置。测试热键和真实礼物走同一事件入口。

详细的 ZIP 示例与 Agent 开发步骤见 [README/PLUGIN.md](../README/PLUGIN.md)。
