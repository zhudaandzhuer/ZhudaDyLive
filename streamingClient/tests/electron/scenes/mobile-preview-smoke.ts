import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import type { MobilePreviewStatus, SceneSnapshot } from '@zhuda/contracts';

export async function checkMobilePreview(
  editor: BrowserWindow,
  getOutput: () => BrowserWindow | null,
) {
  editor.webContents.setAudioMuted(true);
  const evaluate = (script: string) => editor.webContents.executeJavaScript(script);
  const command = (input: object) =>
    evaluate(`window.studio.sceneCommand(${JSON.stringify(input)})`);
  const snapshot = (): Promise<SceneSnapshot> => evaluate('window.studio.sceneSnapshot()');
  const wait = async (test: () => Promise<unknown>, label: string) => {
    for (let i = 0; i < 200; i++) {
      if (await test()) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    for (const target of [editor, phone]) {
      for (const frame of target.webContents.mainFrame.frames.filter((frame) =>
        frame.url.includes('plugin.chain/'),
      ))
        console.log(
          '手机音效诊断',
          label,
          frame.url,
          await frame.executeJavaScript(
            `({status:document.body.dataset.sceneStatus,count:document.querySelector('.chain-rig')?.dataset.renderedCount,audio:Array.from(document.querySelectorAll('audio')).map(a=>({src:a.src,error:a.error?.code,ready:a.readyState,time:a.currentTime,duration:a.duration,paused:a.paused,dataset:{...a.dataset}}))})`,
          ),
        );
    }
    console.log(
      '手机声音状态',
      await phone.webContents.executeJavaScript(
        `({sound:document.querySelector('.phone-preview')?.dataset.sound,error:document.querySelector('.phone-sound-error')?.textContent,probe:window.__phoneAudioProbe})`,
      ),
    );
    throw new Error(`手机预览验证超时：${label}`);
  };
  const add = async (pluginId: string, sourceId: string) => {
    await command({ action: 'add', pluginId, sourceId });
    return (await snapshot()).layers
      .filter((v) => v.layer.pluginId === pluginId && v.layer.sourceId === sourceId)
      .at(-1)!.layer.id;
  };
  const patch = async (id: string, patch: object) =>
    command({ action: 'patch', id, revision: (await snapshot()).document.revision, patch });
  const capture = async (window: BrowserWindow, name: string) => {
    const directory = process.env.LIVE_SMOKE_ARTIFACTS;
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  };
  const phone = new BrowserWindow({
    title: '手机预览验收',
    width: 390,
    height: 844,
    useContentSize: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'user-gesture-required',
    },
  });
  phone.setIgnoreMouseEvents(true);
  phone.webContents.setAudioMuted(true);
  const inspect = (script: string, userGesture = false) =>
    phone.webContents.executeJavaScript(script, userGesture);
  const frame = (id: string) => phone.webContents.mainFrame.frames.find((f) => f.name === id);
  const originalDialog = dialog.showOpenDialog;
  try {
    await command({ action: 'sceneCreate', name: '手机预览验收' });
    const initial = (await snapshot()).document;
    await command({
      action: 'configure',
      name: initial.name,
      revision: initial.revision,
      width: 1080,
      height: 1920,
      background: 'dark',
    });
    const image = await add('plugin.scene-basics', 'image');
    const video = await add('plugin.scene-basics', 'video');
    const text = await add('plugin.scene-basics', 'text');
    for (const [id, file] of [
      [image, 'test.png'],
      [video, 'test.webm'],
    ]) {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [join(process.env.LIVE_SCENE_SMOKE_MEDIA_DIR!, file!)],
      })) as typeof dialog.showOpenDialog;
      await command({ action: 'importMedia', id, key: 'file' });
    }
    await patch(image, { x: 40, y: 100, width: 480, height: 300 });
    await patch(video, { x: 560, y: 100, width: 480, height: 300 });
    await patch(text, {
      x: 40,
      y: 480,
      width: 1000,
      height: 140,
      settings: {
        ...(await snapshot()).layers.find((v) => v.layer.id === text)!.layer.settings,
        text: '手机实时预览',
        fontSize: 72,
      },
    });
    await command({ action: 'control', id: video, state: 'start', mode: 'demo' });
    const chain = await add('plugin.chain', 'chain');
    const panel = (await snapshot()).layers.find((v) => v.source?.kind === 'status')!.layer.id;
    await command({ action: 'control', id: chain, state: 'start', mode: 'demo', initial: '20' });
    await command({ action: 'addInstructions', id: chain });
    const guide = (await snapshot()).layers.at(-1)!.layer.id;
    await patch(guide, { x: 40, y: 700, width: 440, height: 900 });
    await evaluate(`document.querySelector('#scene-mobile-preview').click()`);
    await wait(
      () => evaluate(`!!document.querySelector('.mobile-qr')?.naturalWidth`),
      '二维码生成',
    );
    await capture(editor, 'mobile-qr-dialog');
    const status: MobilePreviewStatus = await evaluate(`window.studio.mobilePreview('status')`);
    const url = status.addresses[0]!.url;
    assert.ok(url.startsWith('http://'));
    await phone.loadURL(url);
    await wait(
      () => inspect(`document.querySelector('.phone-preview')?.dataset.connection === 'live'`),
      '实时连接',
    );
    assert.equal(
      await inspect(
        `typeof window.studio + ',' + typeof window.sceneOutput + ',' + typeof window.require`,
      ),
      'undefined,undefined,undefined',
    );
    await wait(
      async () =>
        frame(image)?.executeJavaScript(`!!document.querySelector('img')?.naturalWidth`) ?? false,
      '手机图片',
    );
    await wait(
      async () =>
        frame(video)?.executeJavaScript(
          `document.querySelector('video')?.currentTime > 0.1 && !document.querySelector('video')?.paused`,
        ) ?? false,
      '手机视频',
    );
    await wait(
      async () =>
        frame(chain)?.executeJavaScript(
          `document.querySelector('.chain-rig')?.dataset.renderedCount === '20'`,
        ) ?? false,
      '手机锁链',
    );
    const checkChainPixels = async () => {
      const displayed = await inspect(`(() => {
        const f=document.querySelector('.scene-render-layer[data-layer-id="${chain}"] iframe');
        return {width:f.getBoundingClientRect().width,dpr:devicePixelRatio};
      })()`);
      const rendered = (await frame(chain)!.executeJavaScript(`(() => {
        const c=document.querySelector('.chain-rig');
        return {width:c.width,css:c.clientWidth,count:c.dataset.renderedCount};
      })()`)) as { width: number; css: number; count: string };
      assert.ok(
        Math.abs(
          rendered.width - Math.round(Math.min(rendered.css * 2, displayed.width * displayed.dpr)),
        ) <= 1,
        '手机锁链画布必须匹配实际屏幕像素，不能重复放大渲染',
      );
      return rendered;
    };
    await checkChainPixels();
    await wait(
      async () =>
        frame(panel)?.executeJavaScript(
          `document.querySelector('#remaining')?.textContent==='20' && getComputedStyle(document.querySelector('#label')).fontSize==='30px'`,
        ) ?? false,
      '手机独立大字号状态面板',
    );
    await patch(panel, { x: 90, y: 1600, width: 900, height: 300 });
    await wait(
      () =>
        inspect(
          `getComputedStyle(document.querySelector('[data-layer-id="${panel}"] iframe')).transform==='matrix(1.25, 0, 0, 1.25, 0, 0)'`,
        ),
      '手机独立面板缩放',
    );
    await wait(
      async () =>
        frame(text)?.executeJavaScript(`document.body.textContent.includes('手机实时预览')`) ??
        false,
      '手机文字',
    );
    await wait(
      async () =>
        frame(guide)?.executeJavaScript(`!!document.querySelector('.instruction-row')`) ?? false,
      '手机礼物说明',
    );
    const checkTransparency = async (target: BrowserWindow) => {
      const point = await target.webContents.executeJavaScript(`(() => {
        const r = document.querySelector('.scene-render-layer[data-layer-id="${guide}"] iframe').getBoundingClientRect();
        return {x:Math.floor(r.right-2),y:Math.floor(r.top+2),width:1,height:1};
      })()`);
      const pixel = (await target.webContents.capturePage(point)).toBitmap();
      assert.ok(
        Math.max(pixel[0]!, pixel[1]!, pixel[2]!) < 100,
        '礼物说明空白处必须透出深色场景，不能被色彩模式填成白底',
      );
    };
    await checkTransparency(phone);
    await inspect(`(() => {
      window.__phoneAudioProbe = {played:0,active:0,durations:[],states:[]};
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(...args) {
        if (this.buffer?.duration > .1) {
          const p=window.__phoneAudioProbe;p.played++;p.active++;
          p.durations.push(this.buffer.duration);p.states.push(this.context.state);
          this.addEventListener('ended',()=>p.active--,{once:true});
        }
        return Reflect.apply(start,this,args);
      };
    })()`);
    await capture(phone, 'mobile-portrait');
    await evaluate(`document.querySelector('[aria-label="关闭手机预览面板"]').click()`);
    const hostVideo = () => editor.webContents.mainFrame.frames.find((f) => f.name === video);
    await hostVideo()!.executeJavaScript('window.__persistentScene = true');
    await evaluate(`document.querySelector('#tab-plugins').click()`);
    await wait(() => evaluate('!!document.querySelector(".plugin-store")'), '左侧插件区');
    assert.equal(
      await hostVideo()!.executeJavaScript(
        'window.__persistentScene && !document.querySelector("video").paused',
      ),
      true,
      '切换商店不能重建或暂停场景视频',
    );
    assert.equal(
      (await evaluate(`window.studio.mobilePreview('status')`)).addresses[0].url,
      url,
      '切换插件区保留手机链接',
    );
    await capture(editor, 'workstation-store');
    await evaluate(`document.querySelector('#tab-live').click()`);
    await wait(() => evaluate('!!document.querySelector("#observation-details")'), '左侧直播观测');
    assert.equal(
      await hostVideo()!.executeJavaScript(
        'window.__persistentScene && !document.querySelector("video").paused',
      ),
      true,
    );
    await capture(editor, 'workstation-observation');
    await evaluate(`document.querySelector('#manage-connection').click()`);
    await wait(
      () => evaluate('document.querySelector(".entry-flow")?.dataset.entryStep === "account"'),
      '重新管理抖音账号',
    );
    assert.equal(
      await hostVideo()!.executeJavaScript('window.__persistentScene'),
      true,
      '账号步骤保留已打开场景',
    );
    assert.equal((await evaluate(`window.studio.mobilePreview('status')`)).addresses[0].url, url);
    await evaluate(`document.querySelector('[aria-label="返回工作台"]').click()`);
    await wait(() => evaluate('!document.querySelector(".entry-flow")'), '返回当前场景');
    await frame(video)!.executeJavaScript(`window.__previewContinuity = true`);
    await patch(image, { x: 80 });
    await patch(text, {
      settings: {
        ...(await snapshot()).layers.find((v) => v.layer.id === text)!.layer.settings,
        text: '实时更新成功',
        color: '#ff6688',
      },
    });
    await wait(
      async () =>
        frame(text)?.executeJavaScript(
          `document.body.textContent.includes('实时更新成功') && document.querySelector('#source > div')?.style.color === 'rgb(255, 102, 136)'`,
        ) ?? false,
      '文字实时更新',
    );
    assert.equal(
      await frame(video)!.executeJavaScript(
        `window.__previewContinuity && !document.querySelector('video').paused`,
      ),
      true,
    );
    const source = (await snapshot()).layers.find((v) => v.layer.id === chain)!.source!;
    const action = async (operation: string, amount: number) =>
      command({
        action: 'manual',
        id: chain,
        eventId: source.events.find((event) => event.operation === operation)!.id,
        amount,
        requestId: crypto.randomUUID(),
      });
    await action('add', 1);
    const editorChain = () => editor.webContents.mainFrame.frames.find((f) => f.name === chain);
    await wait(
      async () =>
        editorChain()?.executeJavaScript(
          `Array.from(document.querySelectorAll('audio')).some(a => a.dataset.chainSound === 'lock' && a.currentTime > 0.03 && Math.abs(a.duration - 0.48) < .05 && !a.error && !a.dataset.playbackError)`,
        ) ?? false,
      '绑定音效解码播放',
    );
    await wait(
      async () =>
        frame(chain)?.executeJavaScript(
          `document.querySelector('.chain-rig')?.dataset.renderedCount === '21'`,
        ) ?? false,
      '礼物事件更新',
    );
    await action('subtract', 21);
    await wait(
      async () =>
        editorChain()?.executeJavaScript(
          `Array.from(document.querySelectorAll('audio')).some(a => a.dataset.chainSound === 'unlock' && a.currentTime > .03 && Math.abs(a.duration - 0.7) < .05 && !a.error && !a.dataset.playbackError)`,
        ) ?? false,
      '断裂消融音效播放',
    );
    await wait(
      () => inspect(`!!document.querySelector('.scene-completion-effect')`),
      '手机完成特效',
    );
    await action('add', 1);
    await wait(
      () => inspect(`!document.querySelector('.scene-completion-effect')`),
      '新礼物打断完成特效',
    );
    assert.equal(
      await frame(chain)!.executeJavaScript(`document.querySelectorAll('audio').length`),
      0,
      '手机预览默认静音，不重复播放音效',
    );
    assert.equal(await inspect(`window.__phoneAudioProbe.played`), 0);
    await inspect(`document.querySelector('.phone-sound-toggle').click()`, true);
    await wait(
      () => inspect(`document.querySelector('.phone-preview').dataset.sound === 'on'`),
      '点按开启手机声音',
    );
    assert.equal(await inspect(`window.__phoneAudioProbe.played`), 0, '开启声音不补播历史事件');
    await action('add', 1);
    await wait(() => inspect(`window.__phoneAudioProbe.played >= 1`), '手机绑定声音');
    await action('subtract', 1);
    await wait(() => inspect(`window.__phoneAudioProbe.played >= 2`), '手机消融声音');
    const phoneAudio = await inspect(`window.__phoneAudioProbe`);
    assert.ok(phoneAudio.durations.includes(0.48) && phoneAudio.durations.includes(0.7));
    assert.ok(phoneAudio.states.every((state: string) => state === 'running'));
    await inspect(`document.querySelector('.phone-sound-toggle').click()`, true);
    await wait(() => inspect(`window.__phoneAudioProbe.active === 0`), '手机静音立即停止');
    const mutedPlays = await inspect(`window.__phoneAudioProbe.played`);
    await inspect(`document.querySelector('.phone-sound-toggle').click()`, true);
    await wait(
      () => inspect(`document.querySelector('.phone-preview').dataset.sound === 'on'`),
      '重新开启手机声音',
    );
    assert.equal(await inspect(`window.__phoneAudioProbe.played`), mutedPlays);
    await command({ action: 'output', open: true });
    getOutput()!.webContents.setAudioMuted(true);
    const outputChain = () =>
      getOutput()?.webContents.mainFrame.frames.find((f) => f.name === chain);
    await wait(
      async () =>
        outputChain()?.executeJavaScript(`!!document.querySelector('.chain-rig')`) ?? false,
      '输出来源加载',
    );
    await checkTransparency(getOutput()!);
    await action('add', 1);
    await wait(
      async () =>
        outputChain()?.executeJavaScript(
          `Array.from(document.querySelectorAll('audio')).some(a => a.currentTime > .03 && !a.paused)`,
        ) ?? false,
      '输出窗口音效',
    );
    await wait(
      () => inspect(`window.__phoneAudioProbe.played > ${mutedPlays}`),
      '电脑输出开启时手机仍有声音',
    );
    assert.equal(
      await editorChain()!.executeJavaScript(
        `Array.from(document.querySelectorAll('audio')).every(a => a.paused)`,
      ),
      true,
      '输出开启后编辑器静音',
    );
    await command({ action: 'output', open: false });
    await command({
      action: 'settings',
      id: chain,
      values: {
        ...(await snapshot()).layers.find((v) => v.layer.id === chain)!.layer.settings,
        soundEnabled: false,
        soundVolume: 25,
      },
    });
    const plays = await editorChain()!.executeJavaScript(
      `Array.from(document.querySelectorAll('audio')).reduce((sum,a) => sum + Number(a.dataset.plays), 0)`,
    );
    const disabledPhonePlays = await inspect(`window.__phoneAudioProbe.played`);
    await action('add', 1);
    await wait(
      async () =>
        frame(chain)?.executeJavaScript(
          `document.querySelector('.chain-rig')?.dataset.renderedCount === '3'`,
        ) ?? false,
      '关闭音效后玩法继续',
    );
    assert.equal(
      await editorChain()!.executeJavaScript(
        `Array.from(document.querySelectorAll('audio')).reduce((sum,a) => sum + Number(a.dataset.plays), 0)`,
      ),
      plays,
      '音效开关立即生效',
    );
    assert.equal(
      await inspect(`window.__phoneAudioProbe.played`),
      disabledPhonePlays,
      '插件静音设置同步到手机',
    );
    await inspect(`document.querySelector('#phone-fullscreen').click()`);
    await wait(
      () => inspect(`document.querySelector('.phone-preview')?.classList.contains('immersive')`),
      '全屏模式',
    );
    phone.setContentSize(844, 390);
    const doc = (await snapshot()).document;
    await command({
      action: 'configure',
      name: doc.name,
      revision: doc.revision,
      width: 1920,
      height: 1080,
      background: 'transparent',
    });
    await wait(
      () =>
        inspect(
          `document.querySelector('.scene-stage')?.style.width === '1920px' && innerWidth === 844`,
        ),
      '横版自动适配',
    );
    const bounds = await inspect(
      `(() => {const a=document.querySelector('.phone-scene-fit').getBoundingClientRect();const b=document.querySelector('.scene-stage').getBoundingClientRect();return {width:a.width,height:a.height,stageWidth:b.width,stageHeight:b.height}})()`,
    );
    assert.ok(bounds.width <= 844 && bounds.height <= 390);
    assert.ok(Math.abs(bounds.width / bounds.height - 16 / 9) < 0.01);
    assert.ok(Math.abs(bounds.stageWidth - bounds.width) < 0.1);
    await capture(phone, 'mobile-landscape');
    await checkChainPixels();
    // Refresh / reconnect rebuilds the current scene without altering the host.
    await phone.loadURL(url);
    await wait(
      () => inspect(`document.querySelector('.scene-stage')?.style.width === '1920px'`),
      '重新连接最新场景',
    );
    assert.equal((await snapshot()).layers.length, 6);
    assert.equal(
      await inspect(`document.querySelector('.phone-preview').dataset.sound`),
      'off',
      '刷新后需要重新点按开启声音',
    );
    assert.equal((await snapshot()).outputOpen, false, '手机预览不依赖独立输出窗口');
    await evaluate(`window.studio.mobilePreview('stop')`);
    await wait(
      () => inspect(`document.querySelector('.phone-preview')?.dataset.connection === 'ended'`),
      '停止分享通知',
    );
    assert.equal(await inspect(`document.querySelectorAll('iframe').length`), 0);
    return {
      qr: true,
      independentStatusPanel: true,
      portrait: true,
      landscape: bounds,
      image: true,
      video: true,
      textLiveUpdate: true,
      mediaContinuity: true,
      events: true,
      completionInterrupt: true,
      reconnect: true,
      readonly: true,
      revoke: true,
      transparentInstructions: true,
      audio: {
        bind: true,
        fracture: true,
        singleOutput: true,
        toggle: true,
        phoneOptIn: true,
        phonePlayback: true,
        noHistoryReplay: true,
      },
    };
  } finally {
    dialog.showOpenDialog = originalDialog;
    await evaluate(`window.studio.mobilePreview('stop')`).catch(() => {});
    phone.destroy();
  }
}
