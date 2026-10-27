import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { GameState, GameAction } from '@zhuda/contracts';

/** Real preload, stylesheet and canvases; never changes a saved scene or round. */
export async function checkChainTransitions(output: BrowserWindow, base: GameState) {
  assert.ok(base.round);
  const inspect = (script: string) => output.webContents.executeJavaScript(script);
  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const wait = async (expression: string) => {
    for (let i = 0; i < 500; i++) {
      if (await inspect(expression)) return;
      await pause(20);
    }
    throw new Error(`连续锁链验证超时：${expression}`);
  };
  const cases = [];
  for (const [theme, bindFirst] of [
    ['classic', false],
    ['monochrome', false],
    ['plush', false],
    ['monochrome', true],
  ] as const) {
    const id = randomUUID();
    const send = (remaining: number, before?: number) => {
      const action: GameAction | null =
        before === undefined
          ? null
          : {
              id: randomUUID(),
              roundId: id,
              giftId: 'continuity',
              giftName: '连续消除测试',
              senderName: '本机测试',
              quantity: '1',
              before: String(before),
              after: String(remaining),
              delta: String(remaining - before),
              won: remaining === 0,
              at: new Date().toISOString(),
            };
      output.webContents.send('game:update', {
        ...base,
        round: {
          ...base.round!,
          id,
          initial: '100',
          remaining: String(remaining),
          theme,
          status: remaining ? 'running' : 'won',
        },
        recent: action ? [action] : [],
        lastAction: action,
      });
    };
    send(bindFirst ? 0 : 100);
    await wait(
      `document.body.dataset.theme === '${theme}' && document.querySelector('.chain-rig').dataset.renderedCount === '${bindFirst ? 0 : 100}' && document.querySelector('.chain-motion').dataset.renderedCount === '0'`,
    );
    if (bindFirst) {
      send(100, 0);
      await wait(
        `document.querySelector('.chain-motion').dataset.kind === 'lock' && document.querySelector('.chain-motion').dataset.renderedCount === '100'`,
      );
      await pause(100);
    }
    send(40, 100);
    await pause(100);
    send(0, 40);
    if (!bindFirst)
      await wait(
        `document.querySelector('.chain-rig').dataset.renderedCount === '40' && document.querySelector('.chain-motion').dataset.renderedCount === '60'`,
      );
    await inspect(`(() => {
      const rig=document.querySelector('.chain-rig'),motion=document.querySelector('.chain-motion');
      const thumbnail=document.createElement('canvas');thumbnail.width=96;thumbnail.height=54;
      const ctx=thumbnail.getContext('2d',{willReadFrequently:true});
      window.__chainContinuity={frames:[],handoffAt:0,frame:0,done:false};
      const probe=window.__chainContinuity;
      const sample=()=>{
        ctx.clearRect(0,0,96,54);
        const opacity=Number(getComputedStyle(rig).opacity);
        ctx.globalAlpha=opacity;ctx.drawImage(rig,0,0,96,54);
        ctx.globalAlpha=1;ctx.drawImage(motion,0,0,96,54);
        const pixels=ctx.getImageData(0,0,96,54).data;
        let ink=0;for(let i=3;i<pixels.length;i+=4)ink+=pixels[i];
        const moving=motion.dataset.renderedCount;
        if(motion.dataset.kind==='unlock' && moving==='${bindFirst ? 100 : 40}'&&!probe.handoffAt)probe.handoffAt=performance.now();
        probe.frames.push({static:rig.dataset.renderedCount,moving,opacity,ink});
        if(probe.handoffAt && performance.now()-probe.handoffAt>180){probe.done=true;return;}
        probe.frame=requestAnimationFrame(sample);
      };
      probe.frame=requestAnimationFrame(sample);
    })()`);
    await wait('window.__chainContinuity.done');
    const frames = (await inspect('window.__chainContinuity.frames')) as {
      static: string;
      moving: string;
      opacity: number;
      ink: number;
    }[];
    const invisible = frames.filter((frame) => frame.ink <= 0 || frame.opacity !== 1);
    assert.deepEqual(invisible, [], '数字归零后剩余锁链必须持续可见，两段动画交接不能出现空帧');
    if (!bindFirst)
      assert.ok(frames.some((frame) => frame.static === '40' && frame.moving === '60'));
    assert.ok(
      frames.some((frame) => frame.static === '0' && frame.moving === String(bindFirst ? 100 : 40)),
    );
    if (process.env.LIVE_SMOKE_ARTIFACTS) {
      mkdirSync(process.env.LIVE_SMOKE_ARTIFACTS, { recursive: true });
      writeFileSync(
        join(
          process.env.LIVE_SMOKE_ARTIFACTS,
          `continuity-${theme}-${bindFirst ? 'binding' : 'settled'}.png`,
        ),
        (await output.webContents.capturePage()).toPNG(),
      );
    }
    await wait(
      `document.querySelector('.chain-motion').dataset.renderedCount === '0' && document.querySelector('.chain-rig').dataset.renderedCount === '0'`,
    );
    const finalInk = await inspect(`(() => {
      const canvases=['.chain-rig','.chain-motion'];
      return canvases.reduce((total,selector)=>{
        const c=document.querySelector(selector),pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        for(let i=3;i<pixels.length;i+=4)total+=pixels[i];return total;
      },0);
    })()`);
    assert.equal(finalInk, 0, '最后 40 根消融结束后才真正清空画布');
    cases.push({
      theme,
      bindFirst,
      sampledFrames: frames.length,
      blankFrames: invisible.length,
      finalInk,
    });
  }
  return cases;
}
