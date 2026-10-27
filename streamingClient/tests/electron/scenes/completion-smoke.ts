import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { SceneSnapshot } from '@zhuda/contracts';

export async function checkCompletionEffects(
  window: BrowserWindow,
  getOutput: () => BrowserWindow | null,
) {
  const evaluate = (script: string) => window.webContents.executeJavaScript(script);
  const command = (value: object) =>
    evaluate(`window.studio.sceneCommand(${JSON.stringify(value)})`);
  const snapshot = (): Promise<SceneSnapshot> => evaluate('window.studio.sceneSnapshot()');
  const wait = async (check: () => Promise<unknown>, label: string) => {
    for (let i = 0; i < 160; i++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    console.log('completion-failure', label, {
      editor: window.webContents.mainFrame.frames.map((f) => f.url),
      output: getOutput()?.webContents.mainFrame.frames.map((f) => f.url),
      scene: (await snapshot()).layers.map((v) => ({
        plugin: v.layer.pluginId,
        available: v.available,
        error: v.error,
      })),
      outputText: await getOutput()?.webContents.executeJavaScript('document.body.innerText'),
    });
    throw new Error(`完成特效验收超时：${label}`);
  };
  const original = await snapshot();
  await command({ action: 'sceneCreate', name: '通用完成特效验收' });
  const sceneId = (await snapshot()).document.id;
  await command({ action: 'output', open: true });
  const results = [];
  for (const source of ['chain', 'sewing']) {
    await command({ action: 'add', pluginId: `plugin.${source}`, sourceId: source });
    const id = (await snapshot()).layers.filter((v) => v.layer.sourceId === source).at(-1)!.layer
      .id;
    await command({ action: 'control', id, state: 'start', mode: 'demo', initial: '1' });
    await command({
      action: 'patch',
      id,
      revision: (await snapshot()).document.revision,
      patch: { locked: true },
    });
    const edit = (key: string, value: string) =>
      evaluate(`(() => {
      const field=Array.from(document.querySelectorAll('[data-parameter-group="完成特效"] .scene-field')).find(f=>f.textContent.includes(${JSON.stringify(key)}));
      const input=field?.querySelector('input');
      if (!input || input.disabled) throw new Error('锁定图层仍须允许实时配置：'+${JSON.stringify(key)});
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await wait(
      () =>
        evaluate(
          `!!document.querySelector('[data-parameter-group="完成特效"]') && document.querySelector('.scene-hit-layer.selected')?.dataset.layerId === '${id}'`,
        ),
      '自动生成通用参数面板',
    );
    const title = `${source} 收工啦！`;
    await edit('完成文案', title);
    await edit('展示时长', '3');
    await wait(async () => {
      const settings = (await snapshot()).layers.find((v) => v.layer.id === id)!.layer.settings;
      return settings.completionText === title && settings.completionDuration === 3;
    }, '文案和时长不需解除锁定或失焦即可保存');
    const current = () => snapshot().then((s) => s.layers.find((v) => v.layer.id === id)!);
    const roundId = (await current()).runtime.game.round!.id;
    await command({ action: 'control', id, state: 'pause' });
    await wait(
      () =>
        evaluate(
          `document.querySelector('.scene-runtime .scene-control-buttons')?.textContent.includes('继续')`,
        ),
      '暂停玩法',
    );
    await evaluate(`(() => {
      const button=document.querySelectorAll('.scene-theme-options button')[1];
      if (!button || button.disabled) throw new Error('锁定图层也应允许切换主题');
      button.click();
    })()`);
    const theme = source === 'chain' ? 'monochrome' : 'chrome';
    await wait(async () => {
      const view = await current();
      if (!view.layer.locked || view.layer.theme !== theme || view.runtime.status !== 'paused')
        return false;
      for (const target of [window, getOutput()!]) {
        const frame = target.webContents.mainFrame.frames.find((f) => f.name === id);
        if (!frame || !(await frame.executeJavaScript(`document.body.dataset.theme==='${theme}'`)))
          return false;
      }
      return true;
    }, '锁定并暂停时切换主题，编辑器与输出同时生效');
    assert.equal((await current()).runtime.game.round!.id, roundId);
    assert.equal((await current()).runtime.game.round!.remaining, '1');
    await command({ action: 'control', id, state: 'resume' });
    const remove = () =>
      command({
        action: 'trigger',
        id,
        eventId: source === 'chain' ? 'unlock' : 'release',
        amount: 100000,
        requestId: randomUUID(),
      });
    const addGift = () =>
      command({
        action: 'simulate',
        id,
        giftId: source === 'chain' ? '685' : '2001',
        quantity: '1',
        requestId: randomUUID(),
      });
    const overlay = `.scene-render-layer[data-layer-id="${id}"] .scene-completion-effect`;
    const everyView = async (script: string) => {
      for (const target of [window, getOutput()!])
        if (!(await target.webContents.executeJavaScript(script))) return false;
      return true;
    };
    const shown = () =>
      everyView(
        `document.querySelector(${JSON.stringify(overlay)})?.textContent===${JSON.stringify(title)}`,
      );
    const hidden = () => everyView(`!document.querySelector(${JSON.stringify(overlay)})`);
    await remove();
    await wait(shown, source + ' 完成文字和烟火');
    const first = (await current()).runtime.completionId;
    await wait(
      () =>
        everyView(`(() => {
      const c=document.querySelector(${JSON.stringify(overlay + ' canvas')});
      return !!c && c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0);
    })()`),
      '烟火实际绘制',
    );
    await edit('特效颜色', '#ff77aa');
    await wait(
      () =>
        everyView(
          `getComputedStyle(document.querySelector(${JSON.stringify(overlay + ' strong')})).color==='rgb(255, 119, 170)'`,
        ),
      '播放期间颜色实时变化',
    );
    await wait(hidden, '三秒后文字和烟火彻底移除');
    assert.equal((await current()).runtime.status, 'running');
    assert.equal((await current()).runtime.game.round!.status, 'won');
    await command({ action: 'settings', id, values: { completionDuration: 5 } });
    await command({ action: 'output', open: false });
    await command({ action: 'output', open: true });
    await wait(
      async () =>
        !!getOutput()?.webContents.mainFrame.frames.find((f) =>
          f.url.startsWith(`zhuda-plugin://plugin.${source}/`),
        ),
      source + ' 重开输出',
    );
    assert.equal(await hidden(), true, '修改设置与重开输出不得复活旧特效');
    await addGift();
    assert.equal((await current()).runtime.game.round!.status, 'running');
    await remove();
    await wait(shown, '第二次完成重新播放');
    assert.notEqual((await current()).runtime.completionId, first);
    await addGift();
    await wait(hidden, '播放中收到加量礼物立即撤掉全部完成特效');
    assert.equal((await current()).runtime.game.round!.id, roundId);
    assert.equal((await current()).runtime.status, 'running');
    assert.equal((await current()).runtime.game.round!.remaining, '100');
    await command({ action: 'settings', id, values: { completionFireworks: false } });
    await remove();
    await wait(shown, '再次完成继续播放');
    assert.equal(
      await everyView(`!document.querySelector(${JSON.stringify(overlay + ' canvas')})`),
      true,
      '关闭烟火保留文字',
    );
    await command({ action: 'settings', id, values: { completionEnabled: false } });
    await wait(hidden, '关闭完成特效立即生效');
    await command({ action: 'settings', id, values: { completionEnabled: true } });
    assert.equal(await hidden(), true, '开关调整不得重播已取消特效');
    results.push({
      source,
      liveParametersOnLockedLayer: true,
      themeOnLockedPausedLayer: true,
      fireworks: true,
      expires: true,
      cancelsOnGift: true,
      repeatCompletion: true,
      noReplayOnReopen: true,
    });
  }
  await command({ action: 'sceneSwitch', id: original.document.id });
  await command({ action: 'sceneDelete', id: sceneId });
  return results;
}
