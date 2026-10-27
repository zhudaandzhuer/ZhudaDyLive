import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';

// Development-only integration checks run against the real renderer and IPC
// with the smoke runner's isolated profile, never the user's desktop data.
export async function checkTutorial(window: BrowserWindow) {
  const evaluate = async (script: string) => {
    try {
      return await window.webContents.executeJavaScript(script);
    } catch (cause) {
      throw new Error('教学验证脚本失败：' + script, { cause });
    }
  };
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
  const waitFor = async (expression: string, label: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    throw new Error(`新手教学验证逾时：${label}`);
  };
  const click = async (selector: string) => {
    await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`, selector);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const reload = async () => {
    await new Promise<void>((resolve) => {
      window.webContents.once('did-finish-load', () => resolve());
      window.webContents.reload();
    });
    await waitFor('!!document.querySelector(".scene-editor")', '工作台重新加载');
    await pause();
  };
  const capture = async (name: string) => {
    if (!process.env.LIVE_SMOKE_ARTIFACTS) return;
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    mkdirSync(process.env.LIVE_SMOKE_ARTIFACTS, { recursive: true });
    writeFileSync(
      join(process.env.LIVE_SMOKE_ARTIFACTS, `${name}.png`),
      (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    );
  };
  const stage = (id: string) =>
    `document.querySelector('.guided-tour')?.dataset.tourStage === ${JSON.stringify(id)}`;
  const before = await evaluate(
    'window.studio.snapshot().then(s => ({ round: s.round, loggedIn: s.collector.loggedIn, state: s.collector.state }))',
  );
  await waitFor(stage('welcome'), '首次打开提示');
  assert.equal(await evaluate('document.querySelector(".tour-remember input").checked'), false);
  await capture('tutorial-welcome');
  await click('.tour-actions > .text-button');
  await waitFor('!document.querySelector(".guided-tour")', '跳过');
  await reload();
  await waitFor(stage('welcome'), '未勾选时再次显示');
  await click('.tour-actions .button');
  const originalSize = window.getContentSize();
  window.setContentSize(1020, 720);
  const visited = [];
  try {
    for (const id of ['scene', 'sources', 'layers', 'parameters', 'plugins', 'output', 'observe']) {
      await waitFor(`${stage(id)} && !!document.querySelector('.tour-spotlight')`, id);
      await evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      const geometry = await evaluate(`(() => {
        const spot = document.querySelector('.tour-spotlight').getBoundingClientRect();
        const card = document.querySelector('.tour-card').getBoundingClientRect();
        return { id: document.querySelector('.guided-tour').dataset.tourStage,
          targetVisible: spot.width > 0 && spot.height > 0 && spot.left >= 0 && spot.top >= 0 && spot.right <= innerWidth && spot.bottom <= innerHeight,
          cardVisible: card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight,
          overlap: Math.min(spot.right, card.right) > Math.max(spot.left, card.left) && Math.min(spot.bottom, card.bottom) > Math.max(spot.top, card.top),
          backgroundInert: document.querySelector('.app-shell').inert };
      })()`);
      assert.equal(geometry.targetVisible, true, JSON.stringify(geometry));
      assert.equal(geometry.cardVisible, true, JSON.stringify(geometry));
      assert.equal(geometry.overlap, false, JSON.stringify(geometry));
      assert.equal(geometry.backgroundInert, true);
      visited.push(id);
      await capture(`tutorial-${id}`);
      if (id === 'sources') {
        await click('.tour-actions .secondary');
        await waitFor(stage('scene'), '上一步');
        await click('.tour-spotlight');
        await waitFor(
          `${stage('sources')} && !!document.querySelector('.tour-spotlight')`,
          '返回原步骤',
        );
      }
      if (id === 'observe') await click('.tour-remember input');
      await click('.tour-actions > div > .button:last-child');
    }
  } finally {
    window.setContentSize(originalSize[0]!, originalSize[1]!);
  }
  await waitFor('!document.querySelector(".guided-tour")', '完成教学');
  assert.equal(await evaluate('window.studio.snapshot().then(s => s.tutorialDismissed)'), true);
  await reload();
  assert.equal(await evaluate('!!document.querySelector(".guided-tour")'), false);
  assert.equal(await evaluate('document.querySelector(".app-shell").inert'), false);
  await click('#account-menu-toggle');
  await click('[data-tour="replay"]');
  await waitFor(stage('welcome'), '手动重新观看');
  assert.equal(await evaluate('document.querySelector(".tour-remember input").checked'), true);
  await click('.tour-remember input');
  await click('.tour-actions > .text-button');
  await waitFor('!document.querySelector(".guided-tour")', '恢复每次显示');
  await reload();
  await waitFor(stage('welcome'), '取消勾选后重新显示');
  await click('.tour-actions > .text-button');
  await waitFor('!document.querySelector(".guided-tour")', '完成偏好验证');
  const after = await evaluate(
    'window.studio.snapshot().then(s => ({ round: s.round, loggedIn: s.collector.loggedIn, state: s.collector.state }))',
  );
  assert.deepEqual(after, before, '教学不得启动玩法或登录采集');
  return {
    steps: visited,
    uncheckedReturns: true,
    rememberedStaysHidden: true,
    replayWorks: true,
    reenabledReturns: true,
    noGameOrCollectorChanges: true,
    viewport: '1020x720',
  };
}
