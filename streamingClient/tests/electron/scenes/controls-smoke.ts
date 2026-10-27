import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, globalShortcut, type BrowserWindow, type KeyboardInputEvent } from 'electron';
import type { SceneSnapshot } from '@zhuda/contracts';

async function checkControls(window: BrowserWindow) {
  const evaluate = (script: string) =>
    window.webContents.executeJavaScript(script).catch((error) => {
      throw new Error(`界面操作失败：${script.slice(0, 300)}`, { cause: error });
    });
  const snapshot = (): Promise<SceneSnapshot> => evaluate('window.studio.sceneSnapshot()');
  const command = (input: object) =>
    evaluate(`window.studio.sceneCommand(${JSON.stringify(input)})`);
  const wait = async (test: () => Promise<unknown>, label: string) => {
    for (let i = 0; i < 200; i++) {
      if (await test()) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`操作面板验收超时：${label}`);
  };
  const click = (label: string, scope = '.global-event-panel') =>
    evaluate(`(() => {
      const button = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})]
        .find(el => el.textContent.trim() === ${JSON.stringify(label)});
      if (!button || button.disabled) throw new Error('按钮不可用：' + ${JSON.stringify(label)});
      button.click();
    })()`);
  const value = (selector: string, input: string) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(input)});
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));
    })()`);
  const count = async (id: string) =>
    (await snapshot()).layers.find((view) => view.layer.id === id)!.runtime.game.round!.remaining;
  await wait(() => evaluate('!!document.querySelector(".scene-editor")'), '工作台');
  await wait(() => evaluate('!!document.querySelector(".tour-close")'), '新手教学');
  await evaluate('document.querySelector(".tour-close").click()');
  await command({ action: 'add', pluginId: 'plugin.chain', sourceId: 'chain' });
  await command({ action: 'add', pluginId: 'plugin.sewing', sourceId: 'sewing' });
  const initial = await snapshot();
  const chain = initial.layers.find((view) => view.layer.sourceId === 'chain')!.layer.id;
  const sewing = initial.layers.find((view) => view.layer.sourceId === 'sewing')!.layer.id;
  assert.equal(await count(chain), '1');
  assert.equal(await count(sewing), '1');
  await wait(async () => {
    const frames = window.webContents.mainFrame.framesInSubtree;
    return initial.layers.every(
      (view) => !view.url || frames.some((frame) => frame.url === view.url),
    );
  }, '玩法页面加载');
  const painted = async (id: string, expected: string) => {
    const url = initial.layers.find((view) => view.layer.id === id)!.url;
    const frame = window.webContents.mainFrame.framesInSubtree.find((frame) => frame.url === url);
    return frame?.executeJavaScript(`!![...document.querySelectorAll('canvas')].find(canvas =>
      canvas.dataset.renderedCount === ${JSON.stringify(expected)})`);
  };
  await wait(
    async () => (await painted(chain, '1')) && (await painted(sewing, '1')),
    '画面初始数量',
  );
  for (const id of [chain, sewing]) {
    window.focus();
    await evaluate(`document.querySelector('[data-layer-id="${id}"] .scene-layer-select').click()`);
    await wait(
      () =>
        evaluate(`!!document.querySelector('.scene-layer-row.selected[data-layer-id="${id}"]') &&
      [...document.querySelectorAll('.scene-field')]
        .find(el => el.querySelector('span')?.textContent === '当前数量')?.querySelector('input')?.disabled === false`),
      '当前数量输入框',
    );
    await evaluate(`(() => {
      const el = [...document.querySelectorAll('.scene-field')]
        .find(el => el.querySelector('span')?.textContent === '当前数量').querySelector('input');
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '10');
      el.dispatchEvent(new Event('input', {bubbles: true}));
    })()`);
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true
    }))`);
    await wait(async () => (await count(id)) === '10', '直接编辑当前数量');
    await wait(() => painted(id, '10'), '画面数量同步');
    await evaluate(`(() => {
      const el = [...document.querySelectorAll('.scene-field')]
        .find(el => el.querySelector('span')?.textContent === '当前数量').querySelector('input');
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '999');
      el.dispatchEvent(new Event('input', {bubbles: true}));
    })()`);
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', bubbles: true
    }))`);
    assert.equal(await count(id), '10');
  }
  await evaluate('document.querySelector("#tab-test").click()');
  await click('全局热键设置 0');
  await click('添加全局热键');
  window.focus();
  const record = async (
    index: number,
    key: string,
    modifiers: KeyboardInputEvent['modifiers'] = [],
  ) => {
    const selector = `[aria-label="全局热键 ${index}"]`;
    await wait(
      () => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false`),
      '热键录制',
    );
    assert.equal(
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).readOnly`),
      true,
    );
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
    await wait(
      () =>
        evaluate(`document.activeElement !== document.querySelector(${JSON.stringify(selector)})`),
      '键盘录制完成',
    );
  };
  await record(1, 'W');
  await value('[aria-label="全局热键礼物 1"]', '2001');
  await click('添加全局热键');
  await record(2, 'F6', ['control', 'alt']);
  await value('[aria-label="全局热键礼物 2"]', '2001');
  const layouts = [];
  for (const [width, height] of [
    [1024, 768],
    [1280, 800],
    [1720, 960],
  ]) {
    window.setSize(width!, height!);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const layout = await evaluate(`(() => {
      const panel = document.querySelector('.global-event-panel');
      const side = document.querySelector('.studio-side-content');
      const bounds = panel.getBoundingClientRect();
      const escaped = [...panel.querySelectorAll('input, select, button, label')].filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1);
      }).map(el => el.getAttribute('aria-label') || el.textContent.trim());
      return { width: innerWidth, overflow: side.scrollWidth > side.clientWidth + 1, escaped };
    })()`);
    assert.deepEqual(layout.escaped, []);
    assert.equal(layout.overflow, false);
    layouts.push(layout);
    writeFileSync(
      join(process.env.LIVE_CONTROLS_ARTIFACTS!, `controls-${width}.png`),
      (await window.webContents.capturePage()).toPNG(),
    );
  }
  await click('保存热键');
  await wait(async () => (await snapshot()).document.globalHotkeys?.length === 2, '保存热键');
  await wait(
    async () => (await snapshot()).hotkeys?.every((entry) => entry.state === 'active'),
    '系统注册',
  );
  assert.equal(globalShortcut.isRegistered('W'), true);
  assert.equal(globalShortcut.isRegistered('Control+Alt+F6'), true);
  const bindings = (await snapshot()).document.globalHotkeys!;
  assert.equal(bindings[0]!.accelerator, 'W');
  assert.equal(bindings[1]!.accelerator, 'Control+Alt+F6');
  await click('全局热键设置 2');
  await wait(
    async () => (await snapshot()).hotkeys?.every((entry) => entry.state === 'suspended'),
    '录制暂停注册',
  );
  // A subsequent publish must not release capture or let registered keys steal recording input.
  await command({ action: 'setCounter', id: chain, value: '10' });
  assert.equal(globalShortcut.isRegistered('W'), false);
  assert.equal(globalShortcut.isRegistered('Control+Alt+F6'), false);
  await click('取消');
  await wait(
    async () => (await snapshot()).hotkeys?.every((entry) => entry.state === 'active'),
    '取消录制恢复',
  );
  const native = process.env.LIVE_CONTROLS_NATIVE === '1' && process.platform === 'darwin';
  if (native) {
    execFileSync('osascript', [
      '-e',
      'tell application "System Events" to key code 97 using {control down, option down}',
    ]);
  } else {
    await command({
      action: 'globalHotkey',
      hotkeyId: bindings[1]!.id,
      requestId: crypto.randomUUID(),
    });
  }
  await wait(
    async () => (await count(chain)) === '9' && (await count(sewing)) === '11',
    '两个插件响应同一全局热键',
  );
  await wait(
    async () => (await painted(chain, '9')) && (await painted(sewing, '11')),
    '礼物后的画面数量',
  );
  await command({ action: 'setCounter', id: chain, value: '0' });
  assert.equal(
    (await snapshot()).layers.find((v) => v.layer.id === chain)!.runtime.game.round!.status,
    'won',
  );
  await command({ action: 'setCounter', id: chain, value: '5' });
  assert.equal(
    (await snapshot()).layers.find((v) => v.layer.id === chain)!.runtime.game.round!.status,
    'running',
  );
  const report = {
    defaults: [1, 1],
    currentQuantity: true,
    keyRecording: true,
    captureSurvivesPublish: true,
    globalGiftFanout: true,
    native,
    layouts,
  };
  writeFileSync(
    join(process.env.LIVE_CONTROLS_ARTIFACTS!, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

app.once('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    void checkControls(window).then(
      () => app.exit(0),
      async (error) => {
        console.error(error);
        console.error(
          '界面状态：',
          await window.webContents.executeJavaScript(`(async () => ({
          active: document.activeElement?.outerHTML,
          fields: [...document.querySelectorAll('.scene-field')].map(el => [el.querySelector('span')?.textContent, el.querySelector('input')?.value]),
          toast: document.querySelector('.studio-toast')?.textContent,
          counts: (await window.studio.sceneSnapshot()).layers.map(v => [v.layer.sourceId, v.runtime.game.round?.remaining])
        }))()`),
        );
        writeFileSync(
          join(process.env.LIVE_CONTROLS_ARTIFACTS!, 'failure.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        app.exit(1);
      },
    );
  });
});
require(process.env.LIVE_CONTROLS_MAIN!);
