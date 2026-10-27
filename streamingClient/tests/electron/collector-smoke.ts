import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, globalShortcut, safeStorage } from 'electron';
import type { StudioSnapshot } from '@zhuda/contracts';

// Use only a disposable profile, synthetic cookies and local page fixtures.
safeStorage.isEncryptionAvailable = () => true;
safeStorage.encryptString = (value) => Buffer.from(value);
safeStorage.decryptString = (value) => value.toString();
app.on('session-created', (session) => {
  session.protocol.handle(
    'https',
    () =>
      new Response('<!doctype html><title>本机登录夹具</title><p>本机登录夹具</p>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
  );
});
const callbacks = new Map<string, () => void>();
const register = globalShortcut.register.bind(globalShortcut);
globalShortcut.register = (key, callback) => {
  callbacks.set(key, callback);
  return register(key, callback);
};

async function checkCollector(window: BrowserWindow) {
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const snapshot = (): Promise<StudioSnapshot> => evaluate('window.studio.snapshot()');
  const scene = (input: object) => evaluate(`window.studio.sceneCommand(${JSON.stringify(input)})`);
  const wait = async (test: () => Promise<unknown> | unknown, label: string) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await test()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`直播连接验收超时：${label}`);
  };
  const click = (selector: string) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const value = (input: string) =>
    evaluate(`(() => {
      const el = document.querySelector('#live-room');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(input)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  const submit = () => evaluate('document.querySelector(".live-connection-form").requestSubmit()');
  await wait(() => evaluate('!!document.querySelector(".tour-close")'), '新手教学');
  await click('.tour-close');
  await wait(() => evaluate('!document.querySelector(".guided-tour")'), '关闭教学');
  assert.equal(await evaluate('!!document.querySelector("#live-room")'), true);
  assert.equal(await evaluate('document.querySelector("#connect-room").disabled'), true);
  await value('12345678demo');
  await scene({ action: 'add', pluginId: 'plugin.chain', sourceId: 'chain' });
  let state = (await snapshot()).scene!;
  const chain = state.layers.find((view) => view.layer.sourceId === 'chain')!.layer.id;
  await scene({ action: 'setCounter', id: chain, value: '30' });
  await scene({
    action: 'globalHotkeys',
    revision: state.document.revision,
    bindings: [
      {
        id: randomUUID(),
        accelerator: 'Control+Alt+F6',
        giftId: '2001',
        quantity: 1,
        enabled: true,
      },
    ],
  });
  await wait(() => callbacks.has('Control+Alt+F6'), '全局热键注册');
  const frame = () =>
    window.webContents.mainFrame.framesInSubtree.find((frame) =>
      frame.url.includes('/assets/index.html'),
    );
  await wait(() => frame(), '玩法页面');
  await frame()!.executeJavaScript(`window.addEventListener('message', event => {
    if (event.data?.channel === 'zhuda-scene-state') window.fixtureStateAt = Date.now();
  })`);

  // A pending editor dialog must block neither login nor keyboard events.
  let releaseDialog!: () => void;
  let dialogOpened = false;
  dialog.showSaveDialog = (() =>
    new Promise((resolve) => {
      dialogOpened = true;
      releaseDialog = () => resolve({ canceled: true, filePath: '' });
    })) as typeof dialog.showSaveDialog;
  await click('#account-menu-toggle');
  await evaluate(
    `Array.from(document.querySelectorAll('#account-menu button')).find(el => el.textContent.trim() === '导出诊断报告').click()`,
  );
  await wait(() => dialogOpened, '等待中的编辑操作');
  const started = Date.now();
  callbacks.get('Control+Alt+F6')!();
  assert.equal(
    (await snapshot()).scene!.layers.find((view) => view.layer.id === chain)!.runtime.game.round!
      .remaining,
    '29',
  );
  await wait(
    () => frame()!.executeJavaScript('document.querySelector("#remaining")?.textContent === "29"'),
    '热键即时送达画面',
  );
  const hotkeyDeliveryMs =
    Number(await frame()!.executeJavaScript('window.fixtureStateAt')) - started;
  assert.ok(hotkeyDeliveryMs < 1000, `热键送达超时：${hotkeyDeliveryMs} ms`);
  await click('#manage-connection');
  await wait(() => BrowserWindow.getAllWindows().length > 1, '忙碌时打开登录窗口');
  const login = BrowserWindow.getAllWindows().find((item) => item !== window)!;
  await wait(
    () => login.webContents.getURL().startsWith('https://live.douyin.com/'),
    '本机登录页面',
  );
  await login.webContents.session.cookies.set({
    url: 'https://live.douyin.com/',
    name: 'sessionid',
    value: 'local-fixture-only',
  });
  await wait(async () => (await snapshot()).collector.loggedIn, '扫码完成夹具');
  releaseDialog();
  await wait(
    () => evaluate('document.querySelector("#connect-room").disabled === false'),
    '连接按钮',
  );
  await value('https://example.com/123456');
  await submit();
  await wait(
    () => evaluate('document.querySelector(".studio-toast")?.textContent.includes("官方直播网址")'),
    '无效网址提示',
  );
  assert.equal((await snapshot()).collector.webId, '');
  await value('12345678demo');
  await submit();
  await wait(async () => (await snapshot()).collector.webId === '12345678demo', '号码连接');
  await evaluate(
    `Array.from(document.querySelectorAll('.observation-actions button')).find(el => el.textContent.trim() === '停止连接').click()`,
  );
  await wait(async () => (await snapshot()).collector.state === 'stopped', '停止连接');
  await value(' https://live.douyin.com/123456/?enter_from=share ');
  window.focus();
  await evaluate('document.querySelector("#live-room").focus()');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await wait(async () => (await snapshot()).collector.webId === '123456', '回车提交网址');
  const layouts = [];
  for (const [width, height] of [
    [1024, 768],
    [1440, 960],
  ]) {
    window.setSize(width!, height!);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const layout = await evaluate(`(() => {
      const side = document.querySelector('.studio-side-content');
      const form = document.querySelector('.live-connection-form').getBoundingClientRect();
      const input = document.querySelector('#live-room').getBoundingClientRect();
      return { width: innerWidth, overflow: side.scrollWidth > side.clientWidth + 1,
        inputVisible: input.width > 100 && input.top >= 0 && input.right <= form.right };
    })()`);
    assert.equal(layout.overflow, false);
    assert.equal(layout.inputVisible, true);
    layouts.push(layout);
    writeFileSync(
      join(process.env.LIVE_COLLECTOR_ARTIFACTS!, `connection-${width}.png`),
      (await window.webContents.capturePage()).toPNG(),
    );
  }
  const report = {
    platform: process.platform,
    roomNumber: true,
    roomUrl: true,
    enterSubmit: true,
    invalidUrl: true,
    loginWhileBusy: true,
    stopConnection: true,
    hotkeyWhileBusy: true,
    hotkeyDeliveryMs,
    layouts,
  };
  writeFileSync(
    join(process.env.LIVE_COLLECTOR_ARTIFACTS!, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

app.once('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    void checkCollector(window).then(
      () => app.exit(0),
      async (error) => {
        console.error(error);
        console.error(
          '登录状态：',
          await window.webContents.executeJavaScript(
            'window.studio.snapshot().then(snapshot => snapshot.collector)',
          ),
        );
        writeFileSync(
          join(process.env.LIVE_COLLECTOR_ARTIFACTS!, 'failure.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        app.exit(1);
      },
    );
  });
});
require(process.env.LIVE_COLLECTOR_MAIN!);
