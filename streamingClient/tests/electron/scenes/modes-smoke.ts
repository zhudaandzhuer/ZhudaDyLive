import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { SceneSnapshot } from '@zhuda/contracts';
import { checkCompletionEffects } from './completion-smoke';

export async function checkLiveModes(window: BrowserWindow, getOutput: () => BrowserWindow | null) {
  const bounded = async <T>(task: Promise<T>, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`玩法验收请求未响应：${label}`)), 8000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const evaluate = (s: string) => bounded(window.webContents.executeJavaScript(s), s);
  const command = (c: object) => evaluate(`window.studio.sceneCommand(${JSON.stringify(c)})`);
  const snapshot = (): Promise<SceneSnapshot> => evaluate('window.studio.sceneSnapshot()');
  const choose = (selector: string, value: string) =>
    evaluate(`(() => {
      const input=document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));
    })()`);
  const control = (label: string) =>
    evaluate(
      `Array.from(document.querySelectorAll('.scene-control-buttons button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const testButton = (label: string) =>
    evaluate(
      `Array.from(document.querySelectorAll('.scene-simulation button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const wait = async (test: () => Promise<unknown>, label: string) => {
    for (let i = 0; i < 160; i++) {
      if (await bounded(test(), label)) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`玩法验收超时：${label}`);
  };
  const capture = async (name: string) => {
    if (!process.env.LIVE_SMOKE_ARTIFACTS || !getOutput()) return;
    // State reaches DOM before Chromium submits the resized native surface.
    await new Promise((r) => setTimeout(r, 250));
    mkdirSync(process.env.LIVE_SMOKE_ARTIFACTS, { recursive: true });
    writeFileSync(
      join(process.env.LIVE_SMOKE_ARTIFACTS, `${name}.png`),
      (await getOutput()!.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    );
  };
  const frame = (target: BrowserWindow, source: string) =>
    target.webContents.mainFrame.frames.find((f) => f.url.includes(`/assets/${source}.html`));
  const checkSewingSound = async (cue: string) => {
    await wait(
      async () =>
        frame(getOutput()!, 'sewing')?.executeJavaScript(
          `Array.from(document.querySelectorAll('audio')).some(a=>a.dataset.sewingSound===${JSON.stringify(cue)} && a.currentTime>.01 && !a.paused && !a.error && !a.dataset.playbackError)`,
        ),
      `缝纫机 ${cue} 音效解码播放`,
    );
    assert.equal(
      await frame(window, 'sewing')!.executeJavaScript(`document.querySelectorAll('audio').length`),
      0,
      '输出打开时编辑器不重复发声',
    );
  };
  const original = await snapshot();
  await command({ action: 'sceneCreate', name: '玩法验收场景' });
  const testScene = (await snapshot()).document.id;
  await command({
    action: 'configure',
    name: '玩法验收场景',
    width: 1920,
    height: 1080,
    background: 'transparent',
    revision: (await snapshot()).document.revision,
  });
  await command({ action: 'add', pluginId: 'plugin.scene-basics', sourceId: 'text' });
  const textId = (await snapshot()).layers.at(-1)!.layer.id;
  await command({ action: 'output', open: true });
  await wait(
    async () => !!frame(window, 'text') && !!getOutput() && !!frame(getOutput()!, 'text'),
    '文字来源加载',
  );
  await wait(
    () =>
      evaluate(
        `!!Array.from(document.querySelectorAll('.scene-field')).find(l=>l.querySelector('span')?.textContent==='文字颜色')`,
      ),
    '取色器',
  );
  await evaluate(`(() => {
    const input=Array.from(document.querySelectorAll('.scene-field')).find(l=>l.querySelector('span')?.textContent==='文字颜色').querySelector('input');
    input.focus();
    for(const color of ['#a01020','#2193ff','#26e6a4']) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,color);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }
  })()`);
  await wait(
    async () => (await snapshot()).layers[0]!.layer.settings.color === '#26e6a4',
    '连续取色即时保存',
  );
  assert.equal(await evaluate(`document.activeElement.type`), 'color', '取色器不需要失焦');
  for (const target of [window, getOutput()!])
    await wait(
      async () =>
        await frame(target, 'text')!.executeJavaScript(
          `getComputedStyle(document.querySelector('#source>div')).color==='rgb(38, 230, 164)'`,
        ),
      '文字颜色立即同步',
    );
  await command({
    action: 'patch',
    id: textId,
    revision: (await snapshot()).document.revision,
    patch: { visible: false },
  });
  // Install catalog and contribution entry points are part of the desktop UI.
  await evaluate(`document.querySelector('#tab-plugins').click()`);
  await wait(
    () =>
      evaluate(
        `!!document.querySelector('[data-plugin-id="plugin.sewing"]') && !!document.querySelector('[data-plugin-id="plugin.tasks"]')`,
      ),
    '新插件区卡片',
  );
  assert.equal(
    await evaluate(`!!document.querySelector('[data-plugin-id="plugin.prank"]')`),
    false,
  );
  await wait(
    () => evaluate(`!!document.querySelector('[data-tour="add-source"]')`),
    '返回场景搭建',
  );
  await evaluate(`document.querySelector('[data-tour="add-source"]').click()`);
  await wait(
    () => evaluate(`!!document.querySelector('[data-source="plugin.sewing:sewing"]')`),
    '缝纫机来源',
  );
  assert.deepEqual(
    await evaluate(
      `Array.from(document.querySelectorAll('.source-group h3')).map(h=>h.firstChild.textContent)`,
    ),
    ['基础场景', '插件'],
    '基础场景与插件在同一滚动列表中分组显示',
  );
  assert.equal(
    await evaluate(`(() => {
      const list=document.querySelector('.source-picker-content');
      return getComputedStyle(list).overflowY==='auto' && document.querySelectorAll('[data-source-group="basics"] .source-option').length===4 &&
        ['plugin.chain:chain','plugin.sewing:sewing','plugin.tasks:task-gifts','plugin.tasks:task-likes','plugin.tasks:task-follows','plugin.tasks:task-score'].every(id=>document.querySelector('[data-source="'+id+'"] [data-source-icon="game"]')) &&
        !document.querySelector('[data-source="plugin.tasks:tasks"]') &&
        !document.querySelector('.source-picker [role="tab"]');
    })()`),
    true,
    '来源按组滚动，所有玩法使用同一游戏图标',
  );
  await evaluate(`document.querySelector('[data-source="plugin.sewing:sewing"]').click()`);
  await wait(
    async () => (await snapshot()).layers.at(-1)?.layer.sourceId === 'sewing',
    '插入缝纫机',
  );
  const sewingId = (await snapshot()).layers.at(-1)!.layer.id;
  await wait(
    () => evaluate(`!!document.querySelector('[data-scene-test="${sewingId}"]')`),
    '未启动时也显示通用试玩面板',
  );
  assert.equal(await evaluate(`document.querySelector('[aria-label="试送礼物"]').disabled`), true);
  await control('开始试玩');
  await wait(
    () => evaluate(`document.querySelector('[aria-label="试送礼物"]')?.disabled===false`),
    '开始试玩后启用试送面板',
  );
  await choose('[aria-label="礼物数量"]', '0');
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('.scene-simulation button')).find(b=>b.textContent==='试送').disabled`,
    ),
    true,
    '无效礼物数量不可发送',
  );
  await choose('[aria-label="试送礼物"]', '2001');
  await choose('[aria-label="礼物数量"]', '3');
  await testButton('试送');
  await wait(
    async () => (await snapshot()).layers.at(-1)!.runtime.game.round?.remaining === '3300',
    '通过面板试送玫瑰追加订单',
  );
  await wait(
    () => evaluate(`document.querySelector('.scene-test-result').textContent==='已试送 玫瑰 × 3'`),
    '试送反馈',
  );
  await choose('[aria-label="试送礼物"]', '1');
  await choose('[aria-label="礼物数量"]', '2');
  await testButton('试送');
  await wait(
    async () => (await snapshot()).layers.at(-1)!.runtime.game.round?.remaining === '3280',
    '通过面板试送抖音加速缝制',
  );
  await choose('[aria-label="预览动作"]', 'stitch-remove');
  await choose('[aria-label="动作数量"]', '280');
  await wait(
    () =>
      evaluate(
        `Array.from(document.querySelectorAll('.scene-simulation button')).find(b=>b.textContent==='预览').disabled===false`,
      ),
    '动作参数可测试',
  );
  await testButton('预览');
  await wait(
    async () => (await snapshot()).layers.at(-1)!.runtime.game.round?.remaining === '3000',
    '通过面板直接预览插件动作',
  );
  await choose('[aria-label="试送礼物"]', '2001');
  await control('暂停');
  await wait(
    () =>
      evaluate(
        `document.querySelector('[aria-label="试送礼物"]').disabled && document.querySelector('.scene-test-hint').textContent.includes('继续试玩')`,
      ),
    '暂停时面板常驻并明确提示',
  );
  const originalRules = (await snapshot()).layers.at(-1)!.layer.rules;
  await command({
    action: 'patch',
    id: sewingId,
    revision: (await snapshot()).document.revision,
    patch: { rules: originalRules.slice(0, 1) },
  });
  await wait(
    () => evaluate(`document.querySelector('[aria-label="试送礼物"]').value==='1'`),
    '删除已选映射后自动选择有效礼物',
  );
  await command({
    action: 'patch',
    id: sewingId,
    revision: (await snapshot()).document.revision,
    patch: { rules: [] },
  });
  await control('继续试玩');
  await wait(
    () =>
      evaluate(
        `!document.querySelector('[aria-label="试送礼物"]') && document.querySelector('.scene-simulation').textContent.includes('添加映射') && Array.from(document.querySelectorAll('.scene-simulation button')).find(b=>b.textContent==='预览').disabled===false`,
      ),
    '未映射礼物时仍可直接预览动作',
  );
  await command({
    action: 'patch',
    id: sewingId,
    revision: (await snapshot()).document.revision,
    patch: { rules: originalRules },
  });
  await wait(
    async () =>
      !!frame(getOutput()!, 'sewing') &&
      (await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `document.querySelector('#stitch-count')?.textContent==='3,000'`,
      )),
    '缝纫机输出',
  );
  const checkSewingLayout = async (width: number, height: number) => {
    for (const target of [window, getOutput()!])
      await wait(
        async () =>
          await frame(target, 'sewing')!.executeJavaScript(`(() => {
            const machine=document.querySelector('.machine'), card=document.querySelector('.timer-card');
            if (!machine || !card) return false;
            const r=machine.getBoundingClientRect();
            const timer=card.getBoundingClientRect();
            // Fractional Windows display scaling can round an iframe viewport by one pixel.
            return Math.abs(innerWidth-${width})<=1 && Math.abs(innerHeight-${height})<=1 && r.width>0 &&
              r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1 &&
              timer.left>=0 && timer.right<=innerWidth+1 && timer.bottom<=innerHeight;
          })()`),
        '缝纫机与倒计时在画布内完整显示',
      );
  };
  await checkSewingLayout(1920, 1080);
  let lightCoverage = 0;
  let lightPileTop = 1;
  for (const count of ['1', '30', '4200']) {
    await command({
      action: 'control',
      id: sewingId,
      state: 'reset',
      mode: 'demo',
      initial: count,
    });
    for (const target of [window, getOutput()!])
      await wait(
        async () =>
          await frame(target, 'sewing')!.executeJavaScript(
            `document.querySelector('.cloth-field')?.dataset.renderedCount==='${count}' && document.querySelector('#stitch-count').textContent==='${Number(count).toLocaleString('zh-CN')}'`,
          ),
        '每点实际绘制一块布：' + count,
      );
    const pile = (await frame(getOutput()!, 'sewing')!.executeJavaScript(`(() => {
      const c=document.querySelector('.cloth-field'),ctx=c.getContext('2d');
      const {data,width,height}=ctx.getImageData(0,0,c.width,c.height);let hit=0,total=0,center=0,top=height;
      for(let y=0;y<height;y+=12)for(let x=0;x<width;x+=12){total++;if(data[(y*width+x)*4+3]>30){hit++;top=Math.min(top,y);if(x>width*.43&&x<width*.57)center++;}}
      return {coverage:hit/total,top:top/height,center};
    })()`)) as { coverage: number; top: number; center: number };
    assert.equal(pile.center, 0, '待缝布料留在机器两侧，不散落画面中央');
    if (count === '30') {
      lightCoverage = pile.coverage;
      lightPileTop = pile.top;
    }
    if (count === '4200') {
      assert.ok(pile.coverage > lightCoverage * 2, '4200 块形成更大的实体布堆');
      assert.ok(pile.top < lightPileTop - 0.3, '布料数量增多，布堆明显向上堆高');
    }
    await capture('cloth-exact-' + count);
  }
  await command({ action: 'control', id: sewingId, state: 'reset', mode: 'demo', initial: '1' });
  await command({
    action: 'trigger',
    id: sewingId,
    eventId: 'stitch-add',
    amount: 1,
    requestId: randomUUID(),
  });
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `document.querySelector('.cloth-field').dataset.effect==='supply' && document.querySelector('.cloth-field').dataset.effectCount==='1'`,
      ),
    '新增单块布有独立飞入动画',
  );
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `document.querySelector('.cloth-field').dataset.renderedCount==='2' && !document.querySelector('.cloth-field').dataset.effect`,
      ),
    '单块追加后精确两块',
  );
  await command({
    action: 'trigger',
    id: sewingId,
    eventId: 'stitch-remove',
    amount: 1,
    requestId: randomUUID(),
  });
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `document.querySelector('.cloth-field').dataset.effect==='sew' && document.querySelector('.cloth-field').dataset.effectCount==='1'`,
      ),
    '减少单块布从堆顶向下消耗',
  );
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `document.querySelector('.cloth-field').dataset.renderedCount==='1' && !document.querySelector('.cloth-field').dataset.effect`,
      ),
    '单块缝制后精确一块',
  );
  await command({ action: 'control', id: sewingId, state: 'reset', mode: 'demo', initial: '3000' });
  for (const target of [window, getOutput()!])
    await wait(
      async () =>
        await frame(target, 'sewing')!.executeJavaScript(
          `document.querySelector('#mode').dataset.work==='idle' && document.querySelector('.flywheel').getAnimations().length===0 && document.querySelector('.needle').getAnimations().length===0`,
        ),
      '无事件时机器待机',
    );
  await capture('sewing-landscape');
  await command({
    action: 'trigger',
    id: sewingId,
    eventId: 'stitch-add',
    amount: 100,
    requestId: randomUUID(),
  });
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `document.querySelector('.cloth-field').dataset.effect==='supply' && document.querySelector('.cloth-field').dataset.effectCount==='100' && document.querySelector('#mode').dataset.work==='supply' && document.querySelector('.needle').getAnimations().length===0 && document.querySelector('.event-toast span').textContent==='追加订单'`,
      ),
    '追加订单进布但不启动机器',
  );
  await checkSewingSound('supply');
  await capture('sewing-order-arrival');
  const checkBubble = async () => {
    for (const target of [window, getOutput()!])
      await wait(
        async () =>
          await frame(target, 'sewing')!.executeJavaScript(`(() => {
            const bubble=document.querySelector('.sewing-toast');
            if (!bubble?.classList.contains('show')) return false;
            const r=bubble.getBoundingClientRect();
            return r.left>=0 && r.right<innerWidth*.46 && r.top>innerHeight*.5 &&
              r.bottom<innerHeight && getComputedStyle(bubble,'::after').content!=='none';
          })()`),
        '加减提示在左侧气泡内，避开脸部中央',
      );
  };
  await checkBubble();
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `document.querySelector('#stitch-count').textContent==='3,100' && document.querySelector('.cloth-field').dataset.renderedCount==='3100' && !document.querySelector('.cloth-field').dataset.effect`,
      ),
    '布料随订单增加',
  );
  for (const [eventId, amount] of [
    ['time-add', 60],
    ['stitch-multiply', 2],
    ['stitch-remove', 200],
  ] as const) {
    await command({ action: 'trigger', id: sewingId, eventId, amount, requestId: randomUUID() });
  }
  assert.equal((await snapshot()).layers.at(-1)!.runtime.game.round?.remaining, '6000');
  await checkSewingSound('machine');
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `document.querySelector('.event-toast').classList.contains('show') && document.querySelector('#mode').dataset.work==='sewing' && document.querySelector('.needle').getAnimations().some(a=>a.playState==='running') && document.querySelector('.fabric-texture').getAnimations().some(a=>a.playState==='running') && Number(document.querySelector('.finished-fold').style.opacity)>0`,
      ),
    '缝纫事件特效',
  );
  await capture('sewing-stitch-effect');
  await checkBubble();
  for (const target of [window, getOutput()!])
    await wait(
      async () =>
        await frame(target, 'sewing')!.executeJavaScript(
          `document.querySelector('#stitch-count').textContent==='6,000' && document.querySelector('#mode').dataset.work==='idle' && document.querySelector('.needle').getAnimations().length===0`,
        ),
      '加工完成后精确计数并回到待机',
    );
  await command({
    action: 'configure',
    name: '玩法验收场景',
    width: 1080,
    height: 1920,
    background: 'transparent',
    revision: (await snapshot()).document.revision,
  });
  await command({
    action: 'patch',
    id: sewingId,
    revision: (await snapshot()).document.revision,
    patch: { x: 0, y: 0, width: 1080, height: 1920 },
  });
  await checkSewingLayout(1080, 1920);
  await capture('sewing-portrait');
  for (const theme of ['chrome', 'rose', 'noir']) {
    await command({
      action: 'patch',
      id: sewingId,
      revision: (await snapshot()).document.revision,
      patch: { theme },
    });
    await wait(
      async () =>
        await frame(getOutput()!, 'sewing')!.executeJavaScript(
          `document.body.dataset.theme==='${theme}'`,
        ),
      '缝纫机主题',
    );
    await capture(`sewing-${theme}`);
  }
  await command({
    action: 'trigger',
    id: sewingId,
    eventId: 'release',
    amount: 1,
    requestId: randomUUID(),
  });
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `document.querySelector('#mode').dataset.status==='running' && document.querySelector('#mode').dataset.counterTarget==='0'`,
      ),
    '开门释放',
  );
  assert.equal(
    await frame(getOutput()!, 'sewing')!.executeJavaScript(
      `document.querySelector('#mode').dataset.finished`,
    ),
    'false',
    '最后一单完成前不能提前开门',
  );
  await capture('sewing-last-order');
  await checkBubble();
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `document.querySelector('#mode').dataset.finished==='true' && document.querySelector('#stitch-count').textContent==='0'`,
      ),
    '完成最后一单再收工',
  );
  await checkSewingSound('finish');
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `(() => { const c=document.querySelector('.prison'); const p=c.getContext('2d').getImageData(c.width/2,c.height*.34+9*c.height/innerHeight,1,1).data;return p[3]===0;})()`,
      ),
    '牢门完全打开',
  );
  await capture('sewing-release');
  const completedRound = (await snapshot()).layers.find((v) => v.layer.id === sewingId)!.runtime
    .game.round!.id;
  assert.equal(
    (await snapshot()).layers.find((v) => v.layer.id === sewingId)!.runtime.status,
    'running',
  );
  await choose('[aria-label="试送礼物"]', '2001');
  await choose('[aria-label="礼物数量"]', '1');
  await testButton('试送');
  for (const target of [window, getOutput()!])
    await wait(
      async () =>
        await frame(target, 'sewing')!.executeJavaScript(
          `document.querySelector('#mode').dataset.finished==='false' && document.querySelector('#stitch-count').textContent==='100' && document.querySelector('.cloth-field').dataset.renderedCount==='100'`,
        ),
      '下班后试送礼物自动恢复布堆',
    );
  assert.equal(
    (await snapshot()).layers.find((v) => v.layer.id === sewingId)!.runtime.game.round!.id,
    completedRound,
  );
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `(() => {const c=document.querySelector('.prison');return c.getContext('2d').getImageData(c.width/2,c.height*.34+9*c.height/innerHeight,1,1).data[3]>0;})()`,
      ),
    '新订单自动关闭栅栏',
  );
  await capture('sewing-reopens-after-gift');
  await command({
    action: 'trigger',
    id: sewingId,
    eventId: 'release',
    amount: 1,
    requestId: randomUUID(),
  });
  await command({
    action: 'simulate',
    id: sewingId,
    giftId: '2001',
    quantity: '1',
    requestId: randomUUID(),
  });
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `document.querySelector('#mode').dataset.finished==='false' && document.querySelector('#stitch-count').textContent==='100' && document.querySelector('.cloth-field').dataset.renderedCount==='100'`,
      ),
    '完工动画中立即加量也不中断玩法',
  );
  await command({
    action: 'trigger',
    id: sewingId,
    eventId: 'stitch-remove',
    amount: 100,
    requestId: randomUUID(),
  });
  await wait(
    async () =>
      await frame(getOutput()!, 'sewing')!.executeJavaScript(
        `document.querySelector('#mode').dataset.finished==='true' && document.querySelector('#stitch-count').textContent==='0'`,
      ),
    '再次归零仍会展示下班特效',
  );
  await command({
    action: 'patch',
    id: sewingId,
    revision: (await snapshot()).document.revision,
    patch: { visible: false },
  });
  await command({ action: 'add', pluginId: 'plugin.tasks', sourceId: 'tasks' });
  const tasksId = (await snapshot()).layers.at(-1)!.layer.id;
  await command({ action: 'control', id: tasksId, state: 'start', mode: 'demo' });
  for (const [kind, quantity] of [
    ['like', 3399],
    ['follow', 3],
    ['gift-sender', 2],
  ] as const) {
    await command({
      action: 'simulateObservation',
      id: tasksId,
      kind,
      quantity,
      requestId: randomUUID(),
    });
  }
  await command({
    action: 'trigger',
    id: tasksId,
    eventId: 'score-add',
    amount: 5400,
    requestId: randomUUID(),
  });
  await wait(
    async () =>
      !!frame(getOutput()!, 'tasks') &&
      (await frame(getOutput()!, 'tasks')!.executeJavaScript(
        `document.querySelector('[data-metric="likes"] .meter-number strong')?.textContent==='3,399'`,
      )),
    '任务观测进度',
  );
  await new Promise((r) => setTimeout(r, 750));
  await capture('tasks-progress-portrait');
  const taskSize = (await snapshot()).layers.at(-1)!.layer.contentSize;
  assert.deepEqual(taskSize, { width: 1000, height: 680 });
  await command({
    action: 'patch',
    id: tasksId,
    revision: (await snapshot()).document.revision,
    patch: { width: 500, height: 340 },
  });
  for (const target of [window, getOutput()!])
    await wait(
      async () =>
        await frame(target, 'tasks')!.executeJavaScript(
          `Math.abs(innerWidth-1000)<=1 && Array.from(document.querySelectorAll('.meter-track')).every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})`,
        ),
      '缩小任务单无裁切',
    );
  await command({
    action: 'simulateObservation',
    id: tasksId,
    kind: 'follow',
    quantity: 7,
    requestId: randomUUID(),
  });
  await command({
    action: 'trigger',
    id: tasksId,
    eventId: 'score-add',
    amount: 4600,
    requestId: randomUUID(),
  });
  await wait(
    async () =>
      await frame(getOutput()!, 'tasks')!.executeJavaScript(
        `document.querySelector('[data-metric="score"]').dataset.done==='true'`,
      ),
    '任务达成特效',
  );
  await capture('tasks-complete');
  const frameCount = getOutput()!.webContents.mainFrame.frames.length;
  await command({ action: 'output', open: false });
  await command({ action: 'output', open: true });
  await wait(
    async () =>
      getOutput()!.webContents.mainFrame.frames.length === frameCount &&
      !!frame(getOutput()!, 'tasks'),
    '重开任务输出',
  );
  assert.equal((await snapshot()).layers.at(-1)!.variables?.score, 10000);
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='拆分为独立进度条').click()`,
  );
  await wait(
    async () =>
      (await snapshot()).layers.filter((v) => v.layer.pluginId === 'plugin.tasks').length === 4,
    '界面拆分四条独立进度条',
  );
  const bars = (await snapshot()).layers.filter((v) => v.layer.pluginId === 'plugin.tasks');
  assert.equal(bars.find((v) => v.layer.sourceId === 'task-score')!.variables?.score, 10000);
  assert.equal(bars.find((v) => v.layer.sourceId === 'task-likes')!.variables?.likes, 3399);
  for (const target of [window, getOutput()!])
    for (const bar of bars) {
      await wait(
        async () =>
          !!frame(target, bar.layer.sourceId) &&
          (await frame(target, bar.layer.sourceId)!.executeJavaScript(`
      Math.abs(innerWidth-1000)<=1 && Math.abs(innerHeight-144)<=1 && document.querySelectorAll('.task-meter').length===1 && !document.querySelector('.task-board') &&
      getComputedStyle(document.querySelector('.task-meter')).backgroundColor==='rgba(0, 0, 0, 0)' &&
      Array.from(document.querySelectorAll('.meter-track,.meter-heading')).every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}) &&
      parseFloat(getComputedStyle(document.querySelector('h2')).fontSize)>=40`)),
        '独立透明进度条与大字无裁切',
      );
    }
  for (const [index, bar] of bars.entries())
    await command({
      action: 'patch',
      id: bar.layer.id,
      revision: (await snapshot()).document.revision,
      patch: { x: 40, y: 1200 + index * 160, width: 1000, height: 144 },
    });
  const beforeMove = await snapshot();
  await command({
    action: 'patch',
    id: bars[0]!.layer.id,
    revision: beforeMove.document.revision,
    patch: { x: 60, width: 800, height: 115.2 },
  });
  assert.deepEqual(
    (await snapshot()).layers
      .filter((v) => bars.slice(1).some((b) => b.layer.id === v.layer.id))
      .map((v) => v.layer),
    beforeMove.layers
      .filter((v) => bars.slice(1).some((b) => b.layer.id === v.layer.id))
      .map((v) => v.layer),
  );
  await command({
    action: 'trigger',
    id: bars.find((v) => v.layer.sourceId === 'task-score')!.layer.id,
    eventId: 'score-add',
    amount: 100,
    requestId: randomUUID(),
  });
  assert.equal(
    (await snapshot()).layers.find((v) => v.layer.sourceId === 'task-likes')!.variables?.likes,
    3399,
  );
  await new Promise((r) => setTimeout(r, 750));
  await capture('task-independent-bars-portrait');
  await command({
    action: 'configure',
    name: '玩法验收场景',
    width: 1920,
    height: 1080,
    background: 'transparent',
    revision: (await snapshot()).document.revision,
  });
  for (const [index, bar] of bars.entries())
    await command({
      action: 'patch',
      id: bar.layer.id,
      revision: (await snapshot()).document.revision,
      patch: {
        x: 60 + (index % 2) * 940,
        y: 640 + Math.floor(index / 2) * 160,
        width: 880,
        height: 126.72,
      },
    });
  await capture('task-independent-bars-landscape');
  const completionEffects = await checkCompletionEffects(window, getOutput);
  await command({ action: 'sceneSwitch', id: original.document.id });
  await command({ action: 'sceneDelete', id: testScene });
  for (const view of original.layers.filter(
    (v) => v.runtime.status === 'running' && v.source?.kind !== 'status',
  )) {
    await command({
      action: 'control',
      id: view.layer.id,
      state: 'resume',
    });
  }
  return {
    completionEffects,
    liveColorWithoutBlur: true,
    groupedScrollableSources: true,
    unifiedGameplayIcons: true,
    persistentTestPanel: true,
    giftTestingThroughUi: true,
    onePointOneCloth: true,
    clothPilesGrowBesideMachine: true,
    singleClothEffects: true,
    sewingMechanics: true,
    sewingSoundsDecodedAndPlaying: true,
    sewingEditorDoesNotDuplicateOutputAudio: true,
    sewingIdleUntilWork: true,
    ordersFeedMaterial: true,
    sewingConsumesMaterial: true,
    finishBeforeGateOpens: true,
    completionKeepsReceiving: true,
    giftAutomaticallyReopens: true,
    giftsInterruptCompletion: true,
    prisonRelease: true,
    sewingThemes: true,
    taskObservedProgress: true,
    taskScaledWithoutClipping: true,
    independentTaskBars: true,
    taskSplitPreservesProgress: true,
    taskBarsWithoutPanel: true,
    taskBarsPortraitAndLandscape: true,
    goalsAndEffects: true,
    retiredPrankHidden: true,
  };
}
