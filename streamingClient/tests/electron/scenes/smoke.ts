import { checkDragon } from './dragon-smoke';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dialog, type BrowserWindow, type WebFrameMain } from 'electron';
import { enterWorkspace } from '../entry-smoke';
import { checkTutorial } from '../tutorial-smoke';
import { checkLiveModes } from './modes-smoke';
import { checkSceneHotkeys } from './hotkeys-smoke';
import { checkVideoEditing } from './media-smoke';
import { checkOutputResolution } from './resolution-smoke';
import { checkMobilePreview } from './mobile-preview-smoke';
import { checkStatusPanel } from './status-smoke';
import { systemText, type SceneSnapshot } from '@zhuda/contracts';
export async function checkScenes(window: BrowserWindow, getOutput: () => BrowserWindow | null) {
  // This isolated profile injects its own input; desktop mouse movement must not alter gestures.
  window.setIgnoreMouseEvents(true);
  const evaluate = async (script: string) => {
    try {
      return await window.webContents.executeJavaScript(script);
    } catch (error) {
      throw new Error('场景验证脚本失败：' + script, { cause: error });
    }
  };
  const wait = async (test: () => Promise<unknown>, label: string) => {
    for (let i = 0; i < 160; i++) {
      if (await test()) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    await capture('scene-failure');
    console.log(
      'scene-failure',
      label,
      await evaluate(
        `({trace:window.__scenePointerTrace,toast:document.querySelector('.toast')?.textContent,selected:document.querySelector('.scene-hit-layer.selected')?.getBoundingClientRect().toJSON(),busy:document.querySelector('#scene-mode-preview')?.disabled})`,
      ),
    );
    for (const target of [window, getOutput()].filter((w): w is BrowserWindow => !!w)) {
      for (const frame of target.webContents.mainFrame.frames.filter((f) =>
        f.url.includes('/assets/instructions.html'),
      )) {
        console.log(
          '说明布局诊断',
          frame.url,
          JSON.stringify(
            await frame.executeJavaScript(`(() => {
          const root=document.querySelector('.instructions');const rows=Array.from(document.querySelectorAll('.instruction-row'));
          return {width:innerWidth,height:innerHeight,scrollHeight:root?.scrollHeight,transform:root?.style.transform,count:rows.length,
            rows:rows.map(row=>({gift:row.dataset.giftId,rect:row.getBoundingClientRect().toJSON()}))};
        })()`),
          ),
        );
      }
    }
    throw new Error(`场景实机验证逾时：${label}`);
  };
  const click = async (selector: string) => {
    await wait(
      () =>
        evaluate(
          `!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`,
        ),
      selector,
    );
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const command = (c: object) => evaluate(`window.studio.sceneCommand(${JSON.stringify(c)})`);
  const snapshot = (): Promise<SceneSnapshot> => evaluate('window.studio.sceneSnapshot()');
  const fill = (selector: string, value: string) =>
    evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const checkLanguage = async () => {
    const text = await evaluate('document.body.innerText');
    assert.equal(systemText(text), text, '系统界面应全部为简体中文');
    assert.equal(await evaluate('document.documentElement.lang'), 'zh-CN');
  };
  const capture = async (name: string, target = window) => {
    if (!process.env.LIVE_SMOKE_ARTIFACTS) return;
    await new Promise((r) => setTimeout(r, 120));
    mkdirSync(process.env.LIVE_SMOKE_ARTIFACTS, { recursive: true });
    writeFileSync(
      join(process.env.LIVE_SMOKE_ARTIFACTS, `${name}.png`),
      (await target.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    );
  };
  const entry = await enterWorkspace(window);
  await wait(() => evaluate('!!document.querySelector(".scene-editor")'), '场景首页');
  if (process.env.LIVE_SCENE_SMOKE_DRAGON_ONLY) {
    await wait(() => evaluate('!!document.querySelector(".guided-tour")'), '新手教学');
    await click('.tour-actions > .text-button');
    return checkDragon(window, getOutput);
  }
  if (process.env.LIVE_SCENE_SMOKE_MOBILE_ONLY) {
    await wait(() => evaluate('!!document.querySelector(".guided-tour")'), '新手教学');
    await click('.tour-actions > .text-button');
    return checkMobilePreview(window, getOutput);
  }
  if (process.env.LIVE_SCENE_SMOKE_RESOLUTION_ONLY) {
    await wait(() => evaluate('!!document.querySelector(".guided-tour")'), '新手教学');
    await click('.tour-actions > .text-button');
    return checkOutputResolution(window, getOutput);
  }
  if (process.env.LIVE_SCENE_SMOKE_HOTKEYS_ONLY) {
    await wait(() => evaluate('!!document.querySelector(".guided-tour")'), '新手教学');
    await click('.tour-actions > .text-button');
    return checkSceneHotkeys(window);
  }
  if (process.env.LIVE_SCENE_SMOKE_MODES_ONLY) {
    await wait(() => evaluate('!!document.querySelector(".guided-tour")'), '新手教学');
    await click('.tour-actions > .text-button');
    return checkLiveModes(window, getOutput);
  }
  if (process.env.LIVE_SCENE_SMOKE_PHASE === 'restart') {
    await wait(() => evaluate('!!document.querySelector(".guided-tour")'), '教学偏好');
    await click('.tour-actions > .text-button');
    const saved = await snapshot();
    assert.equal(saved.layers.length, 7);
    const chain = saved.layers.find((l) => l.layer.pluginId === 'plugin.chain')!;
    assert.equal(chain.runtime.status, 'paused');
    assert.equal(chain.runtime.game.round?.remaining, '26');
    assert.equal(chain.layer.theme, 'plush');
    const panel = saved.layers.find((v) => v.source?.kind === 'status')!;
    assert.equal(panel.layer.binding?.targetLayerId, chain.layer.id);
    assert.equal(panel.layer.width, 1080);
    assert.equal(panel.runtime.game.round?.remaining, '26');
    assert.equal(saved.document.width, 1920);
    assert.equal(
      saved.layers.find((l) => l.layer.sourceId === 'text')!.layer.settings.text,
      '场景集成验证',
    );
    assert.equal(saved.library.length, 2);
    assert.deepEqual(
      saved.layers.find((l) => l.layer.sourceId === 'instructions')!.layer.contentSize,
      { width: 900, height: 640 },
    );
    assert.equal(
      saved.layers.find((l) => l.layer.sourceId === 'instructions')!.instructions?.targetLayerId,
      chain.layer.id,
    );
    await command({ action: 'output', open: true });
    await wait(async () => !!getOutput()?.webContents.mainFrame.frames.length, '重开输出');
    const output = getOutput()!;
    await wait(async () => {
      const frame = output.webContents.mainFrame.frames.find((f) => f.name === chain.layer.id);
      return (
        !!frame &&
        (await frame.executeJavaScript(
          'document.querySelector("#remaining")?.textContent === "26"',
        ))
      );
    }, '重开后进度显示');
    await wait(
      async () =>
        output.webContents.mainFrame.frames
          .find((f) => f.name === panel.layer.id)
          ?.executeJavaScript(
            'document.querySelector("#remaining")?.textContent === "26" && document.querySelector("#mode")?.textContent === "已暂停"',
          ) ?? false,
      '独立状态面板重启恢复',
    );
    await capture('scene-restored');
    for (const kind of ['image', 'video']) {
      await wait(async () => {
        const frame = output.webContents.mainFrame.frames.find((frame) =>
          frame.url.includes(`/assets/${kind}.html`),
        );
        return (
          !!frame &&
          (await frame.executeJavaScript(
            kind === 'image'
              ? 'document.querySelector("img")?.naturalWidth === 320'
              : 'document.querySelector("video")?.readyState >= 2 && document.querySelector("video").paused',
          ))
        );
      }, `重启后恢复${kind}素材`);
    }
    await checkLanguage();
    await command({ action: 'output', open: false });
    return {
      restored: true,
      pausedOnRestart: true,
      remaining: 26,
      theme: 'plush',
      layers: saved.layers.length,
      restoredMedia: true,
      restoredWorkspace: true,
    };
  }
  const tutorial = await checkTutorial(window);
  await checkLanguage();
  await capture('workspace-entry-complete');
  await capture('workspace-ready');
  assert.deepEqual(
    await evaluate(`({
      sourceButtons: document.querySelectorAll('[data-tour="add-source"]').length,
      sourceInHeader: !!document.querySelector('.scene-layers > header [data-tour="add-source"]'),
      redundantControls: !!document.querySelector('.scene-toolbar [data-tour="add-source"],.scene-layers > footer,.scene-empty-state,.scene-canvas-footer'),
      canvasText: document.querySelector('.scene-fit').textContent.trim(),
      background: getComputedStyle(document.querySelector('.scene-stage')).backgroundColor,
      mode: document.querySelector('[role="tab"][aria-controls="scene-canvas-panel"][aria-selected="true"]').textContent,
    })`),
    {
      sourceButtons: 1,
      sourceInHeader: true,
      redundantControls: false,
      canvasText: '',
      background: 'rgb(0, 255, 0)',
      mode: '场景搭建',
    },
  );
  await capture('scene-empty-build');
  await click('#scene-mode-preview');
  await wait(
    () =>
      evaluate(
        'document.querySelector("#scene-mode-preview").getAttribute("aria-selected") === "true" && !document.querySelector(".scene-hit-stage")',
      ),
    '干净场景预览',
  );
  assert.equal(getOutput(), null, '场景预览只在工作台内显示，不自动打开窗口');
  assert.equal((await snapshot()).outputOpen, false);
  await capture('scene-empty-preview');
  for (let i = 0; i < 3; i++) {
    await click('#scene-mode-build');
    await wait(() => evaluate('!!document.querySelector(".scene-hit-stage")'), '返回搭建');
    assert.equal(getOutput(), null, '返回搭建没有残留预览窗口');
    await click('#scene-mode-preview');
    await wait(() => evaluate('!document.querySelector(".scene-hit-stage")'), '再次切到内嵌预览');
    assert.equal(getOutput(), null, '反复切换不得创建独立窗口');
  }
  await click('#scene-output-toggle');
  await wait(async () => !!getOutput() && (await snapshot()).outputOpen, '手动打开独立输出');
  await click('#scene-mode-build');
  await wait(
    () =>
      evaluate('document.querySelector("#scene-output-toggle")?.textContent === "关闭输出窗口"'),
    '搭建页保留关闭入口',
  );
  await click('#scene-output-toggle');
  await wait(async () => !getOutput() && !(await snapshot()).outputOpen, '关闭独立输出');
  await wait(
    () => evaluate('!document.querySelector("#scene-output-toggle")'),
    '搭建页收起输出控制',
  );
  await capture('scene-build-after-close');
  await click('#scene-mode-preview');
  assert.equal(getOutput(), null, '关闭后切到预览不得自动重开');
  await click('#scene-output-toggle');
  await wait(async () => !!getOutput(), '重新打开独立输出');
  const escapeOutput = getOutput()!;
  escapeOutput.show();
  escapeOutput.focus();
  escapeOutput.webContents.focus();
  await wait(async () => escapeOutput.isFocused(), '输出窗口焦点');
  escapeOutput.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await wait(async () => !getOutput() && !(await snapshot()).outputOpen, 'Esc 关闭输出');
  await wait(
    () =>
      evaluate('document.querySelector("#scene-output-toggle")?.textContent === "打开输出窗口"'),
    'Esc 关闭后控制状态同步',
  );
  await wait(
    () => evaluate('!document.querySelector("#scene-output-toggle").disabled'),
    '关闭后打开指令完成',
  );
  assert.equal(
    await evaluate('!!document.querySelector(".toast.error")'),
    false,
    '输出加载时按 Esc 关闭不得留下加载失败提示',
  );
  await click('#scene-mode-build');
  await click('[data-tour="add-source"]');
  await click('[data-source="plugin.chain:chain"]');
  await wait(async () => (await snapshot()).layers.length === 2, '加入锁链和独立状态面板');
  // Exercise existing canvas/list gestures without a covering status layer, then re-add it via UI.
  await command({
    action: 'remove',
    id: (await snapshot()).layers.find((v) => v.source?.kind === 'status')!.layer.id,
  });
  const id = (await snapshot()).layers[0]!.layer.id;
  await wait(
    () =>
      evaluate(
        '!!Array.from(document.querySelectorAll(".scene-control-buttons button")).find(b => b.textContent === "开始试玩")',
      ),
    '图层交互控制',
  );
  await evaluate(
    'Array.from(document.querySelectorAll(".scene-control-buttons button")).find(b => b.textContent === "开始试玩").click()',
  );
  await wait(async () => (await snapshot()).layers[0]!.runtime.status === 'running', '试玩启动');
  await command({ action: 'control', id, state: 'reset', mode: 'demo', initial: '24' });
  await evaluate('window.__sceneFrame = document.querySelector(".scene-render-layer iframe")');
  await click('#scene-mode-preview');
  await wait(
    () =>
      evaluate(
        'document.querySelector("#scene-mode-preview").getAttribute("aria-selected") === "true" && !document.querySelector(".scene-hit-stage")',
      ),
    '预览移除编辑框',
  );
  assert.equal(getOutput(), null, '有玩法图层时也不自动弹出窗口');
  await click('#scene-output-toggle');
  let preview: WebFrameMain | undefined, outputFrame: WebFrameMain | undefined;
  await wait(async () => {
    preview = window.webContents.mainFrame.frames.find((f) => f.name === id);
    outputFrame = getOutput()?.webContents.mainFrame.frames.find((f) => f.name === id);
    if (!preview || !outputFrame) return false;
    return (
      (await preview.executeJavaScript(
        'document.querySelector("#remaining")?.textContent === "24"',
      )) &&
      (await outputFrame.executeJavaScript(
        'document.querySelector("#remaining")?.textContent === "24"',
      ))
    );
  }, '预览与输出来源初始化');
  await capture('scene-preview');
  const activeOutput = getOutput();
  await click('#scene-mode-build');
  await wait(
    () => evaluate('!!document.querySelector(".scene-hit-layer.selected")'),
    '返回搭建保留选取图层',
  );
  assert.equal(
    await evaluate('window.__sceneFrame === document.querySelector(".scene-render-layer iframe")'),
    true,
    '切换模式不得重建来源',
  );
  assert.equal((await snapshot()).layers[0]!.runtime.game.round?.remaining, '24');
  assert.equal(getOutput(), activeOutput, '手动开启的直播输出不受编辑分页切换影响');
  const isolation = await preview!.executeJavaScript(
    `(() => { let blocked=false;try {void parent.document.body;}catch{blocked=true;}return {node:typeof require,studio:typeof window.studio,parentBlocked:blocked};})()`,
  );
  assert.deepEqual(isolation, { node: 'undefined', studio: 'undefined', parentBlocked: true });
  assert.deepEqual(
    await getOutput()!.webContents.executeJavaScript(
      '({studio:typeof window.studio,readOnly:!window.sceneOutput.command})',
    ),
    { studio: 'undefined', readOnly: true },
  );
  const requestId = '77777777-7777-4777-8777-777777777777';
  await command({ action: 'trigger', id, eventId: 'lock', amount: 3, requestId });
  await command({ action: 'trigger', id, eventId: 'lock', amount: 3, requestId });
  await wait(
    async () =>
      (await preview!.executeJavaScript(
        'document.querySelector("#remaining")?.textContent === "27"',
      )) &&
      (await outputFrame!.executeJavaScript(
        'document.querySelector("#remaining")?.textContent === "27"',
      )),
    '共同进度不重复计算',
  );
  await command({
    action: 'trigger',
    id,
    eventId: 'unlock',
    amount: 1,
    requestId: '88888888-8888-4888-8888-888888888888',
  });
  assert.equal((await snapshot()).layers[0]!.runtime.game.round?.remaining, '26');
  await capture('scene-portrait');
  for (const themeName of ['黑白粗链', '原版钢链']) {
    await evaluate(
      `Array.from(document.querySelectorAll('.scene-theme-options button')).find(b => b.textContent.includes(${JSON.stringify(themeName)})).click()`,
    );
    const themeId = themeName === '黑白粗链' ? 'monochrome' : 'classic';
    await wait(
      async () =>
        await outputFrame!.executeJavaScript(`document.body.dataset.theme === '${themeId}'`),
      `主题 ${themeId}`,
    );
    assert.equal((await snapshot()).layers[0]!.runtime.game.round?.remaining, '26');
  }
  let revision = (await snapshot()).document.revision;
  await command({ action: 'patch', id, revision, patch: { theme: 'plush' } });
  await wait(
    async () => await outputFrame!.executeJavaScript('document.body.dataset.theme === "plush"'),
    '粉色主题',
  );
  await capture('scene-output-portrait', getOutput()!);
  window.show();
  window.focus();
  window.webContents.focus();
  await evaluate(
    `window.__scenePointerTrace=[]; ['pointerdown','pointermove','pointerup'].forEach(type=>addEventListener(type,e=>{window.__scenePointerTrace.push({type,target:e.target.className,x:e.clientX,y:e.clientY});}));`,
  );
  // Real pointer input exercises the editor's drag and resize gesture path.
  const bounds = await evaluate(
    `(() => {const l=document.querySelector('.scene-hit-layer');const r=l.getBoundingClientRect();return {x:r.x+20,y:r.y+30};})()`,
  );
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
  });
  await new Promise((r) => setTimeout(r, 80));
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
  });
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: Math.round(bounds.x + 20),
    y: Math.round(bounds.y + 15),
    movementX: 20,
    movementY: 15,
  });
  await new Promise((r) => setTimeout(r, 50));
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: Math.round(bounds.x + 20),
    y: Math.round(bounds.y + 15),
  });
  await wait(async () => (await snapshot()).layers[0]!.layer.x > 0, '拖曳保存');
  const savedRevision = (await snapshot()).document.revision;
  await wait(
    () =>
      evaluate(`document.querySelector('.scene-editor').dataset.revision === '${savedRevision}'`),
    '拖曳后编辑器提交',
  );
  const handle = await evaluate(
    `(() => {const r=document.querySelector('.scene-resize-handle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  const oldWidth = (await snapshot()).layers[0]!.layer.width;
  await new Promise((r) => setTimeout(r, 80));
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    x: Math.round(handle.x),
    y: Math.round(handle.y),
  });
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: Math.round(handle.x - 15),
    y: Math.round(handle.y - 15),
    movementX: -15,
    movementY: -15,
  });
  await new Promise((r) => setTimeout(r, 50));
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: Math.round(handle.x - 15),
    y: Math.round(handle.y - 15),
  });
  await wait(async () => (await snapshot()).layers[0]!.layer.width < oldWidth, '拖曳缩放');
  // A locked full-frame layer must let real pointer input reach the layer underneath.
  await command({ action: 'duplicate', id });
  const blocker = (await snapshot()).layers.at(-1)!.layer.id;
  await command({
    action: 'patch',
    id: blocker,
    revision: (await snapshot()).document.revision,
    patch: { locked: true },
  });
  await wait(
    () =>
      evaluate(
        `document.querySelector('.scene-hit-layer[data-layer-id="${blocker}"]')?.classList.contains('locked')`,
      ),
    '锁定覆盖层',
  );
  const clickThrough = await evaluate(
    `(() => {const e=document.querySelector('.scene-hit-layer[data-layer-id="${id}"]'),r=e.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,hit:document.elementFromPoint(x,y)?.closest('.scene-hit-layer')?.dataset.layerId};})()`,
  );
  assert.equal(clickThrough.hit, id, '锁定层不参加画布命中');
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    x: Math.round(clickThrough.x),
    y: Math.round(clickThrough.y),
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: Math.round(clickThrough.x),
    y: Math.round(clickThrough.y),
  });
  await wait(
    () =>
      evaluate(`document.querySelector('.scene-hit-layer.selected')?.dataset.layerId==='${id}'`),
    '点击穿过锁定层选择底层',
  );
  await evaluate(`document.querySelectorAll('.scene-layer-row > button:first-child')[0].click()`);
  await wait(
    () =>
      evaluate(
        `document.querySelector('.scene-hit-layer.selected')?.dataset.layerId==='${blocker}'`,
      ),
    '左侧列表仍能选择锁定层',
  );
  assert.equal(
    await evaluate(`!!document.querySelector('.scene-hit-layer.selected .scene-resize-handle')`),
    false,
  );
  // Exercise list drag handlers and the host command together in this isolated profile.
  const dragLayer = async (placement: 'above' | 'below', cancel = false) => {
    const revision = (await snapshot()).document.revision;
    await wait(
      () => evaluate(`document.querySelector('.scene-editor').dataset.revision==='${revision}'`),
      '图层列表就绪',
    );
    const points = await evaluate(`(() => {
      const source=document.querySelector('.scene-layer-row[data-layer-id="${blocker}"] .scene-layer-select').getBoundingClientRect();
      const target=document.querySelector('.scene-layer-row[data-layer-id="${id}"]').getBoundingClientRect();
      return {from:{x:Math.round(source.left+25),y:Math.round(source.top+source.height/2)},to:{x:Math.round(target.left+25),y:Math.round(target.top+target.height*${placement === 'above' ? 0.25 : 0.75})}};
    })()`);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...points.from });
    await new Promise((r) => setTimeout(r, 80));
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      ...points.from,
    });
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      ...points.to,
      movementX: points.to.x - points.from.x,
      movementY: points.to.y - points.from.y,
    });
    await wait(
      () => evaluate(`!!document.querySelector('.scene-layer-row.drop-${placement}')`),
      '层级插入线',
    );
    if (cancel) {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    }
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      ...points.to,
    });
    await wait(
      () =>
        evaluate(
          `!document.querySelector('.scene-layer-row.dragging,.scene-layer-row.drop-above,.scene-layer-row.drop-below')`,
        ),
      '结束图层拖动',
    );
  };
  await dragLayer('below', true);
  assert.equal((await snapshot()).layers.at(-1)!.layer.id, blocker, '取消拖动不改变顺序');
  await dragLayer('below');
  await wait(async () => (await snapshot()).layers[0]!.layer.id === blocker, '向下拖动图层');
  await wait(
    async () =>
      (await getOutput()!.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.scene-render-layer')).sort((a,b)=>Number(a.style.zIndex)-Number(b.style.zIndex))[0]?.dataset.layerId`,
      )) === blocker,
    '拖动同步输出层级',
  );
  await dragLayer('above');
  await wait(async () => (await snapshot()).layers.at(-1)!.layer.id === blocker, '向上拖动图层');
  assert.equal(
    (await snapshot()).layers.find((v) => v.layer.id === id)!.runtime.game.round?.remaining,
    '26',
  );
  // Deleting an unselected row must target that row, without changing the selected layer.
  await click(`.scene-layer-row[data-layer-id="${id}"] .scene-layer-select`);
  await click(`.scene-layer-row[data-layer-id="${blocker}"] .scene-layer-remove`);
  await wait(() => evaluate(`!!document.querySelector('[role="alertdialog"]')`), '列表删除确认');
  assert.equal(
    await evaluate(`document.querySelector('#remove-layer-title').textContent`),
    `删除「${(await snapshot()).layers.find((v) => v.layer.id === blocker)!.layer.name}」？`,
  );
  await click('[role="alertdialog"] .button.secondary');
  assert.equal((await snapshot()).layers.length, 2, '取消删除保留图层');
  await command({
    action: 'patch',
    id: blocker,
    revision: (await snapshot()).document.revision,
    patch: { locked: false },
  });
  await click(`.scene-layer-row[data-layer-id="${blocker}"] .scene-layer-remove`);
  await click('[role="alertdialog"] .button:not(.secondary)');
  await wait(async () => (await snapshot()).layers.length === 1, '列表删除目标图层');
  assert.equal((await snapshot()).layers[0]!.layer.id, id);
  await evaluate(`document.querySelectorAll('.scene-layer-row > button:first-child')[0].click()`);
  revision = (await snapshot()).document.revision;
  await command({
    action: 'patch',
    id,
    revision,
    patch: { x: 0, y: 0, width: 1920, height: 1080 },
  });
  revision = (await snapshot()).document.revision;
  await command({
    action: 'configure',
    name: '集成验证场景',
    width: 1920,
    height: 1080,
    background: 'transparent',
    revision,
  });
  await command({ action: 'add', pluginId: 'plugin.scene-basics', sourceId: 'text' });
  let state = await snapshot();
  const textId = state.layers.at(-1)!.layer.id;
  await command({
    action: 'patch',
    id: textId,
    revision: state.document.revision,
    patch: {
      x: 420,
      y: 800,
      settings: {
        text: '场景集成验证',
        color: '#d8f68b',
        fontSize: 64,
        bold: true,
        align: 'center',
      },
    },
  });
  await command({ action: 'duplicate', id });
  state = await snapshot();
  const copy = state.layers.find((l) => l.layer.id !== id && l.layer.sourceId === 'chain')!;
  assert.equal(copy.runtime.status, 'idle');
  await command({
    action: 'patch',
    id: copy.layer.id,
    revision: state.document.revision,
    patch: { visible: false },
  });
  assert.equal(
    (await snapshot()).layers.find((l) => l.layer.id === id)!.runtime.game.round?.remaining,
    '26',
  );
  assert.equal(
    await getOutput()!.webContents.executeJavaScript(
      'getComputedStyle(document.documentElement).backgroundColor',
    ),
    'rgba(0, 0, 0, 0)',
  );
  await capture('scene-landscape');
  await capture('scene-output-landscape', getOutput()!);
  const originalDialog = dialog.showOpenDialog;
  let videoEditing;
  try {
    for (const kind of ['image', 'video']) {
      await click('[data-tour="add-source"]');
      await click(`[data-source="plugin.scene-basics:${kind}"]`);
      await wait(
        async () => (await snapshot()).layers.at(-1)?.layer.sourceId === kind,
        `添加${kind}来源`,
      );
      const mediaId = (await snapshot()).layers.at(-1)!.layer.id;
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [
          join(
            process.env.LIVE_SCENE_SMOKE_MEDIA_DIR!,
            kind === 'image' ? 'test.png' : 'test.webm',
          ),
        ],
      })) as typeof dialog.showOpenDialog;
      await click('.scene-media-field button');
      await wait(
        async () => !!(await snapshot()).layers.at(-1)!.layer.settings.file,
        `导入${kind}素材`,
      );
      assert.match(
        String((await snapshot()).layers.at(-1)!.layer.settings.file),
        /^zhuda-scene:\/\/media\/[a-f0-9]{64}\./,
      );
      await wait(async () => {
        const frame = getOutput()!.webContents.mainFrame.frames.find((f) =>
          f.url.includes(`/assets/${kind}.html`),
        );
        return (
          !!frame &&
          (await frame.executeJavaScript(
            kind === 'image'
              ? 'document.querySelector("img")?.naturalWidth === 320'
              : 'document.querySelector("video")?.readyState >= 2',
          ))
        );
      }, `加载${kind}素材`);
      let mediaState = await snapshot();
      await command({
        action: 'patch',
        id: mediaId,
        revision: mediaState.document.revision,
        patch: {
          x: kind === 'image' ? 140 : 1240,
          y: 180,
          width: 480,
          height: 300,
          settings: { ...mediaState.layers.at(-1)!.layer.settings, fit: 'cover' },
        },
      });
      await wait(async () => {
        const frame = getOutput()!.webContents.mainFrame.frames.find((frame) =>
          frame.url.includes(`/assets/${kind}.html`),
        );
        return (
          !!frame &&
          (await frame.executeJavaScript(
            `getComputedStyle(document.querySelector('${kind === 'image' ? 'img' : 'video'}')).objectFit === 'cover'`,
          ))
        );
      }, `${kind}填充模式`);
      await capture(`scene-${kind}-source`);
      await capture(`scene-${kind}-output`, getOutput()!);
      if (kind === 'video') {
        await evaluate(
          'Array.from(document.querySelectorAll(".scene-control-buttons button")).find(button => button.textContent === "播放").click()',
        );
        await wait(
          async () => (await snapshot()).layers.at(-1)!.runtime.status === 'running',
          '视频播放按钮',
        );
        videoEditing = await checkVideoEditing(window, getOutput()!, mediaId, textId);
        await command({ action: 'output', open: false });
        await command({ action: 'output', open: true });
        let videoFrame: WebFrameMain | undefined;
        await wait(async () => {
          videoFrame = getOutput()!.webContents.mainFrame.frames.find((f) =>
            f.url.includes('/assets/video.html'),
          );
          return (
            !!videoFrame &&
            (await videoFrame.executeJavaScript(
              '!!document.querySelector("video") && !document.querySelector("video").paused && document.querySelector("video").currentTime > .15',
            ))
          );
        }, '重开输出沿用播放时间');
        await command({ action: 'control', id: mediaId, state: 'pause' });
        await wait(
          async () => await videoFrame!.executeJavaScript('document.querySelector("video").paused'),
          '视频暂停',
        );
      }
    }
  } finally {
    dialog.showOpenDialog = originalDialog;
  }

  // Add an independent instruction source through the gameplay inspector.
  const gameplayName = (await snapshot()).layers.find((l) => l.layer.id === id)!.layer.name;
  await evaluate(
    `Array.from(document.querySelectorAll('.scene-layer-select')).find(b => b.querySelector('b').textContent === ${JSON.stringify(gameplayName)}).click()`,
  );
  await wait(
    () =>
      evaluate(
        `!!Array.from(document.querySelectorAll('.scene-inspector button')).find(b => b.textContent === '添加玩法说明')`,
      ),
    '玩法说明入口',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.scene-inspector button')).find(b => b.textContent === '添加玩法说明').click()`,
  );
  await wait(async () => (await snapshot()).layers.length === 6, '添加说明图层');
  const guideId = (await snapshot()).layers.at(-1)!.layer.id;
  await command({
    action: 'patch',
    id: guideId,
    revision: (await snapshot()).document.revision,
    patch: { x: 100, y: 700, width: 1100, height: 300 },
  });
  const guideFrame = (target: BrowserWindow) =>
    target.webContents.mainFrame.frames.find((f) => f.url.includes('/assets/instructions.html'));
  await wait(async () => {
    const editor = guideFrame(window),
      output = guideFrame(getOutput()!);
    return (
      editor &&
      output &&
      (await editor.executeJavaScript(
        'document.querySelectorAll(".instruction-row").length > 0',
      )) &&
      (await output.executeJavaScript('document.querySelectorAll(".instruction-row").length > 0'))
    );
  }, '搭建与输出展示礼物说明');
  const originalRules = (await snapshot()).layers.find((l) => l.layer.id === id)!.layer.rules;
  await command({
    action: 'patch',
    id,
    revision: (await snapshot()).document.revision,
    patch: {
      rules: [{ giftId: '2001', giftName: '玫瑰', eventId: 'unlock', amount: 37, delta: -37 }],
    },
  });
  await wait(
    async () =>
      await guideFrame(getOutput()!)!.executeJavaScript(
        'document.body.innerText.includes("37根") && document.querySelectorAll(".instruction-row").length === 1',
      ),
    '修改映射立即更新说明',
  );
  await capture('scene-gift-instructions');
  await capture('scene-gift-instructions-output', getOutput()!);
  await command({
    action: 'patch',
    id,
    revision: (await snapshot()).document.revision,
    patch: { rules: originalRules },
  });

  // Scaling must keep every configured gift visible and preserve the iframe's layout viewport.
  const allInstructionsVisible = `(() => {
    const rows = Array.from(document.querySelectorAll('.instruction-row'));
    return rows.length === ${originalRules.length} && rows.every(row => {
      const r = row.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    });
  })()`;
  await wait(
    async () =>
      (await guideFrame(window)!.executeJavaScript(allInstructionsVisible)) &&
      (await guideFrame(getOutput()!)!.executeJavaScript(allInstructionsVisible)),
    '完整礼物列表适配',
  );
  await wait(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll(".scene-field")).some(l => l.textContent === "缩放 %" && !l.querySelector("input").disabled)',
      ),
    '缩放输入',
  );
  // Reopening the video output earlier transfers native focus away from the editor.
  // A real edit needs an enabled, focused field so React receives its blur commit.
  window.show();
  window.focus();
  window.webContents.focus();
  await wait(async () => window.isFocused(), '缩放编辑焦点');
  await evaluate(`(() => {
    const input = Array.from(document.querySelectorAll('.scene-field')).find(l => l.textContent === '缩放 %').querySelector('input');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '50');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => resolve()))');
  await evaluate(
    `Array.from(document.querySelectorAll('.scene-field')).find(l => l.textContent === '缩放 %').querySelector('input').blur()`,
  );
  await wait(
    async () => (await snapshot()).layers.find((l) => l.layer.id === guideId)!.layer.width === 450,
    '缩放百分比保存',
  );
  const scaledHeight = (await snapshot()).layers.find((l) => l.layer.id === guideId)!.layer.height;
  assert.equal(scaledHeight, 320);
  for (const target of [window, getOutput()!]) {
    const viewport = await guideFrame(target)!.executeJavaScript(
      '({ width: innerWidth, height: innerHeight })',
    );
    assert.deepEqual(viewport, { width: 900, height: 640 }, '缩放不改变来源布局尺寸');
    assert.equal(
      await guideFrame(target)!.executeJavaScript(allInstructionsVisible),
      true,
      '缩小后全部礼物可见',
    );
    const transform = await target.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector('[data-layer-id="${guideId}"] iframe')).transform`,
    );
    assert.equal(transform, 'matrix(0.5, 0, 0, 0.5, 0, 0)');
  }
  await capture('scene-instructions-scaled');
  await capture('scene-instructions-scaled-output', getOutput()!);
  const statusPanel = await checkStatusPanel(window, getOutput()!, id);

  // Exercise the scene library UI, with copied media and remapped instance bindings.
  const originalScene = (await snapshot()).document.id;
  const originalImage = (await snapshot()).layers.find((l) => l.layer.sourceId === 'image')!.layer
    .settings.file;
  await click('.scene-library-trigger');
  await wait(() => evaluate('!!document.querySelector(".scene-library-dialog")'), '场景库');
  await capture('scene-library');
  await evaluate(
    `Array.from(document.querySelectorAll('.scene-library-actions button')).find(b => b.textContent === '当前场景另存为').click()`,
  );
  await fill('[aria-label="场景库名称"]', '晚间主播');
  await click('.scene-library-form button[type="submit"]');
  await wait(async () => (await snapshot()).document.id !== originalScene, '另存为并切换');
  assert.equal(getOutput(), null, '切换场景关闭旧输出');
  const savedCopy = await snapshot();
  const copyScene = savedCopy.document.id;
  assert.equal(savedCopy.layers.length, 7);
  assert.ok(savedCopy.layers.every((l) => l.runtime.status === 'idle'));
  assert.equal(
    savedCopy.layers.find((l) => l.layer.sourceId === 'instructions')!.layer.binding?.targetLayerId,
    savedCopy.layers[0]!.layer.id,
  );
  assert.equal(
    savedCopy.layers.find((l) => l.layer.sourceId === 'image')!.layer.settings.file,
    originalImage,
  );
  await click('.scene-library-trigger');
  await evaluate(
    `Array.from(document.querySelectorAll('.scene-library-select')).find(b => b.querySelector('strong').textContent === '集成验证场景').click()`,
  );
  await wait(async () => (await snapshot()).document.id === originalScene, '场景库列表切换');
  // Make a separate blank scene, rename it, then remove it through the library.
  await click('.scene-library-trigger');
  await evaluate(
    `Array.from(document.querySelectorAll('.scene-library-actions button')).find(b => b.textContent === '新建场景').click()`,
  );
  await fill('[aria-label="场景库名称"]', '临时直播场景');
  await click('.scene-library-form button[type="submit"]');
  await wait(async () => (await snapshot()).layers.length === 0, '新建空白场景');
  const blankScene = (await snapshot()).document.id;
  await click('.scene-library-trigger');
  await click('[aria-label="重命名临时直播场景"]');
  await fill('[aria-label="场景库名称"]', '临时改名');
  await click('.scene-library-form button[type="submit"]');
  await wait(async () => (await snapshot()).document.name === '临时改名', '重命名场景');
  await click('[aria-label="关闭场景库"]');
  await command({ action: 'sceneSwitch', id: originalScene });
  await click('.scene-library-trigger');
  await click('[aria-label="删除临时改名"]');
  await click('.scene-library-form button[type="submit"]');
  await wait(
    async () => !(await snapshot()).library.some((s) => s.id === blankScene),
    '删除指定场景',
  );
  await click('[aria-label="关闭场景库"]');
  assert.equal((await snapshot()).library.length, 2);
  assert.ok((await snapshot()).library.some((s) => s.id === copyScene));
  assert.equal((await snapshot()).layers[0]!.runtime.status, 'stopped');
  // The original configuration remains intact; starting again is an explicit host action.
  await command({ action: 'control', id, state: 'start', mode: 'demo', initial: '26' });
  await command({ action: 'output', open: true });
  await wait(async () => !!getOutput(), '恢复原场景输出');

  await click('#tab-live');
  await checkLanguage();
  assert.equal(await evaluate('!!document.querySelector("#observation-details")'), true);
  await capture('scene-observations');
  await checkLanguage();
  window.setContentSize(1020, 720);
  await new Promise((r) => setTimeout(r, 100));
  const layout = await evaluate(
    `(() => {const r=document.querySelector('.scene-workbench').getBoundingClientRect();const close=document.querySelector('#scene-output-toggle').getBoundingClientRect();return {noOverflow:document.documentElement.scrollWidth===innerWidth,right:r.right,viewport:innerWidth,canvasWidth:document.querySelector('.scene-viewport').clientWidth,outputControlVisible:close.width>0&&close.left>=0&&close.right<=innerWidth};})()`,
  );
  assert.equal(layout.noOverflow, true);
  assert.ok(layout.right <= layout.viewport);
  assert.ok(layout.canvasWidth >= 160);
  assert.equal(layout.outputControlVisible, true);
  await capture('scene-narrow');
  await click('#scene-output-toggle');
  await wait(async () => !getOutput() && !(await snapshot()).outputOpen, '搭建中关闭媒体输出');
  assert.equal((await snapshot()).layers.length, 7);
  assert.equal((await snapshot()).layers[0]!.runtime.game.round?.remaining, '26');
  console.log('场景验收：编辑、素材与场景库已通过，开始玩法和完成特效验收');
  const liveModes = await checkLiveModes(window, getOutput);
  return {
    statusPanel,
    liveModes,
    tutorial,
    isolation,
    previewOutputShared: true,
    cleanWorkspace: true,
    buildPreviewTabs: true,
    previewDoesNotOpenWindow: true,
    outputCloseButton: true,
    outputEscapeClose: true,
    stableSourcesAcrossModes: true,
    idempotency: true,
    drag: true,
    layerListReorder: true,
    layerListRemove: true,
    lockedLayersPassThrough: true,
    resize: true,
    themes: true,
    portraitLandscape: true,
    independentInstances: true,
    importedImageVideo: true,
    mediaPickerUi: true,
    mediaFit: true,
    directLaunch: entry.directLaunch,
    simplifiedChinese: true,
    videoTimeline: true,
    videoEditing,
    sceneLibrary: true,
    instanceInstructions: true,
    instructionMappingUpdates: true,
    scaledInstructionsVisible: true,
    copiedMediaAndBindings: true,
    pureObservations: true,
    layout,
  };
}
