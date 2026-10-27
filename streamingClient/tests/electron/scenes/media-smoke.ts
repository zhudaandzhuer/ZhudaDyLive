import assert from 'node:assert/strict';
import type { BrowserWindow, WebFrameMain } from 'electron';
import type { SceneCommand, SceneSnapshot } from '@zhuda/contracts';

interface VideoSample {
  token: string;
  messages: number;
  emptied: number;
  seeks: number;
  plays: number;
  pauses: number;
  time: number;
  duration: number;
  paused: boolean;
}

// Runs only against the smoke profile, never the user's scene or media.
export async function checkVideoEditing(
  editor: BrowserWindow,
  output: BrowserWindow,
  videoId: string,
  textId: string,
) {
  const evaluate = (script: string) => editor.webContents.executeJavaScript(script);
  const snapshot = (): Promise<SceneSnapshot> => evaluate('window.studio.sceneSnapshot()');
  const command = (value: SceneCommand) =>
    evaluate(`window.studio.sceneCommand(${JSON.stringify(value)})`);
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (test: () => Promise<unknown>, label: string) => {
    for (let i = 0; i < 100; i++) {
      if (await test()) return;
      await delay(40);
    }
    throw new Error(`视频编辑验证逾时：${label}`);
  };
  const frameIn = (target: BrowserWindow) =>
    target.webContents.mainFrame.frames.find((f) => f.url.includes('/assets/video.html'));
  const targets = [editor, output];
  await wait(async () => {
    for (const target of targets) {
      const frame = frameIn(target);
      if (
        !frame ||
        !(await frame.executeJavaScript(
          'document.querySelector("video")?.currentTime > .1 && !document.querySelector("video").paused',
        ))
      )
        return false;
    }
    return true;
  }, '搭建与输出播放');
  const frames = targets.map((target) => frameIn(target)!);
  const token = `${Date.now()}-video-edit`;
  for (const frame of frames)
    await frame.executeJavaScript(`(() => {
      const video = document.querySelector('video');
      window.__videoEditProbe = {token:${JSON.stringify(token)},messages:0,emptied:0,seeks:0,plays:0,pauses:0};
      const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(video, 'currentTime', {
        get(){ return time.get.call(this); },
        set(value){window.__videoEditProbe.seeks++;time.set.call(this,value);},
      });
      for(const method of ['play','pause']) {
        const original=video[method];
        video[method]=function(...args){
          window.__videoEditProbe[method === 'play' ? 'plays' : 'pauses']++;
          return original.apply(this,args);
        };
      }
      addEventListener('message', event => {
        if (event.source === parent && event.data?.channel === 'zhuda-scene-state')
          window.__videoEditProbe.messages++;
      });
      video.addEventListener('emptied', () => window.__videoEditProbe.emptied++);
    })()`);
  const read = async (frame: WebFrameMain): Promise<VideoSample> =>
    (await frame.executeJavaScript(`(() => {
      const v=document.querySelector('video');
      return {...window.__videoEditProbe,time:v.currentTime,duration:v.duration,paused:v.paused};
    })()`)) as VideoSample;
  const before = await Promise.all(frames.map(read));
  await evaluate(
    `document.querySelector('.scene-layer-row[data-layer-id="${textId}"] .scene-layer-select').click()`,
  );
  await wait(
    () =>
      evaluate(`!!document.querySelector('.scene-hit-layer.selected[data-layer-id="${textId}"]')`),
    '选中文字',
  );
  editor.show();
  editor.focus();
  editor.webContents.focus();
  const point = await evaluate(`(() => {
    const r=document.querySelector('.scene-hit-layer[data-layer-id="${textId}"]').getBoundingClientRect();
    return {x:Math.round(r.x+20),y:Math.round(r.y+20)};
  })()`);
  const initial = await snapshot();
  const original = initial.layers.find((v) => v.layer.id === textId)!.layer;
  const nextLayerId =
    initial.layers[initial.layers.findIndex((v) => v.layer.id === textId) + 1]!.layer.id;
  const progress = [0, 0];
  let previous = before;
  editor.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  editor.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  await wait(
    () => evaluate('document.querySelector(".scene-saved")?.textContent.includes("调整中…")'),
    '开始拖动',
  );
  for (let i = 0; i < 28; i++) {
    editor.webContents.sendInputEvent({
      type: 'mouseMove',
      x: point.x + 12 + (i % 4) * 4,
      y: point.y - (i % 3) * 4,
    });
    await delay(50);
    const samples = await Promise.all(frames.map(read));
    for (let j = 0; j < frames.length; j++) {
      const sample = samples[j]!;
      assert.equal(sample.token, token, '拖动不得重新加载视频页面');
      assert.equal(sample.paused, false, '拖动不得暂停视频');
      const delta = sample.time - previous[j]!.time;
      const looped = previous[j]!.time > sample.duration - 0.3 && sample.time < 0.3;
      assert.ok(delta >= -0.03 || looped, '持续拖动时视频不得倒退');
      progress[j]! += looped ? delta + sample.duration : Math.max(0, delta);
    }
    previous = samples;
  }
  editor.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: point.x + 24,
    y: point.y,
  });
  await wait(
    async () =>
      (await snapshot()).layers.find((v) => v.layer.id === textId)!.layer.x !== original.x,
    '拖动保存',
  );
  for (let j = 0; j < frames.length; j++) {
    assert.ok(progress[j]! > 1, '持续拖动期间视频应正常向前播放');
    const sample = await read(frames[j]!);
    assert.equal(sample.messages, 0, '位置调整不应重发视频播放指令');
    assert.equal(sample.emptied, 0, '位置调整不应重载视频素材');
  }

  // Reorder across the video, then restore: CSS stacking must not move iframe DOM nodes.
  for (const placement of ['above', 'below'] as const) {
    await command({
      action: 'reorder',
      id: textId,
      targetId: videoId,
      placement,
      revision: (await snapshot()).document.revision,
    });
    await delay(100);
    for (let j = 0; j < targets.length; j++) {
      assert.equal(frameIn(targets[j]!), frames[j], '调整层级保留视频浏览上下文');
      assert.equal((await read(frames[j]!)).token, token, '调整层级不得重新加载视频页面');
    }
  }
  const state = await snapshot();
  await command({
    action: 'reorder',
    id: textId,
    targetId: nextLayerId,
    placement: 'below',
    revision: state.document.revision,
  });
  // Resizing and direct property edits must use the same geometry-only path.
  const video = (await snapshot()).layers.find((v) => v.layer.id === videoId)!.layer;
  await command({
    action: 'patch',
    id: videoId,
    revision: (await snapshot()).document.revision,
    patch: {
      x: video.x - 10,
      width: video.width - 20,
      height: video.height - 10,
      rotation: 3,
      opacity: 0.8,
    },
  });
  await delay(100);
  for (const frame of frames) {
    const sample = await read(frame);
    assert.equal(sample.token, token);
    assert.ok(sample.messages > 0, '尺寸变化应通知插件生命周期');
    assert.equal(sample.seeks, 0, '尺寸、层级、旋转与透明度不应跳转视频进度');
    assert.equal(sample.plays, 0, '尺寸、层级、旋转与透明度不应重发播放指令');
    assert.equal(sample.pauses, 0, '尺寸变化不应暂停视频');
    assert.equal(sample.emptied, 0, '尺寸变化不应重新加载视频');
  }
  await command({
    action: 'patch',
    id: videoId,
    revision: (await snapshot()).document.revision,
    patch: {
      x: video.x,
      width: video.width,
      height: video.height,
      rotation: video.rotation,
      opacity: video.opacity,
    },
  });
  await command({
    action: 'patch',
    id: textId,
    revision: (await snapshot()).document.revision,
    patch: { x: original.x, y: original.y },
  });

  await command({ action: 'control', id: videoId, state: 'pause' });
  await wait(
    async () => (await Promise.all(frames.map(read))).every((v) => v.paused),
    '暂停仍生效',
  );
  const paused = await Promise.all(frames.map(read));
  await delay(180);
  for (let j = 0; j < frames.length; j++)
    assert.ok(Math.abs((await read(frames[j]!)).time - paused[j]!.time) < 0.03, '暂停保持进度');
  await command({ action: 'control', id: videoId, state: 'resume' });
  await wait(
    async () => (await Promise.all(frames.map(read))).every((v) => !v.paused),
    '继续仍生效',
  );
  await command({ action: 'control', id: videoId, state: 'stop' });
  await wait(
    async () => (await Promise.all(frames.map(read))).every((v) => v.paused && v.time < 0.03),
    '停止归零',
  );
  await command({ action: 'control', id: videoId, state: 'start', mode: 'demo' });
  await wait(
    async () => (await Promise.all(frames.map(read))).every((v) => !v.paused && v.time > 0.1),
    '重新播放',
  );
  return {
    continuousDrag: true,
    geometryDoesNotSeek: true,
    reorderPreservesVideo: true,
    playbackControls: true,
  };
}
