# 插件 SDK v1 模板

这是开发参考，不是可直接上架的 ZIP。复制现有官方来源的 HTML/CSS/构建结构，声明唯一插件 ID、新版本号、`apiVersion: 1`、`minAppVersion: "0.3.0"` 与需要的能力。使用 `@zhuda/plugin-sdk` 1.0.0；渲染器不自行维护业务数量。

```ts
import { scene } from '@zhuda/plugin-sdk';
import { sceneAudio } from '@zhuda/plugin-sdk/audio';

const stopRendering = scene.subscribe((state) => {
  render(state.game.round?.remaining ?? '0', state.settings, state.variables);
});
const stopActions = scene.onAction(
  (action) => {
    animate(action);
  },
  {
    onGap: () => rebuildFromSnapshot(scene.current()),
  },
);
const stopLifecycle = scene.lifecycle({
  onPause: () => pauseAnimations(),
  onResume: () => resumeAnimations(),
  onAudio: (enabled) => {
    if (!enabled) sceneAudio.stop();
  },
  onVisibility: (visible) => setRenderingVisible(visible),
  onResize: (viewport) => resizeCanvas(viewport),
  onDispose: () => {
    stopRendering();
    stopActions();
    cancelAnimationFrame(animationFrame);
    sceneAudio.stop();
    disposeTextures();
  },
});
```

以上 `render`、`animate` 等是插件自己的函数；示例只展示接口用法。所有计时器、动画循环、音频和观察器均须清理。新礼物恢复任务时，应撤销尚在播放的完成特效；使用宿主通用完成特效时已自动处理。

验收至少包含：首次加载不播历史、快速连送、归零后立即加量、暂停／继续、修改主题／参数、多实例、输出与手机同时打开、静音、缩放、删除及重开、更新迁移及失败回退。展示部件必须只读绑定目标，不能再次计算礼物。
