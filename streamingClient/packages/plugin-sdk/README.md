# @zhuda/plugin-sdk

工作台插件 SDK **1.0.0**，对应 manifest `apiVersion: 1`。当前以 monorepo workspace 源码使用，尚未发布独立 npm 包。

## 使用

插件的浏览器入口经 esbuild 等工具打包后，与 HTML、CSS、素材和 `plugin.json` 一起放入 ZIP 根目录。SDK 只在工作台插件 iframe 内使用，不是 Node.js 服务端 SDK。

```ts
import { scene, studioPlugin } from '@zhuda/plugin-sdk';
import { sceneAudio } from '@zhuda/plugin-sdk/audio';

const stop = scene.subscribe((state) => {
  document.querySelector('#count')!.textContent = state.game.round?.remaining ?? '0';
});

scene.onEvent((event) => console.log(event.kind), {
  onGap: () => console.log('从当前快照恢复', scene.current()),
});

scene.lifecycle({
  onAudio: (enabled) => {
    if (!enabled) sceneAudio.stop();
  },
  onDispose: () => {
    stop();
    sceneAudio.stop();
  },
});

const info = await studioPlugin.info();
console.log(info.apiVersion, info.capabilities);
```

计数来自宿主快照，不在渲染器再次累加礼物。示例中的日志仅用于开发。

## 接口

| 接口                              | 作用                                                 |
| --------------------------------- | ---------------------------------------------------- |
| `scene.current()` / `subscribe()` | 获取并订阅只读 `SceneFrameState`                     |
| `scene.onEvent()` / `onAction()`  | 订阅新增事件或动作，提供 `onGap` 缺口通知            |
| `scene.lifecycle()`               | 开始、暂停、继续、停止、可见性、声音、尺寸与销毁回调 |
| `studioPlugin.info()`             | 宿主版本、平台和能力版本                             |
| `studioPlugin.storage`            | 按插件隔离的 JSON 数据，要求 `storage` 权限          |
| `studioPlugin.folders`            | 用户选择目录、列出与打开，要求 `folders` 权限        |
| `studioPlugin.openWebsite()`      | 系统浏览器打开 HTTPS，要求 `external-links` 权限     |
| `sceneAudio.play()` / `stop()`    | 手机端 `audio.transport === 'host'` 时的声音中继     |

`onEvent` 和 `onAction` 首次连接不补播历史；状态队列不是无限日志。订阅返回注销函数。销毁时清理动画帧、定时器、观察器和音频。SDK 会隔离订阅回调异常并上报宿主。

资源路径相对插件入口，声音中继不接受外链或目录跳转。先检查快照的声音开关；桌面本地音频播放与手机宿主中继的完整实现可参考内附玩法。

SDK 不提供任意文件路径、Node.js、账号 Cookie、私钥或随意修改游戏状态的能力。manifest 权限、所需能力、数据迁移和来源配置见 [插件规格](../../docs/PLUGINS.md)、[场景协议](../../docs/SCENES.md) 和 [模板](../../../plugins/template/README.md)。
