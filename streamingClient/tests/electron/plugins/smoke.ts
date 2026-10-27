import { enterWorkspace } from '../entry-smoke';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow, WebFrameMain } from 'electron';
import type { PluginManager } from '../../../client/src/main/plugins/manager';

export async function checkPlugins(
  window: BrowserWindow,
  manager: PluginManager,
  serviceUrl: string,
) {
  const evaluate = async (code: string) => {
    try {
      return await window.webContents.executeJavaScript(code);
    } catch (error) {
      throw new Error('插件验证脚本失败：' + code, { cause: error });
    }
  };
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 40));
  const wait = async (check: () => Promise<unknown>, label: string) => {
    for (let i = 0; i < 200; i++) {
      if (await check()) return;
      await pause();
    }
    throw new Error(`插件实机验证逾时：${label}`);
  };
  const click = async (selector: string) => {
    await wait(
      () =>
        evaluate(
          `(() => { const element = document.querySelector(${JSON.stringify(selector)}); return !!element && !element.closest('[inert]'); })()`,
        ),
      selector,
    );
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await pause();
  };
  const action = async (text: string) => {
    await evaluate(
      `Array.from(document.querySelectorAll('[data-plugin-id="plugin.notes"] .plugin-card-actions button')).find(b => b.textContent.includes(${JSON.stringify(text)})).click()`,
    );
    await pause();
  };
  const capture = async (name: string) => {
    if (!process.env.LIVE_SMOKE_ARTIFACTS) return;
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    mkdirSync(process.env.LIVE_SMOKE_ARTIFACTS, { recursive: true });
    writeFileSync(
      join(process.env.LIVE_SMOKE_ARTIFACTS, `${name}.png`),
      (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    );
  };
  let frame: WebFrameMain;
  const open = async () => {
    await action('打开');
    await wait(async () => {
      const found = window.webContents.mainFrame.frames.find((f) =>
        f.url.startsWith('zhuda-plugin:'),
      );
      if (!found) return false;
      frame = found;
      return found.executeJavaScript(
        '!!document.querySelector("#note") && !document.querySelector("#note").disabled',
      );
    }, '插件 iframe 与 SDK 初始化');
  };
  await enterWorkspace(window);
  await wait(() => evaluate('!!document.querySelector(".scene-editor")'), '工作台');
  await wait(
    () =>
      evaluate(
        'window.studio.snapshot().then(s => s.tutorialDismissed || !!document.querySelector(".guided-tour"))',
      ),
    '教学初始状态',
  );
  if (await evaluate('!!document.querySelector(".guided-tour")')) {
    await click('.tour-remember input');
    await click('.tour-actions > .text-button');
    await wait(() => evaluate('!document.querySelector(".guided-tour")'), '跳过教学');
  }
  await wait(() => evaluate('!document.querySelector(".app-shell").inert'), '工作台可操作');
  await manager.sync();
  await click('#tab-plugins');
  const restart = process.env.LIVE_PLUGIN_SMOKE_PHASE === 'restart';
  if (restart) {
    await open();
    assert.equal(
      await frame!.executeJavaScript('document.querySelector("#note").value'),
      '插件跨窗口与重启保存成功',
    );
    return {
      restartPersistence: true,
      version: manager.snapshot().installed.find((p) => p.item.manifest.id === 'plugin.notes')!.item
        .manifest.version,
    };
  }
  await capture('plugin-store');
  await action('安装插件');
  assert.match(
    await evaluate('document.querySelector(".plugin-review").textContent'),
    /保存插件数据/,
  );
  await capture('plugin-permissions');
  await click('.plugin-review .button.full');
  await wait(
    () =>
      evaluate(
        'window.studio.snapshot().then(s => s.plugins.installed.some(p => p.item.manifest.id === "plugin.notes"))',
      ),
    '安装',
  );
  await open();
  const isolation = await frame!.executeJavaScript(
    `(() => { let parentBlocked = false; try { void parent.document.body; } catch { parentBlocked = true; } return { node: typeof require, bridge: typeof window.studio, parentBlocked }; })()`,
  );
  assert.deepEqual(isolation, { node: 'undefined', bridge: 'undefined', parentBlocked: true });
  const denied = await frame!.executeJavaScript(
    `new Promise(resolve => { const listener = e => { if(e.data?.id === 'permission-probe'){ removeEventListener('message', listener); resolve(e.data.error); } }; addEventListener('message',listener); parent.postMessage({channel:'zhuda-plugin-request',id:'permission-probe',request:{method:'folders.choose'}},'*'); })`,
  );
  assert.match(String(denied), /权限/);
  await frame!.executeJavaScript(
    `document.querySelector('#note').value = '插件跨窗口与重启保存成功'; document.querySelector('#note').dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('#save').click();`,
  );
  await wait(
    () => frame!.executeJavaScript('document.querySelector("#status").textContent === "已保存"'),
    'SDK 保存',
  );
  await evaluate(
    `window.postMessage({channel:'zhuda-plugin-request',id:'spoof',request:{method:'storage.set',key:'note',value:'伪造来源'}},'*')`,
  );
  await pause();
  assert.equal(
    await manager.request('plugin.notes', { method: 'storage.get', key: 'note' }),
    '插件跨窗口与重启保存成功',
  );
  await capture('plugin-notes');
  await click('.plugin-runtime-bar .text-button');
  await action('禁用');
  await wait(
    () =>
      evaluate(
        'window.studio.snapshot().then(s => !s.plugins.installed.find(p => p.item.manifest.id === "plugin.notes").enabled)',
      ),
    '禁用',
  );
  await assert.rejects(manager.request('plugin.notes', { method: 'info' }));
  await action('启用插件');
  await wait(
    () =>
      evaluate(
        'window.studio.snapshot().then(s => s.plugins.installed.find(p => p.item.manifest.id === "plugin.notes").enabled)',
      ),
    '重新启用',
  );
  await fetch(new URL('/smoke/advance', serviceUrl), { method: 'POST' });
  await manager.sync();
  await wait(
    () =>
      evaluate(
        '!!Array.from(document.querySelectorAll(".plugin-card-actions button")).find(b => b.textContent.includes("更新至"))',
      ),
    '更新可用',
  );
  await action('更新至');
  await wait(
    () =>
      evaluate(
        'window.studio.snapshot().then(s => s.plugins.installed.find(p => p.item.manifest.id === "plugin.notes").item.manifest.version === "1.1.0")',
      ),
    '更新完成',
  );
  assert.match(
    await evaluate(
      `document.querySelector('[data-plugin-id="plugin.notes"] .plugin-version-info').textContent`,
    ),
    /已安装 v1.1.0/,
  );
  assert.equal(
    await evaluate(`!!document.querySelector('.plugin-review')`),
    false,
    '相同权限的插件更新一次点击完成',
  );
  await action('移除');
  await wait(
    () =>
      evaluate(
        'window.studio.snapshot().then(s => !s.plugins.installed.some(p => p.item.manifest.id === "plugin.notes"))',
      ),
    '移除',
  );
  await action('安装插件');
  await click('.plugin-review .button.full');
  await wait(
    () =>
      evaluate(
        'window.studio.snapshot().then(s => s.plugins.installed.some(p => p.item.manifest.id === "plugin.notes"))',
      ),
    '重新安装',
  );
  await open();
  assert.equal(
    await frame!.executeJavaScript('document.querySelector("#note").value'),
    '插件跨窗口与重启保存成功',
  );
  await click('.plugin-runtime-bar .text-button');
  window.setContentSize(1020, 720);
  await capture('plugin-store-narrow');
  const layout = await evaluate(
    `(() => { const tab = document.querySelector('#tab-plugins').getBoundingClientRect(); return { noHorizontalOverflow: document.documentElement.scrollWidth === innerWidth, tabVisible: tab.right <= innerWidth, installed: document.querySelectorAll('[data-plugin-id="plugin.notes"]').length }; })()`,
  );
  assert.equal(layout.noHorizontalOverflow, true);
  assert.equal(layout.tabVisible, true);
  assert.equal(layout.installed, 1);
  return {
    installed: true,
    iframe: true,
    isolation,
    deniedUndeclaredPermission: true,
    rejectedSpoof: true,
    saved: true,
    updated: true,
    disabled: true,
    removedAndReinstalled: true,
    layout,
  };
}
