import assert from 'node:assert/strict';
import { dialog, type BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StudioSnapshot } from '@zhuda/contracts';
import { enterWorkspace } from './entry-smoke';

export async function checkPlatform(window: BrowserWindow, output: () => BrowserWindow | null) {
  window.setIgnoreMouseEvents(true);
  const directory = process.env.LIVE_PLATFORM_SMOKE_DIR!;
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const snapshot = (): Promise<StudioSnapshot> => evaluate('window.studio.snapshot()');
  const scene = (command: object) =>
    evaluate(`window.studio.sceneCommand(${JSON.stringify(command)})`);
  const wait = async (test: () => Promise<unknown>, label: string, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await test()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`基础平台验证超时：${label}`);
  };
  await enterWorkspace(window);
  await wait(() => evaluate('!!document.querySelector(".tour-close")'), '新手教学');
  await evaluate('document.querySelector(".tour-close")?.click()');
  await wait(() => evaluate('!document.querySelector(".guided-tour")'), '关闭教学');
  await scene({ action: 'add', pluginId: 'plugin.scene-basics', sourceId: 'text' });
  let state = (await snapshot()).scene!;
  const text = state.layers.find((v) => v.layer.sourceId === 'text')!.layer;
  await scene({
    action: 'patch',
    id: text.id,
    revision: state.document.revision,
    patch: { x: 60 },
  });
  await wait(
    () => evaluate(`!document.querySelector('[aria-label="撤销场景编辑"]').disabled`),
    '撤销按钮启用',
  );
  await evaluate(`document.querySelector('[aria-label="撤销场景编辑"]').click()`);
  await wait(
    async () =>
      (await snapshot()).scene!.layers.find((v) => v.layer.id === text.id)!.layer.x === text.x,
    '撤销按钮',
  );
  assert.equal(
    (await snapshot()).scene!.layers.find((v) => v.layer.id === text.id)!.layer.x,
    text.x,
  );
  await wait(
    () => evaluate(`!document.querySelector('[aria-label="重做场景编辑"]').disabled`),
    '重做按钮启用',
  );
  await evaluate(`document.querySelector('[aria-label="重做场景编辑"]').click()`);
  await wait(
    async () =>
      (await snapshot()).scene!.layers.find((v) => v.layer.id === text.id)!.layer.x === 60,
    '重做按钮',
  );
  assert.equal((await snapshot()).scene!.layers.find((v) => v.layer.id === text.id)!.layer.x, 60);
  const originalOpen = dialog.showOpenDialog,
    originalSave = dialog.showSaveDialog;
  let selected = '';
  dialog.showOpenDialog = (async () => ({
    canceled: false,
    filePaths: [selected],
  })) as typeof dialog.showOpenDialog;
  dialog.showSaveDialog = (async () => ({
    canceled: false,
    filePath: join(directory, 'scene.zhudascene'),
  })) as typeof dialog.showSaveDialog;
  try {
    for (const kind of ['image', 'video']) {
      await scene({ action: 'add', pluginId: 'plugin.scene-basics', sourceId: kind });
      const layer = (await snapshot()).scene!.layers.find((v) => v.layer.sourceId === kind)!.layer;
      selected = join(directory, kind === 'image' ? 'test.png' : 'test.webm');
      await scene({ action: 'importMedia', id: layer.id, key: 'file' });
      await scene({ action: 'control', id: layer.id, state: 'start', mode: 'demo' });
    }
    await wait(async () => {
      const frame = window.webContents.mainFrame.frames.find((f) =>
        f.url.endsWith('/assets/video.html'),
      );
      return frame?.executeJavaScript('document.querySelector("video")?.readyState >= 2');
    }, '视频解码');
    await scene({ action: 'exportScene' });
    const originalId = (await snapshot()).scene!.document.id;
    selected = join(directory, 'scene.zhudascene');
    await scene({ action: 'importScene' });
    assert.notEqual((await snapshot()).scene!.document.id, originalId);
    assert.equal((await snapshot()).scene!.layers.length, 3);
    const importedText = (await snapshot()).scene!.layers.find(
      (v) => v.layer.sourceId === 'text',
    )!.layer;
    await wait(
      async () =>
        !!window.webContents.mainFrame.frames.find((f) => f.url.endsWith('/assets/text.html')),
      '导入后文字',
    );
    const frame = window.webContents.mainFrame.frames.find((f) =>
      f.url.endsWith('/assets/text.html'),
    )!;
    await frame.executeJavaScript(
      'window.dispatchEvent(new ErrorEvent("error",{message:"smoke failure",error:new Error("smoke failure")}))',
    );
    await wait(
      async () =>
        !(await snapshot()).scene!.layers.find((v) => v.layer.id === importedText.id)!.available,
      '来源异常隔离',
    );
    await scene({ action: 'retrySource', id: importedText.id });
    assert.equal(
      (await snapshot()).scene!.layers.find((v) => v.layer.id === importedText.id)!.available,
      true,
    );
  } finally {
    dialog.showOpenDialog = originalOpen;
    dialog.showSaveDialog = originalSave;
  }
  await scene({ action: 'add', pluginId: 'plugin.chain', sourceId: 'chain' });
  state = (await snapshot()).scene!;
  const chain = state.layers.find((v) => v.layer.sourceId === 'chain')!;
  await scene({
    action: 'control',
    id: chain.layer.id,
    state: 'start',
    mode: 'demo',
    initial: '20',
  });
  await scene({ action: 'output', open: true });
  assert.ok(output());
  const preview = await evaluate('window.studio.mobilePreview("start")');
  assert.equal(preview.active, true);
  writeFileSync(
    join(directory, 'ready.json'),
    JSON.stringify({ preview: preview.addresses[0]?.url }),
  );
  const artifacts = process.env.LIVE_SMOKE_ARTIFACTS;
  if (artifacts)
    writeFileSync(
      join(artifacts, 'platform-restored.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
  assert.ok(readFileSync(join(directory, 'scene.zhudascene')).length);
  return {
    directLaunch: true,
    undoRedo: true,
    imageVideo: true,
    sceneArchive: true,
    sourceIsolation: true,
    previewAvailable: true,
    persistedScene: true,
  };
}
