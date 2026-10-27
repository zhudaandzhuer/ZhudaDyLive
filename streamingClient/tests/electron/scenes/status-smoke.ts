import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { SceneSnapshot } from '@zhuda/contracts';

export async function checkStatusPanel(
  editor: BrowserWindow,
  output: BrowserWindow,
  chain: string,
) {
  const evaluate = (code: string) => editor.webContents.executeJavaScript(code);
  const snapshot = (): Promise<SceneSnapshot> => evaluate('window.studio.sceneSnapshot()');
  const command = (input: object) =>
    evaluate(`window.studio.sceneCommand(${JSON.stringify(input)})`);
  const wait = async (test: () => Promise<unknown>, label: string) => {
    for (let i = 0; i < 160; i++) {
      if (await test()) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`状态面板验收超时：${label}`);
  };
  await evaluate(
    `document.querySelector('.scene-layer-select[data-layer-id="${chain}"]')?.click()`,
  );
  // Use the inspector entry, just as a user would after removing the default panel.
  await evaluate(
    `Array.from(document.querySelectorAll('.scene-layer-select')).find(b => b.closest('[data-layer-id]')?.dataset.layerId === '${chain}')?.click()`,
  );
  await wait(
    () =>
      evaluate(
        `!!Array.from(document.querySelectorAll('.scene-inspector button')).find(b=>b.textContent.trim()==='添加状态面板' && !b.disabled)`,
      ),
    '添加入口',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.scene-inspector button')).find(b=>b.textContent.trim()==='添加状态面板').click()`,
  );
  await wait(
    async () => (await snapshot()).layers.some((v) => v.source?.kind === 'status'),
    '独立图层',
  );
  const panel = (await snapshot()).layers.find((v) => v.source?.kind === 'status')!;
  const id = panel.layer.id;
  const frame = (window: BrowserWindow) =>
    window.webContents.mainFrame.frames.find((f) => f.name === id);
  const before = (await snapshot()).layers.find((v) => v.layer.id === chain)!;
  for (const target of [editor, output]) {
    await wait(
      async () =>
        frame(target)?.executeJavaScript(
          `document.querySelector('#remaining')?.textContent === '${before.runtime.game.round!.remaining}'`,
        ) ?? false,
      '实时数量',
    );
    assert.equal(
      await frame(target)!.executeJavaScript(`document.querySelectorAll('audio,canvas').length`),
      0,
      '面板不重复播放特效或音效',
    );
    const game = target.webContents.mainFrame.frames.find((f) => f.name === chain)!;
    assert.equal(
      await game.executeJavaScript(
        `getComputedStyle(document.querySelector('.chain-hud')).display`,
      ),
      'none',
      '锁链来源没有重复面板',
    );
  }
  editor.show();
  editor.focus();
  editor.webContents.focus();
  await wait(
    () =>
      evaluate(`document.querySelector('.scene-hit-layer.selected')?.dataset.layerId === '${id}'`),
    '选中面板',
  );
  await evaluate(`(() => {
    const input=Array.from(document.querySelectorAll('.scene-field')).find(l=>l.textContent==='缩放 %').querySelector('input');
    input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'150');input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await evaluate('new Promise(r=>requestAnimationFrame(r))');
  await evaluate(
    `Array.from(document.querySelectorAll('.scene-field')).find(l=>l.textContent==='缩放 %').querySelector('input').blur()`,
  );
  await wait(
    async () => (await snapshot()).layers.find((v) => v.layer.id === id)!.layer.width === 1080,
    '独立放大',
  );
  await command({
    action: 'patch',
    id,
    revision: (await snapshot()).document.revision,
    patch: { x: 760, y: 700 },
  });
  assert.deepEqual(
    (await snapshot()).layers.find((v) => v.layer.id === chain)!.layer,
    before.layer,
    '面板布局不改变锁链',
  );
  for (const target of [editor, output]) {
    assert.deepEqual(
      await frame(target)!.executeJavaScript('({width:innerWidth,height:innerHeight})'),
      { width: 720, height: 240 },
    );
    await wait(
      async () =>
        target.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('[data-layer-id="${id}"] iframe')).transform==='matrix(1.5, 0, 0, 1.5, 0, 0)'`,
        ),
      '整体缩放',
    );
  }
  const action = (eventId: string, amount: number) =>
    command({ action: 'trigger', id: chain, eventId, amount, requestId: randomUUID() });
  await action('lock', 10);
  await wait(
    async () =>
      frame(output)?.executeJavaScript(
        `document.querySelector('#remaining').textContent === '${BigInt(before.runtime.game.round!.remaining) + 10n}'`,
      ) ?? false,
    '增加同步',
  );
  await action('unlock', 10);
  await command({ action: 'control', id: chain, state: 'pause' });
  await wait(
    async () =>
      frame(output)?.executeJavaScript(`document.querySelector('#mode').textContent==='已暂停'`) ??
      false,
    '暂停同步',
  );
  await command({ action: 'control', id: chain, state: 'resume' });
  await command({
    action: 'patch',
    id,
    revision: (await snapshot()).document.revision,
    patch: { visible: false },
  });
  assert.equal(
    (await snapshot()).layers.find((v) => v.layer.id === chain)!.runtime.status,
    'running',
  );
  await command({
    action: 'patch',
    id,
    revision: (await snapshot()).document.revision,
    patch: { visible: true },
  });
  if (process.env.LIVE_SMOKE_ARTIFACTS) {
    mkdirSync(process.env.LIVE_SMOKE_ARTIFACTS, { recursive: true });
    writeFileSync(
      join(process.env.LIVE_SMOKE_ARTIFACTS, 'scene-status-panel.png'),
      (await editor.webContents.capturePage()).toPNG(),
    );
  }
  return {
    independentScale: true,
    boundCount: true,
    pauseFollows: true,
    noDuplicateAudio: true,
    hiddenDoesNotStopGame: true,
  };
}
