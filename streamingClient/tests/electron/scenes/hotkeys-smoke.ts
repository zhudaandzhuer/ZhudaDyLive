import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { globalShortcut, type BrowserWindow } from 'electron';
import type { SceneSnapshot } from '@zhuda/contracts';

export async function checkSceneHotkeys(window: BrowserWindow) {
  const evaluate = (script: string) => window.webContents.executeJavaScript(script);
  const snapshot = (): Promise<SceneSnapshot> => evaluate('window.studio.sceneSnapshot()');
  const command = (input: object) =>
    evaluate(`window.studio.sceneCommand(${JSON.stringify(input)})`);
  const wait = async (test: () => Promise<unknown>, label: string, attempts = 160) => {
    for (let i = 0; i < attempts; i++) {
      if (await test()) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`热键验收超时：${label}`);
  };
  const button = (label: string, scope = '.hotkey-editor') =>
    evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(scope + ' button')})).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const value = (selector: string, input: string) =>
    evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(input)});
    el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));
  })()`);
  await command({ action: 'sceneCreate', name: '热键验收' });
  await command({ action: 'add', pluginId: 'plugin.chain', sourceId: 'chain' });
  const id = (await snapshot()).layers[0]!.layer.id;
  await command({ action: 'control', id, state: 'start', mode: 'demo', initial: '30' });
  await evaluate(`document.querySelector('[data-hotkey-settings]').click()`);
  await button('添加热键');
  await wait(
    () => evaluate(`document.querySelector('[aria-label="录制热键 1"]')?.disabled===false`),
    '录制就绪',
  );
  await evaluate(
    `(() => {const el=document.querySelector('[aria-label="录制热键 1"]');el.focus();el.dispatchEvent(new KeyboardEvent('keydown',{key:'F6',code:'F6',ctrlKey:true,altKey:true,bubbles:true}));})()`,
  );
  await value('[aria-label="热键事件 1"]', 'unlock');
  await value('[aria-label="热键数量 1"]', '3');
  await button('保存热键');
  await wait(async () => (await snapshot()).hotkeys?.[0]?.state === 'active', '系统注册');
  assert.equal(globalShortcut.isRegistered('Control+Alt+F6'), true);
  const saved = await snapshot(),
    binding = saved.layers[0]!.layer.hotkeys![0]!;
  assert.equal(binding.amount, 3);
  if (process.env.LIVE_SCENE_SMOKE_NATIVE_HOTKEY) {
    const directory = process.env.LIVE_SCENE_SMOKE_NATIVE_HOTKEY;
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'ready.json'),
      JSON.stringify({ id, accelerator: binding.accelerator, before: '30', expected: '27' }),
    );
    await wait(
      async () => (await snapshot()).layers[0]!.runtime.game.round?.remaining === '27',
      '真实全局键盘输入',
      2000,
    );
    await wait(async () => !!(await snapshot()).hotkeys?.[0]?.lastTriggeredAt, '热键成功反馈');
    assert.equal((await snapshot()).layers[0]!.runtime.game.lastAction?.giftName, '热键补触发');
  } else {
    await command({ action: 'hotkey', id, hotkeyId: binding.id, requestId: randomUUID() });
  }
  const after = (await snapshot()).layers[0]!.runtime.game.round!.remaining;
  assert.equal(after, '27');
  // Recording an already-bound key must not trigger the live action.
  window.focus();
  await evaluate(`document.querySelector('[data-hotkey-settings]').click()`);
  await wait(
    async () => (await snapshot()).hotkeys?.[0]?.state === 'suspended',
    '录制暂停全局热键',
  );
  assert.equal(globalShortcut.isRegistered(binding.accelerator), false);
  await button('取消');
  await wait(async () => (await snapshot()).hotkeys?.[0]?.state === 'active', '取消录制恢复注册');
  await value('[aria-label="补触发事件"]', 'unlock');
  await value('[aria-label="补触发数量"]', '2');
  await button('补触发', '.scene-hotkeys');
  await wait(
    async () => (await snapshot()).layers[0]!.runtime.game.round?.remaining === '25',
    '手动按钮',
  );
  await command({ action: 'control', id, state: 'pause' });
  assert.equal(globalShortcut.isRegistered(binding.accelerator), false);
  await command({ action: 'control', id, state: 'resume' });
  assert.equal(globalShortcut.isRegistered(binding.accelerator), true);
  const sceneId = (await snapshot()).document.id;
  await command({ action: 'sceneCreate', name: '热键隔离' });
  assert.equal(globalShortcut.isRegistered(binding.accelerator), false);
  await command({ action: 'sceneSwitch', id: sceneId });
  assert.deepEqual((await snapshot()).layers[0]!.layer.hotkeys, [binding]);
  return {
    nativeGlobalKey: !!process.env.LIVE_SCENE_SMOKE_NATIVE_HOTKEY,
    recordedThroughUi: true,
    manualButton: true,
    captureSuspends: true,
    pauseReleases: true,
    scenePersistence: true,
  };
}
