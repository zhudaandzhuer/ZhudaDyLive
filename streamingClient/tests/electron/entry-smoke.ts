import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';

/** The desktop client opens directly into the workspace. */
export async function enterWorkspace(window: BrowserWindow) {
  const evaluate = (script: string) => window.webContents.executeJavaScript(script);
  const wait = async (script: string) => {
    for (let i = 0; i < 160; i++) {
      if (await evaluate(script)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error('进入流程验证超时：' + script);
  };
  const capture = async (name: string) => {
    const dir = process.env.LIVE_SMOKE_ARTIFACTS;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name + '.png'), (await window.webContents.capturePage()).toPNG());
  };
  const click = (selector: string) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await wait('!!document.querySelector(".scene-editor")');
  await wait('!!document.querySelector(".scene-editor") && !document.querySelector(".entry-flow")');
  assert.equal(
    await evaluate('document.querySelectorAll(".studio-side-tabs [role=tab]").length'),
    2,
  );
  assert.deepEqual(
    await evaluate(
      'Array.from(document.querySelectorAll(".studio-side-tabs [role=tab]")).map((tab) => tab.textContent?.trim())',
    ),
    ['直播观测', '插件区'],
  );
  return {
    directLaunch: true,
    localTesting: true,
    persistentScene: true,
  };
}
