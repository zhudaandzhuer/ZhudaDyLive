import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import type { SceneSnapshot } from '@zhuda/contracts';

/** Runs only against the scene-smoke script's isolated profile and local service. */
export async function checkDragon(window: BrowserWindow, getOutput: () => BrowserWindow | null) {
  const command = (input: object) =>
    window.webContents.executeJavaScript(`window.studio.sceneCommand(${JSON.stringify(input)})`);
  const snapshot = (): Promise<SceneSnapshot> =>
    window.webContents.executeJavaScript('window.studio.sceneSnapshot()');
  const wait = async (test: () => Promise<unknown>, label: string) => {
    for (let i = 0; i < 400; i++) {
      if (await test()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`对决验收超时：${label}`);
  };
  const view = async () =>
    (await snapshot()).layers.find(
      (v) => v.layer.pluginId === 'plugin.dragon' && v.layer.sourceId === 'duel',
    )!;
  const frame = (target: BrowserWindow) =>
    target.webContents.mainFrame.frames.find(
      (f) => f.url.includes('plugin.dragon') && f.url.endsWith('/assets/index.html'),
    );
  const capture = async (name: string) => {
    if (!process.env.LIVE_SMOKE_ARTIFACTS || !getOutput()) return;
    await new Promise((r) => setTimeout(r, 250));
    mkdirSync(process.env.LIVE_SMOKE_ARTIFACTS, { recursive: true });
    writeFileSync(
      join(process.env.LIVE_SMOKE_ARTIFACTS, name + '.png'),
      (await getOutput()!.webContents.capturePage()).toPNG(),
    );
  };
  await command({ action: 'sceneCreate', name: '方形对决隔离验收' });
  await command({
    action: 'configure',
    name: '方形对决隔离验收',
    width: 1080,
    height: 1080,
    background: 'transparent',
    revision: (await snapshot()).document.revision,
  });
  await command({ action: 'add', pluginId: 'plugin.dragon', sourceId: 'duel' });
  let current = await view();
  const id = current.layer.id;
  assert.equal(current.layer.width, current.layer.height);
  assert.deepEqual(current.layer.contentSize, { width: 1080, height: 1080 });
  await command({
    action: 'patch',
    id,
    revision: (await snapshot()).document.revision,
    patch: { settings: { ...current.layer.settings, prepSeconds: 5 } },
  });
  await command({ action: 'control', id, state: 'start', mode: 'demo' });
  await command({ action: 'output', open: true });
  await wait(async () => !!getOutput() && !!frame(getOutput()!) && !!frame(window), '两份插件输出');
  await wait(
    async () =>
      frame(getOutput()!)!.executeJavaScript(
        '[...document.querySelectorAll(".poster,.team-art")].length === 3 && [...document.querySelectorAll(".poster,.team-art")].every(img=>img.complete && img.naturalWidth > 0) && document.querySelector("#hero-Attack")?.textContent === "320"',
      ),
    '横图解码与初始属性',
  );
  const targets = [window, getOutput()!];
  const checkLayout = async () => {
    for (const target of targets) {
      const layout = (await frame(target)!.executeJavaScript(`(() => {
        const arena=document.querySelector('#arena').getBoundingClientRect();
        const stage=document.querySelector('.battle-stage').getBoundingClientRect();
        const panels=[...document.querySelectorAll('.team')].map(p=>p.getBoundingClientRect().toJSON());
        return {width:arena.width,height:arena.height,stage:stage.toJSON(),panels,
          clock:document.querySelector('.countdown').getBoundingClientRect().toJSON(),
          healthBarsVisible:[...document.querySelectorAll('.health-track')].every(el=>el.getBoundingClientRect().height>5),
          topText:document.querySelector('.battle-stage').innerText.trim(),
          timer:document.querySelector('#seconds').textContent,
          videos:document.querySelectorAll('video').length,
          extraneous:document.querySelectorAll('.mast,.headline,.nameplate,.lifecycle,.clash-caption,.end-screen,#end-screen,.gift-toast,.forecast,footer').length,
          overflow:[...document.querySelectorAll('.team [data-stat],.team h2')].some(el=>el.scrollWidth>el.clientWidth+1 || el.getBoundingClientRect().bottom>arena.bottom+1)};
      })()`)) as {
        width: number;
        height: number;
        stage: { width: number; height: number; bottom: number };
        panels: { top: number; bottom: number; left: number; right: number }[];
        topText: string;
        timer: string;
        healthBarsVisible: boolean;
        clock: { x: number; y: number; width: number; height: number };
        videos: number;
        extraneous: number;
        overflow: boolean;
      };
      assert.equal(layout.width, layout.height);
      assert.ok(Math.abs(layout.stage.width / layout.stage.height - 16 / 9) < 0.01);
      assert.equal(layout.panels.length, 2);
      assert.ok(
        layout.panels.every(
          (p: { top: number; bottom: number; left: number; right: number }) =>
            p.top >= layout.stage.bottom &&
            p.bottom <= layout.height + 1 &&
            p.left >= 0 &&
            p.right <= layout.width + 1,
        ),
      );
      assert.equal(layout.topText, '');
      assert.ok(Math.abs(layout.clock.x + layout.clock.width / 2 - layout.width / 2) < 1);
      assert.ok(layout.clock.y >= layout.stage.bottom && layout.clock.y < layout.panels[0]!.top);
      assert.equal(layout.videos, 0);
      assert.equal(layout.extraneous, 0);
      assert.equal(layout.overflow, false);
      assert.equal(layout.healthBarsVisible, true);
    }
  };
  await checkLayout();
  const isolation = (await frame(getOutput()!)!.executeJavaScript(
    '({node:typeof require,bridge:typeof window.studio})',
  )) as { node: string; bridge: string };
  assert.equal(isolation.node, 'undefined');
  assert.equal(isolation.bridge, 'undefined');

  // Check the actual renderer clock, then pause before the first clash.
  const seconds = () =>
    frame(getOutput()!)!.executeJavaScript('document.querySelector("#seconds").textContent');
  const initialSeconds = await seconds();
  await wait(async () => (await seconds()) !== initialSeconds, '倒计时推进');
  await command({ action: 'control', id, state: 'pause' });
  await new Promise((r) => setTimeout(r, 100));
  const paused = (await view()).runtime;
  const pausedSeconds = await seconds();
  await new Promise((r) => setTimeout(r, 1100));
  assert.deepEqual((await view()).runtime.battle, paused.battle);
  assert.equal(await seconds(), pausedSeconds);

  // Skins are live settings, including imported media on a locked scene layer.
  const origins = await Promise.all(
    targets.map((target) => frame(target)!.executeJavaScript('performance.timeOrigin')),
  );
  const originalArt = (await frame(getOutput()!)!.executeJavaScript(
    '[...document.querySelectorAll(".team-art")].map(img=>img.getAttribute("src"))',
  )) as string[];
  await command({
    action: 'patch',
    id,
    revision: (await snapshot()).document.revision,
    patch: { locked: true },
  });
  await command({ action: 'settings', id, values: { panelSkin: 'light' } });
  await wait(
    async () =>
      (
        await Promise.all(
          targets.map((target) =>
            frame(target)!.executeJavaScript('document.querySelector("#arena").dataset.panelSkin'),
          ),
        )
      ).every((value) => value === 'light'),
    '下方面板独立换肤',
  );
  await capture('dragon-square-light-skin');
  const originalDialog = dialog.showOpenDialog;
  try {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [join(process.env.LIVE_SCENE_SMOKE_MEDIA_DIR!, 'test.png')],
    })) as typeof dialog.showOpenDialog;
    await command({ action: 'importMedia', id, key: 'arenaImage' });
    await wait(
      async () =>
        frame(getOutput()!)!.executeJavaScript(
          'document.querySelector(".poster").naturalWidth===320',
        ),
      '锁定图层更换上方素材',
    );
    assert.deepEqual(
      await frame(getOutput()!)!.executeJavaScript(
        '[...document.querySelectorAll(".team-art")].map(img=>img.getAttribute("src"))',
      ),
      originalArt,
    );
    const arenaImage = (await view()).layer.settings.arenaImage;
    await command({ action: 'importMedia', id, key: 'heroPanelImage' });
    await wait(
      async () =>
        frame(getOutput()!)!.executeJavaScript(
          'document.querySelector(".hero .team-art").naturalWidth===320',
        ),
      '独立更换猪大角色背景',
    );
    assert.equal((await view()).layer.settings.arenaImage, arenaImage);
    assert.equal(
      await frame(getOutput()!)!.executeJavaScript(
        'document.querySelector(".dragon .team-art").getAttribute("src")',
      ),
      originalArt[1],
    );
    await command({ action: 'importMedia', id, key: 'dragonPanelImage' });
    await wait(
      async () =>
        frame(getOutput()!)!.executeJavaScript(
          'document.querySelector(".dragon .team-art").naturalWidth===320',
        ),
      '独立更换恶龙角色背景',
    );
  } finally {
    dialog.showOpenDialog = originalDialog;
  }
  await command({
    action: 'settings',
    id,
    values: { panelSkin: 'dark', arenaImage: '', heroPanelImage: '', dragonPanelImage: '' },
  });
  await wait(
    async () =>
      frame(getOutput()!)!.executeJavaScript(
        '[...document.querySelectorAll(".poster,.team-art")].every(img=>img.complete&&img.naturalWidth>1000)',
      ),
    '恢复官方角色皮肤',
  );
  assert.deepEqual((await view()).runtime.battle, paused.battle);
  assert.deepEqual(
    await Promise.all(
      targets.map((target) => frame(target)!.executeJavaScript('performance.timeOrigin')),
    ),
    origins,
  );
  await capture('dragon-square-layout');
  await command({
    action: 'patch',
    id,
    revision: (await snapshot()).document.revision,
    patch: { locked: false },
  });
  // A small scene layer still scales its complete square content rather than clipping it.
  await command({
    action: 'patch',
    id,
    revision: (await snapshot()).document.revision,
    patch: { width: 360, height: 360 },
  });
  await new Promise((r) => setTimeout(r, 150));
  await checkLayout();
  await command({
    action: 'patch',
    id,
    revision: (await snapshot()).document.revision,
    patch: { width: 1080, height: 1080 },
  });

  const trigger = (eventId: string, amount: number) =>
    command({ action: 'trigger', id, eventId, amount, requestId: randomUUID() });
  await command({ action: 'control', id, state: 'resume' });
  await command({ action: 'settings', id, values: { panelSkin: 'light' } });
  assert.equal((await view()).runtime.game.round!.id, paused.game.round!.id);
  await command({ action: 'settings', id, values: { panelSkin: 'dark' } });
  await trigger('hero-speed', 40);
  await trigger('dragon-attack', 80);
  await wait(async () => (await view()).runtime.battle?.phase === 'clash', '定时交战');
  current = await view();
  assert.equal(current.runtime.battle!.lastClash!.dodged, true);
  assert.ok(current.runtime.battle!.lastClash!.damageToDragon > 0);
  const expected = current.runtime.battle!.dragon.hp.toLocaleString('zh-CN');
  await wait(
    async () =>
      (
        await Promise.all(
          targets.map((target) =>
            frame(target)!.executeJavaScript(
              'document.querySelector("#dragon-hp-current").textContent',
            ),
          ),
        )
      ).every((value) => value === expected),
    '预览与输出生命同步',
  );
  assert.equal(
    await frame(getOutput()!)!.executeJavaScript(
      'document.querySelector(".battle-stage").innerText.trim()',
    ),
    '',
  );
  await capture('dragon-square-clash');

  await command({ action: 'control', id, state: 'reset', mode: 'demo' });
  await trigger('hero-defense', 1000);
  await trigger('hero-attack', 10000);
  await wait(async () => (await view()).runtime.battle?.phase === 'finished', '胜负结算');
  assert.equal((await view()).runtime.battle!.winner, 'hero');
  await wait(
    async () =>
      frame(getOutput()!)!.executeJavaScript(
        'document.querySelector("#dragon-hp-current").textContent === "0" && document.querySelector(".countdown").hidden',
      ),
    '结束时只保留静态战斗图和数值',
  );
  await capture('dragon-square-victory');
  const report = {
    signedPluginInstalled: true,
    sandboxIsolation: true,
    squareComposition: true,
    landscapePosterDecoded: true,
    filmsDeferred: true,
    timerCenteredAboveStatPanels: true,
    characterBackgroundsDecoded: true,
    independentLiveSkins: true,
    customBackgroundImportWhileLocked: true,
    skinChangePreservesBattleAndIframe: true,
    smallLayerScalesWithoutClipping: true,
    countdownAdvancesAndPauses: true,
    timedAttack: true,
    bothSidesTraining: true,
    dodgeAndCounter: true,
    previewOutputSynchronized: true,
    pausePreservesState: true,
    heroVictory: true,
    noPersistentCaptions: true,
  };
  if (process.env.LIVE_SMOKE_ARTIFACTS)
    writeFileSync(
      join(process.env.LIVE_SMOKE_ARTIFACTS, 'dragon-report.json'),
      JSON.stringify(report, null, 2),
    );
  return report;
}
