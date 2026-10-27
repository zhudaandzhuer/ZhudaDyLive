import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { StudioCommand, StudioSnapshot } from '@zhuda/contracts';

export async function checkThemes(
  main: BrowserWindow,
  getOutput: () => BrowserWindow,
  command: (input: StudioCommand) => Promise<StudioSnapshot>,
  snapshot: () => StudioSnapshot,
) {
  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const inspect = (script: string) => getOutput().webContents.executeJavaScript(script);
  const ui = (script: string) => main.webContents.executeJavaScript(script);
  const checkFace = async () =>
    assert.equal(
      await inspect(`['.chain-rig','.chain-motion'].every(selector => {
    const c=document.querySelector(selector), pixels=c.getContext('2d').getImageData(
      Math.ceil(c.width*.16)+1,0,Math.floor(c.width*.68)-2,Math.floor(c.height*.5)-1).data;
    return !pixels.some((v,i)=>i%4===3 && v>0);
  })`),
      true,
      '所有主题的锁链与动态特效必须避开中间上半部',
    );
  const wait = async (expression: string) => {
    for (let i = 0; i < 120; i++) {
      if (await inspect(expression)) return;
      await pause(30);
    }
    throw new Error(`主题验证逾时：${expression}`);
  };
  const capture = async (name: string, window = getOutput()) => {
    if (window === getOutput()) await checkFace();
    if (!process.env.LIVE_SMOKE_ARTIFACTS) return;
    mkdirSync(process.env.LIVE_SMOKE_ARTIFACTS, { recursive: true });
    writeFileSync(
      join(process.env.LIVE_SMOKE_ARTIFACTS, `${name}.png`),
      (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    );
  };
  await command({ type: 'stopRound' });
  await command({ type: 'startRound', product: 'game.chain', mode: 'demo', initial: '24' });
  const round = snapshot().round!;
  await command({
    type: 'saveGiftRules',
    product: round.product,
    packageVersion: round.packageVersion,
    rules: [
      { giftId: '685', giftName: '粉丝团灯牌', eventId: 'lock', amount: 1, delta: 1 },
      { giftId: '2001', giftName: '玫瑰', eventId: 'unlock', amount: 1, delta: -1 },
    ],
  });
  const definitions = snapshot()
    .library.find((item) => item.manifest.id === 'game.chain')!
    .configuration!.themes.map((t) => t.name);
  const samples = [];
  for (const theme of ['classic', 'monochrome', 'plush']) {
    const windowId = getOutput().id;
    await command({
      type: 'selectTheme',
      product: round.product,
      packageVersion: round.packageVersion,
      theme,
    });
    await wait(
      `document.body.dataset.theme === '${theme}' && document.querySelector('.chain-rig').dataset.renderedCount === '24'`,
    );
    assert.equal(getOutput().id, windowId, '切主题不可重开截取窗口');
    assert.equal(snapshot().round!.id, round.id);
    assert.equal(snapshot().round!.remaining, '24');
    assert.equal(snapshot().actions.length, samples.length * 2);
    assert.equal(
      await inspect("document.querySelector('.chain-motion').dataset.renderedCount ?? '0'"),
      '0',
    );
    await wait("document.querySelector('#remaining').textContent === '24'");
    await capture(`theme-${theme}-portrait`);
    await command({ type: 'output', background: 'green', layout: 'landscape' });
    await wait(
      `document.body.dataset.theme === '${theme}' && document.querySelector('.chain-rig').dataset.renderedCount === '24'`,
    );
    await capture(`theme-${theme}-landscape`);
    const material = await inspect(`(() => {
      const c = document.querySelector('.chain-rig'), p = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let opaque = 0, pink = 0, light = 0, dark = 0;
      for (let i=0;i<p.length;i+=4) if(p[i+3]>180) { opaque++; if(p[i]>p[i+1]*1.25 && p[i+2]>p[i+1]*1.1) pink++; if(p[i]>140 && p[i+1]>140) light++; if(p[i]<80 && p[i+1]<80) dark++; }
      const h = document.querySelector('.chain-hud').getBoundingClientRect();
      return { theme: c.dataset.theme, opaque, pink, light, dark, hudAtBottom: h.top > innerHeight*.8, strands: c.dataset.renderedCount };
    })()`);
    assert.equal(material.strands, '24');
    assert.equal(material.hudAtBottom, true);
    if (theme === 'plush')
      assert.ok(material.pink > material.opaque * 0.45, JSON.stringify(material));
    if (theme === 'monochrome')
      assert.ok(material.light > 100 && material.dark > 100, JSON.stringify(material));
    await command({ type: 'simulate', giftId: '685', quantity: '1' });
    await wait("document.querySelector('.chain-motion').dataset.renderedCount === '1'");
    await pause(300);
    const lock = await inspect(
      "({ kind: document.querySelector('.chain-motion').dataset.kind, from: document.querySelector('.chain-motion').dataset.from, to: document.querySelector('.chain-motion').dataset.to })",
    );
    assert.deepEqual(lock, { kind: 'lock', from: '24', to: '25' });
    await capture(`theme-${theme}-bind`);
    await wait(
      "document.querySelector('.chain-rig').dataset.renderedCount === '25' && document.querySelector('.chain-motion').dataset.renderedCount === '0'",
    );
    await command({ type: 'simulate', giftId: '2001', quantity: '1' });
    await wait("document.querySelector('.chain-motion').dataset.renderedCount === '1'");
    await pause(120);
    await capture(`theme-${theme}-crack`);
    await pause(360);
    await capture(`theme-${theme}-melt`);
    await wait(
      "document.querySelector('.chain-rig').dataset.renderedCount === '24' && document.querySelector('.chain-motion').dataset.renderedCount === '0'",
    );
    assert.equal(snapshot().round!.remaining, '24');
    assert.equal(snapshot().round!.id, round.id);
    await command({ type: 'output', background: 'green', layout: 'portrait' });
    await wait(
      `document.body.dataset.theme === '${theme}' && document.querySelector('.chain-rig').dataset.renderedCount === '24'`,
    );
    assert.equal(
      await inspect("document.querySelector('.stage').dataset.effect ?? 'none'"),
      'none',
    );
    samples.push(material);
  }
  await pause(100);
  await capture('theme-studio', main);
  assert.equal(
    snapshot().library.find((item) => item.manifest.id === 'game.chain')!.configuration!.theme,
    'plush',
  );
  // New rounds reuse the saved theme; no extra events are created by selection.
  await command({ type: 'stopRound' });
  await command({ type: 'startRound', product: 'game.chain', mode: 'demo', initial: '2' });
  assert.equal(snapshot().round!.theme, 'plush');
  await wait(
    "document.body.dataset.theme === 'plush' && document.querySelector('.chain-rig').dataset.renderedCount === '2'",
  );
  // Check exact identity rendering at the dense count in every material.
  for (const theme of ['classic', 'monochrome', 'plush']) {
    await command({
      type: 'selectTheme',
      product: round.product,
      packageVersion: round.packageVersion,
      theme,
    });
    getOutput().webContents.send('game:update', {
      round: { ...snapshot().round!, id: `dense-${theme}`, initial: '4200', remaining: '4200' },
      recent: [],
      lastAction: null,
      background: 'green',
    });
    await wait(
      `document.body.dataset.theme === '${theme}' && document.querySelector('.chain-rig').dataset.renderedCount === '4200'`,
    );
    await checkFace();
    await capture(`theme-${theme}-dense-face-clear`);
  }
  return {
    definitions,
    samples,
    exactCount: 4200,
    preservesRound: true,
    preservesWindow: true,
    savedForNextRound: true,
  };
}
