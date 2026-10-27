import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dialog, nativeImage, screen, type BrowserWindow } from 'electron';
import type { SceneSnapshot } from '@zhuda/contracts';

/** Test the native capture surface, including pixels outside the visible desktop. */
export async function checkOutputResolution(
  editor: BrowserWindow,
  getOutput: () => BrowserWindow | null,
) {
  const evaluate = (s: string) => editor.webContents.executeJavaScript(s);
  const command = (c: object) => evaluate(`window.studio.sceneCommand(${JSON.stringify(c)})`);
  const snapshot = (): Promise<SceneSnapshot> => evaluate('window.studio.sceneSnapshot()');
  const wait = async (condition: () => Promise<unknown>, label: string) => {
    for (let i = 0; i < 160; i++) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`原始分辨率验证超时：${label}`);
  };
  const add = async (pluginId: string, sourceId: string) => {
    await command({ action: 'add', pluginId, sourceId });
    return (await snapshot()).layers
      .filter((v) => v.layer.pluginId === pluginId && v.layer.sourceId === sourceId)
      .at(-1)!.layer.id;
  };
  const patch = async (id: string, value: object) =>
    command({
      action: 'patch',
      id,
      revision: (await snapshot()).document.revision,
      patch: value,
    });
  const originalDialog = dialog.showOpenDialog;
  const importMedia = async (id: string, file: string) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [join(process.env.LIVE_SCENE_SMOKE_MEDIA_DIR!, file)],
    })) as typeof dialog.showOpenDialog;
    await command({ action: 'importMedia', id, key: 'file' });
  };
  const frame = (target: BrowserWindow, id: string) =>
    target.webContents.mainFrame.frames.find((f) => f.name === id);
  const captures: object[] = [];
  try {
    editor.setContentSize(1020, 720);
    await command({ action: 'sceneCreate', name: '原始像素验收' });
    const imageId = await add('plugin.scene-basics', 'image');
    const textId = await add('plugin.scene-basics', 'text');
    await patch(textId, {
      x: 300,
      y: 64,
      width: 700,
      height: 100,
      settings: {
        ...(await snapshot()).layers.find((l) => l.layer.id === textId)!.layer.settings,
        text: '原始像素 · 直播场景',
        fontSize: 48,
        color: '#14283d',
      },
    });
    const videoId = await add('plugin.scene-basics', 'video');
    await importMedia(videoId, 'test.webm');
    await patch(videoId, { x: 600, y: 300, width: 320, height: 200 });
    await command({ action: 'control', id: videoId, state: 'start', mode: 'demo' });
    const chainId = await add('plugin.chain', 'chain');
    await patch(chainId, { x: 100, y: 300, width: 400, height: 700 });
    await command({ action: 'control', id: chainId, state: 'start', mode: 'demo', initial: '24' });
    for (const [orientation, width, height] of [
      ['portrait', 1080, 1920],
      ['landscape', 1920, 1080],
    ] as const) {
      const doc = (await snapshot()).document;
      await command({
        action: 'configure',
        name: doc.name,
        revision: doc.revision,
        width,
        height,
        background: 'transparent',
      });
      await patch(imageId, {
        x: 0,
        y: 0,
        width,
        height,
        contentSize: null,
        settings: {
          ...(await snapshot()).layers.find((l) => l.layer.id === imageId)!.layer.settings,
          fit: 'fill',
        },
      });
      await importMedia(imageId, `resolution-${orientation}.png`);
      await command({ action: 'output', open: true });
      const output = getOutput()!;
      const density = screen.getDisplayMatching(output.getBounds()).scaleFactor;
      await wait(
        async () =>
          output.webContents.executeJavaScript(
            `innerWidth >= ${width} && innerHeight >= ${height} && Math.abs(devicePixelRatio-1)<.01 && document.querySelector('.scene-stage')?.getBoundingClientRect().width===${width}`,
          ),
        '完整输出视口',
      );
      await wait(
        async () =>
          !!frame(output, imageId) &&
          frame(output, imageId)!.executeJavaScript(
            `document.querySelector('img')?.naturalWidth===${width}`,
          ),
        '隔离输出会话加载原图',
      );
      await wait(
        async () =>
          !!frame(output, chainId) &&
          frame(output, chainId)!.executeJavaScript(
            `document.querySelector('.chain-rig')?.dataset.renderedCount==='24'`,
          ),
        'Canvas 实际渲染',
      );
      await wait(
        async () =>
          !!frame(output, videoId) &&
          frame(output, videoId)!.executeJavaScript(
            `document.querySelector('video')?.readyState>=2 && !document.querySelector('video').paused`,
          ),
        '隔离输出会话播放视频',
      );
      const canvas = (await frame(output, chainId)!.executeJavaScript(`(() => {
        const c=document.querySelector('.chain-rig');return {width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight,dpr:devicePixelRatio};
      })()`)) as {
        width: number;
        height: number;
        cssWidth: number;
        cssHeight: number;
        dpr: number;
      };
      assert.ok(canvas.width >= canvas.cssWidth && canvas.height >= canvas.cssHeight);
      assert.equal(canvas.dpr, 1);
      assert.equal(output.isResizable(), false);
      assert.equal(output.isFullScreenable(), false);
      const outputZoom = output.webContents.getZoomFactor();
      editor.webContents.setZoomFactor(0.8);
      assert.equal(output.webContents.getZoomFactor(), outputZoom, '编辑器缩放不改变输出');
      editor.webContents.setZoomFactor(1);
      await new Promise((r) => setTimeout(r, 250));
      const png = (await output.webContents.capturePage(undefined, { stayAwake: true })).toPNG();
      if (process.env.LIVE_SMOKE_ARTIFACTS) {
        mkdirSync(process.env.LIVE_SMOKE_ARTIFACTS, { recursive: true });
        writeFileSync(join(process.env.LIVE_SMOKE_ARTIFACTS, `output-${orientation}.png`), png);
      }
      const pixelsWide = png.readUInt32BE(16),
        pixelsHigh = png.readUInt32BE(20);
      // Native Windows sizing rounds both scene-to-DIP and DIP-to-pixel conversions.
      // Keep pixel-detail and corner checks below strict; only allow trailing surface padding.
      const paddingLimit = Math.ceil(density * 2) + 1;
      assert.ok(pixelsWide >= width && pixelsWide - width < paddingLimit, `捕捉宽度 ${pixelsWide}`);
      assert.ok(
        pixelsHigh >= height && pixelsHigh - height < paddingLimit,
        `捕捉高度 ${pixelsHigh}`,
      );
      const bitmap = nativeImage.createFromBuffer(png).toBitmap();
      assert.equal(bitmap.length, pixelsWide * pixelsHigh * 4);
      const pixel = (x: number, y: number) => {
        const at = (y * pixelsWide + x) * 4;
        return [bitmap[at + 2], bitmap[at + 1], bitmap[at], bitmap[at + 3]];
      };
      for (const [x, y, color] of [
        [8, 8, [255, 0, 0, 255]],
        [width - 8, 8, [0, 255, 0, 255]],
        [8, height - 8, [0, 0, 255, 255]],
        [width - 8, height - 8, [255, 255, 0, 255]],
      ] as const) {
        const actual = pixel(x, y);
        // Allow the small saturated-channel conversion from the OS color profile.
        assert.ok(
          color.every((v, i) => Math.abs(actual[i]! - v) <= 8),
          `完整画面四角无裁切：${x},${y}=${actual}`,
        );
      }
      for (let x = 16; x < 256; x++) {
        const value = pixel(x, 80)[0]!;
        // Fractional Windows DPI can antialias native pixel edges. Alternating columns
        // must remain distinct; downsampling the pattern would merge them to gray.
        assert.ok(x % 2 === 0 ? value < 80 : value > 175, `单像素线条仍可分辨：${x}=${value}`);
      }
      captures.push({ orientation, width: pixelsWide, height: pixelsHigh, density, canvas });
    }
    await command({ action: 'output', open: false });
    await command({ action: 'output', open: true });
    await wait(
      async () =>
        !!getOutput() &&
        getOutput()!.webContents.executeJavaScript('innerWidth>=1920 && innerHeight>=1080'),
      '重开维持分辨率',
    );
    getOutput()!.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await wait(async () => !getOutput(), 'Esc 关闭输出');
    return {
      nativeResolution: true,
      editorZoomIsolated: true,
      singlePixelDetail: true,
      cornersNotClipped: true,
      media: true,
      captures,
    };
  } finally {
    dialog.showOpenDialog = originalDialog;
  }
}
