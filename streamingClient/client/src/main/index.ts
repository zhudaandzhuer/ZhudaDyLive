import {
  app,
  dialog,
  BrowserWindow,
  Menu,
  ipcMain,
  protocol,
  safeStorage,
  screen,
  session,
  globalShortcut,
} from 'electron';
import { join, extname, resolve, sep } from 'node:path';
import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  APP_VERSION,
  commandSchema,
  type CatalogItem,
  type GameState,
  type StudioSnapshot,
  type StudioCommand,
} from '@zhuda/contracts';
import {
  LocalStore,
  decodeGift,
  decodeMetric,
  installPackage,
  verifyInstalled,
  verifyCatalog,
  safeAssetPath,
  protocolRoot,
} from '@zhuda/core';
import { DouyinCollector } from './collector';
import { LocalWorkspace } from './workspace';
import { diagnosticReport } from './diagnostics';
import { ObservationJournal } from './observations';
import { GiftCatalogClient } from './gift-catalog';
import { GiftIconCache } from './gift-icons';
import { PluginManager } from './plugins/manager';
import { pluginCommand, pluginId } from '@zhuda/contracts';
import { SceneManager } from './scenes/manager';
import { SceneHotkeys } from './scenes/hotkeys';
import { SceneMedia } from './scenes/media';
import { exportSceneArchive, importSceneArchive } from './scenes/archive';
import { sceneOutputGeometry } from './scenes/output-resolution';
import { MobilePreview } from './scenes/mobile-preview';
import { sceneCommand, type PluginCatalogItem } from '@zhuda/contracts';

declare const __PUBLIC_KEY__: string;
declare const __DEVELOPMENT__: boolean;

app.commandLine.appendSwitch('lang', 'zh-CN');

if (__DEVELOPMENT__)
  app.setPath(
    'userData',
    process.env.LIVE_CLIENT_DATA_DIR ||
      (app.isPackaged
        ? join(app.getPath('appData'), 'ZhudaLive-Dev')
        : resolve(__dirname, '../..', '.local/client')),
  );
protocol.registerSchemesAsPrivileged([
  { scheme: 'zhuda-game', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  {
    scheme: 'zhuda-scene',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
  {
    scheme: 'zhuda-plugin',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
let mainWindow: BrowserWindow | null = null,
  output: BrowserWindow | null = null;
let outputContext: {
  mode: 'live' | 'demo';
  product: string;
  version: string;
  receipt: CatalogItem;
} | null = null;
let scenes: SceneManager;
let sceneHotkeys: SceneHotkeys;
let sceneMedia: SceneMedia;
let mobilePreview: MobilePreview;
let sceneOutput: BrowserWindow | null = null;
let store: LocalStore, workspace: LocalWorkspace, collector: DouyinCollector;
let currentMode: 'live' | 'demo' = 'demo';
let background: GameState['background'] = 'green';
let outputLayout: StudioSnapshot['outputLayout'] = 'landscape';
let publishTimer: NodeJS.Timeout | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let snapshotSequence = 0;
let giftCatalog: GiftCatalogClient;
let giftIcons: GiftIconCache;
let plugins: PluginManager;
let maintenanceTimer: NodeJS.Timeout | null = null;
let commandChain: Promise<unknown> = Promise.resolve();
let shuttingDown = false;
const observations = new ObservationJournal();
const installed = () => store.get<Record<string, CatalogItem>>('installed', {});
const packagesRoot = () => join(app.getPath('userData'), 'packages');
const packagePath = (id: string, version: string) => join(packagesRoot(), id, version);
const protect = (text: string) => {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  )
    throw new Error('系统安全保存尚未就绪，无法保存本机登录会话');
  return safeStorage.encryptString(text).toString('base64');
};
const unprotect = (text: string) => safeStorage.decryptString(Buffer.from(text, 'base64'));
function gameState(mode = outputContext?.mode ?? currentMode): GameState {
  const round = store.round(mode),
    recent = store.actions(round?.id);
  return { round, recent, lastAction: recent[0] ?? null, background };
}
function sceneSnapshot(outputOpen = !!sceneOutput && !sceneOutput.isDestroyed()) {
  const state = scenes.snapshot(outputOpen);
  sceneHotkeys?.sync(state);
  state.hotkeys = sceneHotkeys?.snapshot() ?? [];
  return state;
}
function snapshot(sceneState?: StudioSnapshot['scene']): StudioSnapshot {
  const installs = installed(),
    round = store.round(currentMode);
  return {
    sequence: ++snapshotSequence,
    appVersion: APP_VERSION,
    platform: process.platform,
    deviceId: workspace.deviceId,
    development: __DEVELOPMENT__,
    tutorialDismissed: store.get<boolean>('tutorial-dismissed', false) === true,
    plugins: plugins?.snapshot(),
    scene: sceneState ?? (scenes ? sceneSnapshot() : undefined),
    collector: { ...collector.status },
    observations: observations.snapshot(collector.runId),
    giftCatalog: giftCatalog.snapshot(),
    library: workspace.catalog.map((item) => ({
      manifest: item.manifest,
      installedVersion: installs[item.manifest.id]?.manifest.version ?? null,
      configuration: installs[item.manifest.id]
        ? store.configuration(installs[item.manifest.id]!.manifest)
        : null,
    })),
    gifts: store.gifts(),
    round,
    actions: store.actions(round?.id),
    outputOpen: !!output && !output.isDestroyed(),
    background,
    outputLayout,
  };
}
function publish(immediate = false) {
  if (shuttingDown || !store || !workspace || !collector) return;
  const send = () => {
    publishTimer = null;
    const state = scenes ? sceneSnapshot() : undefined;
    if (
      state &&
      sceneOutput &&
      !sceneOutput.isDestroyed() &&
      !sceneOutput.webContents.isDestroyed()
    )
      sceneOutput.webContents.send('scene:update', state);
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
      mainWindow.webContents.send('studio:update', snapshot(state));
    if (output && !output.isDestroyed()) output.webContents.send('game:update', gameState());
    if (state) {
      const giftIds = new Set(state.document.layers.flatMap((l) => l.rules.map((r) => r.giftId)));
      giftIcons?.ensure(giftCatalog.snapshot().gifts.filter((g) => giftIds.has(g.id)));
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
        mainWindow.webContents.send('scene:update', state);
      mobilePreview?.publish();
    }
  };
  if (immediate) {
    if (publishTimer) clearTimeout(publishTimer);
    send();
  } else if (!publishTimer) publishTimer = setTimeout(send, 150);
}
function requireMain(senderId: number) {
  if (!mainWindow || senderId !== mainWindow.webContents.id) throw new Error('不允许的工作台请求');
}
function requireOutput(senderId: number) {
  if (!output || senderId !== output.webContents.id) throw new Error('不允许的游戏请求');
}

async function openSceneOutput() {
  if (sceneOutput && !sceneOutput.isDestroyed()) {
    sceneOutput.showInactive();
    return;
  }
  const doc = scenes.snapshot().document;
  const display = screen.getDisplayMatching(mainWindow!.getBounds());
  const geometry = sceneOutputGeometry(doc, display.scaleFactor);
  const window = new BrowserWindow({
    title: '猪大直播 · 场景输出',
    width: geometry.width,
    height: geometry.height,
    x: display.workArea.x + Math.max(0, Math.round((display.workArea.width - geometry.width) / 2)),
    y:
      display.workArea.y + Math.max(0, Math.round((display.workArea.height - geometry.height) / 2)),
    useContentSize: true,
    enableLargerThanScreen: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    hasShadow: false,
    roundedCorners: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'scene-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      // Isolate output zoom from the editor, which loads the same renderer origin.
      partition: 'zhuda-scene-output',
      autoplayPolicy: 'no-user-gesture-required',
      zoomFactor: geometry.zoomFactor,
    },
  });
  sceneOutput = window;
  let closing = false;
  window.once('close', () => (closing = true));
  window.setMenu(null);
  const syncResolution = () => syncSceneOutputResolution(window);
  window.on('move', syncResolution);
  window.on('resize', syncResolution);
  screen.on('display-metrics-changed', syncResolution);
  window.webContents.on('did-finish-load', syncResolution);
  window.webContents.setIgnoreMenuShortcuts(true);
  void window.webContents.setVisualZoomLevelLimits(1, 1);
  window.on('page-title-updated', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      window.close();
    }
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
    }
  });
  window.on('closed', () => {
    screen.removeListener('display-metrics-changed', syncResolution);
    if (sceneOutput === window) sceneOutput = null;
    publish(true);
  });
  try {
    const devURL = __DEVELOPMENT__ ? process.env.ELECTRON_RENDERER_URL : undefined;
    if (devURL) {
      const url = new URL(devURL);
      if (url.hostname !== '127.0.0.1') throw new Error('开发页面须使用本机网址');
      url.searchParams.set('output', 'scene');
      await window.loadURL(url.toString());
    } else
      await window.loadFile(join(__dirname, 'renderer/index.html'), { query: { output: 'scene' } });
  } catch (error) {
    if (closing || window.isDestroyed()) return;
    window.destroy();
    throw error;
  }
  if (closing || window.isDestroyed()) return;
  syncResolution();
  window.showInactive();
  publish(true);
}

function syncSceneOutputResolution(window: BrowserWindow) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  const doc = scenes.snapshot().document;
  const display = screen.getDisplayMatching(window.getBounds());
  const geometry = sceneOutputGeometry(doc, display.scaleFactor);
  if (Math.abs(window.webContents.getZoomFactor() - geometry.zoomFactor) > 0.0001)
    window.webContents.setZoomFactor(geometry.zoomFactor);
  const [width, height] = window.getContentSize();
  if (width !== geometry.width || height !== geometry.height)
    window.setContentSize(geometry.width, geometry.height);
}

async function openOutput() {
  const round = store.round(currentMode);
  if (!round) throw new Error('请先开始试玩或正式回合');
  // A running round keeps its signed version even after a newer built-in pack is installed.
  const receiptFile = join(packagePath(round.product, round.packageVersion), '.receipt.json');
  const receipt = existsSync(receiptFile)
    ? verifyCatalog(JSON.parse(readFileSync(receiptFile, 'utf8')), __PUBLIC_KEY__)
    : null;
  if (
    !receipt ||
    receipt.manifest.id !== round.product ||
    receipt.manifest.version !== round.packageVersion
  )
    throw new Error('找不到此回合固定的游戏版本');
  verifyInstalled(packagePath(round.product, round.packageVersion), receipt, __PUBLIC_KEY__);
  if (round.mode === 'live') if (output && !output.isDestroyed()) output.destroy();
  outputContext = {
    mode: currentMode,
    product: round.product,
    version: round.packageVersion,
    receipt,
  };
  const area = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds()).workAreaSize
    : screen.getPrimaryDisplay().workAreaSize;
  const portrait = outputLayout === 'portrait';
  const unitsX = portrait ? 9 : 16,
    unitsY = portrait ? 16 : 9;
  const unit = Math.floor(
    Math.min(portrait ? 60 : 80, (area.width - 24) / unitsX, (area.height - 24) / unitsY),
  );
  const window = new BrowserWindow({
    title: '猪大直播 · 游戏输出',
    width: unit * unitsX,
    height: unit * unitsY,
    minWidth: portrait ? 270 : 480,
    minHeight: portrait ? 480 : 270,
    frame: false,
    hasShadow: false,
    roundedCorners: false,
    transparent: background === 'transparent',
    backgroundColor:
      background === 'transparent' ? '#00000000' : background === 'green' ? '#00ff00' : '#111714',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'game-preload.cjs'),
      autoplayPolicy: 'no-user-gesture-required',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.setAspectRatio(unitsX / unitsY);
  output = window;
  window.on('page-title-updated', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      window.close();
    }
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
  });
  window.on('closed', () => {
    if (output === window) {
      output = null;
      outputContext = null;
      publish();
    }
  });
  await window.loadURL(`zhuda-game://${round.product}/index.html`);
  publish(true);
}

async function command(input: StudioCommand): Promise<StudioSnapshot> {
  switch (input.type) {
    case 'tutorialPreference':
      store.set('tutorial-dismissed', input.dismissed);
      break;
    case 'login':
      await collector.login();
      break;
    case 'monitor':
      await collector.start(input.room);
      store.set('room', collector.status.webId);
      break;
    case 'stopMonitor':
      collector.stop();
      break;
    case 'showCollector':
      collector.show();
      break;
    case 'install': {
      const item = workspace.catalog.find((p) => p.manifest.id === input.product);
      if (!item) throw new Error('找不到此玩法');
      if (
        ['live', 'demo'].some((mode) => {
          const round = store.round(mode as 'live' | 'demo');
          return round?.status === 'running' && round.product === input.product;
        })
      )
        throw new Error('请在此玩法回合结束后更新游戏包');
      const bytes = await workspace.download(item);
      installPackage(packagesRoot(), bytes, item, __PUBLIC_KEY__);
      store.set('installed', { ...installed(), [item.manifest.id]: item });
      break;
    }
    case 'startRound': {
      const item = installed()[input.product];
      if (!item) throw new Error('请先下载此玩法');
      verifyInstalled(packagePath(input.product, item.manifest.version), item, __PUBLIC_KEY__);
      if (input.mode === 'live') {
        if (collector.status.state !== 'connected') throw new Error('请先连上抖音直播数据流');
      }
      store.startRound(
        item.manifest,
        input.mode,
        input.mode === 'live' ? collector.status.webId : 'demo',
        input.initial,
      );
      currentMode = input.mode;
      store.set('selected-mode', currentMode);
      await openOutput();
      break;
    }
    case 'stopRound':
      store.stopRound(currentMode);
      output?.close();
      break;
    case 'selectTheme':
    case 'saveGiftRules': {
      const selected = installed()[input.product];
      const active = (['live', 'demo'] as const).some((mode) => {
        const round = store.round(mode);
        return (
          round &&
          round.status !== 'stopped' &&
          round.product === input.product &&
          round.packageVersion === input.packageVersion
        );
      });
      if (selected?.manifest.version !== input.packageVersion && !active)
        throw new Error('玩法版本已变更，请重新打开玩法设置');
      const path = packagePath(input.product, input.packageVersion);
      const receipt = verifyCatalog(
        JSON.parse(readFileSync(join(path, '.receipt.json'), 'utf8')),
        __PUBLIC_KEY__,
      );
      if (
        receipt.manifest.id !== input.product ||
        receipt.manifest.version !== input.packageVersion
      )
        throw new Error('玩法版本不符');
      verifyInstalled(path, receipt, __PUBLIC_KEY__);
      if (input.type === 'selectTheme') {
        store.configureTheme(receipt.manifest, input.theme);
        break;
      }
      const known = new Map([
        ...store
          .configuration(receipt.manifest)
          .rules.map((rule) => [rule.giftId, rule.giftName] as const),
        ...receipt.manifest.rules.map((rule) => [rule.giftId, rule.giftName] as const),
        ...giftCatalog.snapshot().gifts.map((gift) => [gift.id, gift.name] as const),
      ]);
      store.configureRules(
        receipt.manifest,
        input.rules.map((rule) => {
          const name = known.get(rule.giftId);
          if (!name) throw new Error('找不到此礼物，请重新打开设置选择礼物');
          return { ...rule, giftName: name };
        }),
      );
      break;
    }
    case 'simulate':
      if (currentMode !== 'demo') throw new Error('试送只适用试玩回合');
      store.simulate(input.giftId, input.quantity);
      break;
    case 'output':
      background = input.background;
      store.set('background', background);
      if (input.layout) {
        outputLayout = input.layout;
        store.set('output-layout', outputLayout);
      }
      await openOutput();
      break;
    case 'closeOutput':
      output?.close();
      break;
    case 'exportDiagnostics': {
      const choice = await dialog.showSaveDialog(mainWindow!, {
        title: '导出诊断报告',
        defaultPath: `猪大直播诊断-${Date.now()}.json`,
        filters: [{ name: '诊断报告', extensions: ['json'] }],
      });
      if (!choice.canceled && choice.filePath)
        writeFileSync(
          choice.filePath,
          JSON.stringify(
            {
              ...diagnosticReport(snapshot()),
              metrics: app
                .getAppMetrics()
                .map((metric) => ({ type: metric.type, cpu: metric.cpu, memory: metric.memory })),
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
      break;
    }
  }
  publish(true);
  return snapshot();
}

async function createStudioWindow() {
  const window = new BrowserWindow({
    title: '猪大直播工作台',
    width: 1440,
    height: 960,
    minWidth: 1020,
    minHeight: 720,
    backgroundColor: '#111111',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'studio-preload.cjs'),
      autoplayPolicy: 'no-user-gesture-required',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow = window;
  const releaseHotkeyCapture = () => {
    sceneHotkeys?.capture(false);
    publish();
  };
  window.on('blur', releaseHotkeyCapture);
  window.webContents.on('render-process-gone', releaseHotkeyCapture);
  window.webContents.on('did-navigate', releaseHotkeyCapture);
  if (
    __DEVELOPMENT__ &&
    (process.env.LIVE_SCENE_SMOKE_REPORT ||
      process.env.LIVE_PLUGIN_SMOKE_REPORT ||
      process.env.LIVE_SMOKE_REPORT)
  )
    window.webContents.on('console-message', (_event, ...details) =>
      console.log('scene-renderer', ...details),
    );
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('closed', () => {
    mainWindow = null;
    if (!shuttingDown) app.quit();
  });
  const devURL = __DEVELOPMENT__ ? process.env.ELECTRON_RENDERER_URL : undefined;
  if (devURL) {
    const url = new URL(devURL);
    if (url.hostname !== '127.0.0.1') throw new Error('开发页面须使用本机网址');
    await window.loadURL(devURL);
  } else await window.loadFile(join(__dirname, 'renderer/index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === 'darwin'
            ? [
                {
                  label: '猪大直播',
                  submenu: [
                    { role: 'about' as const, label: '关于猪大直播' },
                    { type: 'separator' as const },
                    { role: 'hide' as const, label: '隐藏工作台' },
                    { role: 'hideOthers' as const, label: '隐藏其他应用' },
                    { role: 'unhide' as const, label: '显示全部' },
                    { type: 'separator' as const },
                    { role: 'quit' as const, label: '退出' },
                  ],
                },
              ]
            : []),
          {
            label: '文件',
            submenu: [
              { role: 'close', label: '关闭窗口' },
              ...(process.platform !== 'darwin' ? [{ role: 'quit' as const, label: '退出' }] : []),
            ],
          },
          {
            label: '编辑',
            submenu: [
              { role: 'undo', label: '撤销' },
              { role: 'redo', label: '重做' },
              { type: 'separator' },
              { role: 'cut', label: '剪切' },
              { role: 'copy', label: '复制' },
              { role: 'paste', label: '粘贴' },
              { role: 'selectAll', label: '全选' },
            ],
          },
          {
            label: '视图',
            submenu: [
              {
                label: '实际大小',
                accelerator: 'CommandOrControl+0',
                click: () => mainWindow?.webContents.setZoomLevel(0),
              },
              {
                label: '放大',
                accelerator: 'CommandOrControl+Plus',
                click: () => {
                  if (mainWindow)
                    mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 1);
                },
              },
              {
                label: '缩小',
                accelerator: 'CommandOrControl+-',
                click: () => {
                  if (mainWindow)
                    mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 1);
                },
              },
              {
                label: '切换全屏',
                accelerator: process.platform === 'darwin' ? 'Control+Command+F' : 'F11',
                click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()),
              },
            ],
          },
          {
            label: '窗口',
            submenu: [
              { role: 'minimize', label: '最小化' },
              { role: 'zoom', label: '缩放窗口' },
              { role: 'front', label: '前置全部窗口' },
            ],
          },
        ]),
      );
      mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
      store = new LocalStore(join(app.getPath('userData'), 'studio.sqlite'));
      giftCatalog = new GiftCatalogClient(store, () => publish(), fetch);
      const device = store.get<string>('device-id', randomUUID());
      store.set('device-id', device);
      currentMode = store.get<'live' | 'demo'>('selected-mode', 'demo');
      background = store.get<GameState['background']>('background', 'green');
      outputLayout =
        store.get<string>('output-layout', 'landscape') === 'portrait' ? 'portrait' : 'landscape';
      workspace = new LocalWorkspace(store, __PUBLIC_KEY__, device);
      collector = new DouyinCollector(
        () => {
          observations.recordStatus(collector.status);
          if (collector.status.state === 'stopped') scenes?.resetEventSession();
          scenes?.reconcile();
          scenes?.event({
            id: randomUUID(),
            kind: 'status',
            source: 'live',
            webId: collector.status.webId,
            at: new Date().toISOString(),
            data: { state: collector.status.state, message: collector.status.message },
          });
          publish();
        },
        (message, context) => {
          observations.recordMessage(message, context);
          if (message.method !== 'WebcastGiftMessage') {
            const metric = decodeMetric(message);
            scenes?.event({
              id: context.runId + ':' + (metric?.messageId ?? (message.messageId || randomUUID())),
              kind: 'message',
              source: 'live',
              webId: context.webId,
              at: new Date().toISOString(),
              data: {
                method: message.method,
                bytes: message.payload.length,
                messageId: message.messageId,
                ...metric,
              },
            });
            publish();
            return;
          }
          try {
            const gift = decodeGift(message.payload, {
              ...context,
              source: 'live',
              messageId: message.messageId,
            });
            if (gift.quality === 'parse_error') {
              collector.status.parseErrors++;
              collector.status.partial = true;
            }
            store.ingest(gift, message.payload, scenes ? (gift) => scenes.ingest(gift) : undefined);
            publish();
          } catch {
            collector.status.partial = true;
            collector.status.message = '礼物保存失败，本次数据可能不完整';
            publish();
          }
        },
        (cookies) => store.set('douyin-session', protect(JSON.stringify(cookies))),
      );
      const cookies = store.get<string | null>('douyin-session', null);
      if (cookies) {
        try {
          await collector.restore(JSON.parse(unprotect(cookies)));
        } catch {
          collector.status.message = '本机登录数据无法加载，请重新扫码';
        }
      }
      plugins = new PluginManager(
        store,
        join(app.getPath('userData'), 'plugins'),
        () => publish(),
        () => mainWindow,
      );
      protocol.handle('zhuda-plugin', (request) => plugins.serve(request));
      session
        .fromPartition('zhuda-scene-output')
        .protocol.handle('zhuda-plugin', (request) => plugins.serve(request));
      const bundled = join(__dirname, 'bundled');
      const bundledCatalog = JSON.parse(
        readFileSync(join(bundled, 'catalog.json'), 'utf8'),
      ) as CatalogItem[];
      workspace.useBundled(bundledCatalog, (item) =>
        readFileSync(join(bundled, `${item.manifest.id}-${item.manifest.version}.zip`)),
      );
      const installs = installed();
      for (const item of bundledCatalog) {
        verifyCatalog(item, __PUBLIC_KEY__);
        const previous = installs[item.manifest.id];
        const versionParts = item.manifest.version.split('.').map(BigInt);
        const oldParts = previous?.manifest.version.split('.').map(BigInt);
        const firstDifferent = oldParts
          ? versionParts.findIndex((part, index) => part !== oldParts[index])
          : -1;
        if (
          !previous ||
          (oldParts &&
            firstDifferent >= 0 &&
            versionParts[firstDifferent]! > oldParts[firstDifferent]!)
        ) {
          installPackage(
            packagesRoot(),
            readFileSync(join(bundled, `${item.manifest.id}-${item.manifest.version}.zip`)),
            item,
            __PUBLIC_KEY__,
          );
          installs[item.manifest.id] = item;
        }
      }
      store.set('installed', installs);
      const sceneCatalog = JSON.parse(
        readFileSync(join(__dirname, 'bundled-plugins/catalog.json'), 'utf8'),
      ) as PluginCatalogItem[];
      plugins.useBundled(
        sceneCatalog.map((item) => ({
          item,
          bytes: readFileSync(
            join(__dirname, 'bundled-plugins', `${item.manifest.id}-${item.manifest.version}.zip`),
          ),
        })),
      );
      sceneMedia = new SceneMedia(join(app.getPath('userData'), 'scene-assets'));
      giftIcons = new GiftIconCache(store, sceneMedia, () => publish());
      scenes = new SceneManager(
        store,
        plugins,
        () => collector.status,
        (id) => {
          const gift = giftCatalog.snapshot().gifts.find((g) => g.id === id);
          return gift ? { name: gift.name, icon: giftIcons.cached(gift) } : undefined;
        },
      );
      // Every interactive layer is armed on launch; no previous room or per-plugin
      // trial session is allowed to survive into the next live stream.
      scenes.armAll();
      sceneHotkeys = new SceneHotkeys(
        globalShortcut,
        async (input) => {
          if (shuttingDown) throw new Error('工作台已关闭');
          // Gift input already updates scenes synchronously. Keyboard input must
          // also reach the scene while an editor dialog or download is pending.
          scenes.command(input);
          publish(true);
        },
        () => publish(),
      );
      mobilePreview = new MobilePreview({
        assets: join(__dirname, 'mobile-preview'),
        snapshot: () => {
          return scenes.snapshot();
        },
        plugin: (request) => plugins.serve(request),
        media: (request) => sceneMedia.serve(request),
      });
      protocol.handle('zhuda-scene', (request) => sceneMedia.serve(request));
      session
        .fromPartition('zhuda-scene-output')
        .protocol.handle('zhuda-scene', (request) => sceneMedia.serve(request));
      store.retain();
      protocol.handle('zhuda-game', (request) => {
        try {
          const url = new URL(request.url),
            context = outputContext;
          const asset = decodeURIComponent(url.pathname.slice(1));
          const receipt = context?.receipt;
          if (
            !context ||
            !receipt ||
            url.hostname !== context.product ||
            !safeAssetPath(asset) ||
            !Object.hasOwn(receipt.manifest.files, asset)
          )
            return new Response('Not found', { status: 404 });
          const directory = packagePath(context.product, context.version),
            path = resolve(directory, asset);
          if (!path.startsWith(resolve(directory) + sep))
            return new Response('Forbidden', { status: 403 });
          const mime: Record<string, string> = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.json': 'application/json',
            '.woff2': 'font/woff2',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
          };
          return new Response(new Uint8Array(readFileSync(path)), {
            headers: {
              'Content-Type': mime[extname(path)] || 'application/octet-stream',
              'Content-Security-Policy':
                "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'",
              'X-Content-Type-Options': 'nosniff',
            },
          });
        } catch {
          return new Response('Not found', { status: 404 });
        }
      });
      ipcMain.handle('studio:snapshot', (event) => {
        requireMain(event.sender.id);
        return snapshot();
      });
      ipcMain.handle('studio:command', (event, input: unknown) => {
        requireMain(event.sender.id);
        const parsed = commandSchema.parse(input);
        // Account windows and collection controls must remain available during pending commands.
        if (
          parsed.type === 'login' ||
          parsed.type === 'stopMonitor' ||
          parsed.type === 'showCollector'
        )
          return command(parsed);
        const task = commandChain.then(() => command(parsed));
        commandChain = task.catch(() => {});
        return task;
      });
      ipcMain.handle('plugins:command', (event, input: unknown) => {
        requireMain(event.sender.id);
        const parsed = pluginCommand.parse(input);
        const task = commandChain.then(async () => {
          await plugins.command(parsed);
          scenes.reconcile();
          publish(true);
          return snapshot();
        });
        commandChain = task.catch(() => {});
        return task;
      });
      ipcMain.handle('plugins:request', (event, id: unknown, input: unknown) => {
        requireMain(event.sender.id);

        return plugins.request(pluginId.parse(id), input);
      });
      ipcMain.handle('scene:source-error', (event, id: unknown, message: unknown) => {
        if (
          event.sender.id !== mainWindow?.webContents.id &&
          event.sender.id !== sceneOutput?.webContents.id
        )
          throw new Error('不允许的场景请求');

        if (typeof id !== 'string' || typeof message !== 'string' || message.length > 500)
          throw new Error('来源错误格式无效');
        scenes.reportFailure(id, message);
        publish(true);
      });
      ipcMain.handle('scene:snapshot', (event) => {
        if (
          event.sender.id !== mainWindow?.webContents.id &&
          event.sender.id !== sceneOutput?.webContents.id
        )
          throw new Error('不允许的场景请求');

        return sceneSnapshot();
      });
      ipcMain.handle('scene:hotkey-capture', (event, active: unknown) => {
        requireMain(event.sender.id);

        if (typeof active !== 'boolean') throw new Error('热键录制状态无效');
        sceneHotkeys.capture(active && !!mainWindow?.isFocused());
        publish(true);
      });
      ipcMain.handle('scene:mobile-preview', (event, action: unknown) => {
        requireMain(event.sender.id);
        if (!['start', 'stop', 'status'].includes(String(action)))
          throw new Error('手机预览操作无效');
        const task = commandChain.then(async () => {
          if (shuttingDown) throw new Error('工作台已关闭');

          if (action === 'stop') mobilePreview.stop();
          return action === 'start' ? mobilePreview.start() : mobilePreview.status();
        });
        commandChain = task.catch(() => {});
        return task;
      });
      ipcMain.handle('scene:command', (event, input: unknown) => {
        requireMain(event.sender.id);
        const parsed = sceneCommand.parse(input);
        const task = commandChain.then(async () => {
          const beforeSceneId = scenes.snapshot().document.id;
          if (parsed.sceneId && parsed.sceneId !== beforeSceneId)
            throw new Error('当前场景已切换，请重新操作');
          if (parsed.action === 'output') {
            if (parsed.open) await openSceneOutput();
            else sceneOutput?.close();
          } else if (parsed.action === 'exportScene') {
            const choice = await dialog.showSaveDialog(mainWindow!, {
              title: '导出当前场景',
              defaultPath: `${scenes.snapshot().document.name.replace(/[\\/:*?"<>|]/g, '_')}.zhudascene`,
              filters: [{ name: '猪大场景包', extensions: ['zhudascene'] }],
            });
            if (!choice.canceled && choice.filePath) {
              writeFileSync(
                choice.filePath,
                exportSceneArchive(scenes.snapshot().document, sceneMedia),
                { mode: 0o600 },
              );
            }
          } else if (parsed.action === 'importScene') {
            const choice = await dialog.showOpenDialog(mainWindow!, {
              title: '导入场景包',
              properties: ['openFile'],
              filters: [{ name: '猪大场景包', extensions: ['zhudascene'] }],
            });
            if (!choice.canceled && choice.filePaths[0]) {
              if (statSync(choice.filePaths[0]).size > 301 * 1024 * 1024)
                throw new Error('场景包超过 300 MB');
              const document = importSceneArchive(readFileSync(choice.filePaths[0]), sceneMedia);
              scenes.importDocument(document);
              sceneOutput?.close();
            }
          } else if (parsed.action === 'importMedia') {
            const state = scenes.snapshot();
            const view = state.layers.find((l) => l.layer.id === parsed.id);
            const parameter = view?.source?.parameters.find((p) => p.key === parsed.key);
            if (!view || !parameter || !['image', 'video'].includes(parameter.type))
              throw new Error('素材参数无效');
            const type = parameter.type as 'image' | 'video';
            const choice = await dialog.showOpenDialog(mainWindow!, {
              title: type === 'image' ? '选择图片' : '选择视频',
              properties: ['openFile'],
              filters: [
                {
                  name: type === 'image' ? '图片' : '视频',
                  extensions:
                    type === 'image' ? ['png', 'jpg', 'jpeg', 'webp', 'gif'] : ['mp4', 'webm'],
                },
              ],
            });
            if (!choice.canceled && choice.filePaths[0]) {
              const url = sceneMedia.import(choice.filePaths[0], type);
              scenes.command({
                action: 'settings',
                sceneId: state.document.id,
                id: parsed.id,
                values: { [parsed.key]: url },
              });
            }
          } else {
            scenes.command(parsed);
            if (beforeSceneId !== scenes.snapshot().document.id) sceneOutput?.close();
            if (parsed.action === 'configure' && sceneOutput) {
              syncSceneOutputResolution(sceneOutput);
            }
          }
          publish(true);
          return snapshot();
        });
        commandChain = task.catch(() => {});
        return task;
      });
      ipcMain.handle('game:snapshot', (event) => {
        requireOutput(event.sender.id);

        return gameState();
      });
      await createStudioWindow();
      // The workspace is local-first. Gift metadata may refresh when available,
      // but plugins are discovered exclusively from the local inbox.
      void giftCatalog.refresh();
      void plugins.sync();
      refreshTimer = setInterval(() => {
        void giftCatalog.refresh();
        void plugins.sync();
      }, 60 * 60_000);
      publish(true);
      let lastRetention = Date.now();
      maintenanceTimer = setInterval(() => {
        if (scenes.reconcile()) publish();
        if (Date.now() - lastRetention >= 86400_000) {
          store.retain();
          lastRetention = Date.now();
        }
      }, 1000);
      app.on('activate', () => {
        if (!mainWindow) void createStudioWindow();
      });
      if (__DEVELOPMENT__ && process.env.LIVE_SMOKE_REPORT) {
        const { enterWorkspace } = await import('../../../tests/electron/entry-smoke');
        const { checkTutorial } = await import('../../../tests/electron/tutorial-smoke');
        const { checkThemes } = await import('../../../tests/electron/theme-smoke');
        const { checkChainTransitions } =
          await import('../../../tests/electron/chain-transition-smoke');
        const { chainStrand } = await import('../../../games/shared/chain-layout');
        const report = process.env.LIVE_SMOKE_REPORT;
        const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
        await enterWorkspace(mainWindow!);
        const tutorialCheck = await checkTutorial(mainWindow!);
        const inspect = (script: string) => output!.webContents.executeJavaScript(script);
        const settledChainEffects = async () => {
          for (let attempt = 0; attempt < 250; attempt++) {
            if (
              await inspect(
                `document.querySelector('.chain-motion')?.dataset.renderedCount === '0'`,
              )
            )
              return;
            await pause(40);
          }
          throw new Error('锁链动画未完整结束');
        };
        const readyOutput = async () => {
          const expected = BigInt(snapshot().round!.remaining).toLocaleString('en-US');
          for (let attempt = 0; attempt < 60; attempt++) {
            if (
              await inspect(`(() => {
              const canvas = document.querySelector('.chain-rig');
              return document.querySelector('#remaining')?.textContent === ${JSON.stringify(expected)}
                && canvas?.dataset.renderedCount === ${JSON.stringify(snapshot().round!.remaining)};
            })()`)
            ) {
              await inspect(`(async () => {
                await document.fonts.ready;
                const steel = new Image(); steel.src = 'chain-steel.png'; await steel.decode();
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              })()`);
              return;
            }
            await pause(50);
          }
          throw new Error('输出窗口未加载目前回合');
        };
        const inspectLayout = () =>
          inspect(`(() => {
            const hud = document.querySelector('.chain-hud').getBoundingClientRect();
            const canvas = document.querySelector('.chain-rig');
            const faceCovered = ['.chain-rig','.chain-motion'].some(selector => {
              const layer=document.querySelector(selector);
              const pixels=layer.getContext('2d').getImageData(
                Math.ceil(layer.width*.16)+1,0,Math.floor(layer.width*.68)-2,Math.floor(layer.height*.5)-1).data;
              return pixels.some((value,index)=>index%4===3 && value>0);
            });
            const uiClear = [.4, .5, .6].every(x => [.2, .4].every(y =>
              !document.elementsFromPoint(innerWidth * x, innerHeight * y)
                .some(element => element.matches('.chain-hud, .counter'))));
            return { width: innerWidth, height: innerHeight,
              hud: { x: hud.x, y: hud.y, width: hud.width, height: hud.height, bottom: hud.bottom },
              strands: Number(canvas.dataset.renderedCount), target: canvas.dataset.targetCount, faceCovered, uiClear };
          })()`);
        const inspectImpacts = async () => {
          const positions =
            await inspect(`Array.from(document.querySelectorAll('.effect-burst')).map(burst =>
            ({ id: burst.dataset.chainId, x: parseFloat(burst.style.left), y: parseFloat(burst.style.top),
              width: innerWidth, height: innerHeight }))`);
          return positions.map(
            (impact: { id: string; x: number; y: number; width: number; height: number }) => {
              const strand = chainStrand(BigInt(impact.id), impact.width, impact.height);
              return {
                ...impact,
                distanceFromSteel: Math.abs(
                  -(impact.x - strand.x) * Math.sin(strand.angle) +
                    (impact.y - strand.y) * Math.cos(strand.angle),
                ),
              };
            },
          );
        };
        // Isolated profile is logged out: reaching the auth guard proves the real IPC
        // accepts the handle without opening a collector or using a real session.
        const roomInputChecks: string[] = [];
        for (const room of ['12345678demo', 'https://live.douyin.com/12345678demo']) {
          roomInputChecks.push(
            await mainWindow!.webContents.executeJavaScript(
              `window.studio.command({ type: 'monitor', room: ${JSON.stringify(room)} }).then(() => 'unexpected connection', error => error.message)`,
            ),
          );
        }
        // Exercise the real hidden Electron renderer and Network.enable ordering.
        // This isolated profile intercepts every HTTPS request with local fixtures;
        // no real login, Douyin request, or paid gift is involved.
        const probeSession = session.fromPartition('zhuda-douyin-runtime');
        const responseType = protocolRoot.lookupType('Response');
        const fixture = responseType
          .encode(
            responseType.fromObject({
              messages: [{ method: 'WebcastMemberMessage', msgId: '1', payload: new Uint8Array() }],
            }),
          )
          .finish();
        let fixtureRequests = 0;
        probeSession.protocol.handle('https', (request) => {
          const url = new URL(request.url);
          if (url.hostname !== 'live.douyin.com') return new Response('', { status: 404 });
          fixtureRequests++;
          return url.pathname === '/webcast/im/fetch/'
            ? new Response(new Uint8Array(fixture), {
                headers: { 'Content-Type': 'application/octet-stream' },
              })
            : new Response(
                '<!doctype html><title>Local collector fixture</title><script>fetch("/webcast/im/fetch/")</script>',
                { headers: { 'Content-Type': 'text/html' } },
              );
        });
        const savedCollector = { ...collector.status };
        const collectorProbe = {
          startMs: -1,
          connected: false,
          messages: 0,
          gifts: 0,
          observedMessages: [] as string[],
          fixtureRequests: 0,
          stopped: false,
        };
        try {
          collector.status.loggedIn = true;
          const startedAt = Date.now();
          await collector.start('12345678demo');
          collectorProbe.startMs = Date.now() - startedAt;
          for (let attempt = 0; attempt < 50 && collector.status.messageCount === 0; attempt++)
            await pause(100);
          collectorProbe.connected = collector.status.state === 'connected';
          collectorProbe.messages = collector.status.messageCount;
          collectorProbe.gifts = collector.status.giftCount;
          collectorProbe.observedMessages = snapshot().observations.messages.map(
            (message) => message.method,
          );
          collectorProbe.fixtureRequests = fixtureRequests;
          collector.stop();
          collectorProbe.stopped = collector.status.state === 'stopped';
        } finally {
          collector.stop();
          probeSession.protocol.unhandle('https');
          collector.status = savedCollector;
        }
        const capture = async (name: string) => {
          if (!process.env.LIVE_SMOKE_ARTIFACTS) return;
          mkdirSync(process.env.LIVE_SMOKE_ARTIFACTS, { recursive: true });
          writeFileSync(
            join(process.env.LIVE_SMOKE_ARTIFACTS, `${name}.png`),
            (await output!.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
          );
        };
        await mainWindow!.webContents.executeJavaScript(
          "window.studio.command({ type: 'startRound', product: 'game.chain', mode: 'demo', initial: '4000' })",
        );
        await pause(250);
        await capture('chain-idle');
        await mainWindow!.webContents.executeJavaScript(
          "window.studio.command({ type: 'simulate', giftId: '2001', quantity: '3' })",
        );
        await pause(300);
        const unlocking = await inspect(
          '({ effect: document.querySelector(".stage").dataset.effect, fragments: Number(document.querySelector(".chain-motion").dataset.renderedCount) * 2 })',
        );
        const unlockImpacts = await inspectImpacts();
        await capture('chain-unlock');
        const result = {
          platform: process.platform,
          tutorial: tutorialCheck,
          roomInputChecks,
          collectorProbe,
          remaining: snapshot().round?.remaining,
          output: !!output,
          title: output?.getTitle(),
          bridge: await mainWindow!.webContents.executeJavaScript('typeof window.studio?.command'),
          gameBridge: await output!.webContents.executeJavaScript(
            'typeof window.zhudaGame?.snapshot',
          ),
          gameText: await output!.webContents.executeJavaScript('document.body.innerText'),
          nodeAccess: await output!.webContents.executeJavaScript('typeof window.require'),
          encryptedStorage:
            unprotect(protect('isolated-smoke-fixture')) === 'isolated-smoke-fixture',
          backgrounds: [] as string[],
          prankRemaining: '',
          configuredEvent: null as unknown,
          configuredEffectClass: '',
          configuredPrankRemaining: '',
          giftCatalogCount: giftCatalog.snapshot().gifts.length,
          errors: collector.status.parseErrors,
          version: snapshot().round?.packageVersion,
          unlockEffect: unlocking.effect,
          unlockFaceClear: !(await inspectLayout()).faceCovered,
          unlockFragments: unlocking.fragments,
          lockEffect: '',
          lockFaceClear: false,
          burstRemaining: '',
          settledNodes: -1,
          reopenedEffect: '',
          won: false,
          victoryOpacity: '',
          victoryCount: '',
          continuity: [] as Awaited<ReturnType<typeof checkChainTransitions>>,
          reducedMotionAnimations: -1,
          reducedMotionBadge: '',
          layout: await inspectLayout(),
          narrowLayout: null as unknown,
          portraitLayout: null as unknown,
          portraitPreference: '',
          orientationPreservesRound: false,
          portraitReopenedEffect: '',
          impacts: unlockImpacts,
          narrowImpacts: [] as unknown[],
          exactCounts: [] as { expected: number; actual: number; pixels: number }[],
          singleLock: null as unknown,
          singleUnlock: null as unknown,
          themes: null as unknown,
        };
        await settledChainEffects();
        await command({ type: 'simulate', giftId: '685', quantity: '1' });
        await pause(300);
        result.lockEffect = await inspect('document.querySelector(".stage").dataset.effect');
        result.lockFaceClear = !(await inspectLayout()).faceCovered;
        await capture('chain-lock');
        for (const giftId of ['685', '2001', '685'])
          await command({ type: 'simulate', giftId, quantity: '1' });
        result.burstRemaining = snapshot().round!.remaining;
        await settledChainEffects();
        result.settledNodes = await inspect('document.querySelector("#effects").childElementCount');
        for (const color of ['dark', 'transparent', 'green'] as const) {
          await command({ type: 'output', background: color });
          await new Promise<void>((resolve) => setTimeout(resolve, 150));
          result.backgrounds.push(
            await output!.webContents.executeJavaScript('document.body.dataset.background'),
          );
          if (color === 'dark') {
            result.reopenedEffect = await inspect(
              'document.querySelector(".stage").dataset.effect || "none"',
            );
            await capture('chain-dark');
          }
        }
        const beforeOrientation = snapshot().round!;
        await command({ type: 'output', background: 'green', layout: 'portrait' });
        await readyOutput();
        result.portraitLayout = await inspectLayout();
        await capture('chain-portrait');
        // Reopening/changing background keeps the saved direction and the same round.
        await command({ type: 'output', background: 'green' });
        await readyOutput();
        result.portraitPreference = store.get('output-layout', 'landscape');
        result.orientationPreservesRound =
          snapshot().round!.id === beforeOrientation.id &&
          snapshot().round!.remaining === beforeOrientation.remaining &&
          snapshot().outputLayout === 'portrait';
        result.portraitReopenedEffect = await inspect(
          'document.querySelector(".stage").dataset.effect || "none"',
        );
        output!.setSize(360, 640);
        await pause(200);
        await capture('chain-narrow');
        result.narrowLayout = await inspectLayout();
        await command({ type: 'simulate', giftId: '2001', quantity: '1' });
        await pause(250);
        result.narrowImpacts = await inspectImpacts();
        await capture('chain-narrow-unlock');
        await command({ type: 'output', background: 'green', layout: 'landscape' });
        await readyOutput();
        await command({ type: 'simulate', giftId: '2001', quantity: '1000' });
        await pause(250);
        result.won = snapshot().round?.status === 'won';
        await capture('chain-victory-burst');
        await settledChainEffects();
        result.victoryOpacity = await inspect(
          'getComputedStyle(document.querySelector(".chain-rig")).opacity',
        );
        result.victoryCount = await inspect(
          `document.querySelector('.chain-rig').dataset.renderedCount`,
        );
        await capture('chain-victory');
        await command({ type: 'startRound', product: 'game.chain', mode: 'demo', initial: '4000' });
        await pause(200);
        output!.webContents.debugger.attach('1.3');
        await output!.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
        await command({ type: 'simulate', giftId: '685', quantity: '1' });
        await pause(200);
        result.reducedMotionAnimations = await inspect('document.getAnimations().length');
        result.reducedMotionBadge = await inspect('document.querySelector("#delta").textContent');
        output!.webContents.debugger.detach();
        // Exercise exact counts and individual transitions through the real preload bridge.
        // These local fixture states never modify the saved round or live observations.
        const fixtureRound = {
          ...snapshot().round!,
          id: 'exact-chain-fixture',
          status: 'running' as const,
        };
        const sendFixture = (remaining: number, action?: { before: number; after: number }) => {
          const event = action
            ? {
                id: randomUUID(),
                roundId: fixtureRound.id,
                giftId: 'fixture',
                giftName: '单根测试',
                senderName: '本机测试',
                quantity: '1',
                delta: String(action.after - action.before),
                before: String(action.before),
                after: String(action.after),
                won: action.after === 0,
                at: new Date().toISOString(),
              }
            : null;
          output!.webContents.send('game:update', {
            ...gameState(),
            round: {
              ...fixtureRound,
              initial: String(Math.max(1, remaining)),
              remaining: String(remaining),
              status: remaining ? 'running' : 'won',
            },
            recent: event ? [event] : [],
            lastAction: event,
          });
        };
        const exactCount = async (expected: number) => {
          for (let attempt = 0; attempt < 100; attempt++) {
            const count = await inspect(
              `document.querySelector('.chain-rig').dataset.renderedCount`,
            );
            if (count === String(expected)) break;
            await pause(30);
          }
          const result = await inspect(`(() => {
            const canvas = document.querySelector('.chain-rig');
            const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let pixels = 0; for (let index = 3; index < data.length; index += 4) if (data[index]) pixels++;
            return { actual: Number(canvas.dataset.renderedCount), pixels };
          })()`);
          return { expected, ...result };
        };
        output!.webContents.debugger.attach('1.3');
        await output!.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
        });
        output!.webContents.debugger.detach();
        for (const expected of [0, 1, 2, 24, 4200]) {
          sendFixture(expected);
          await pause(40);
          result.exactCounts.push(await exactCount(expected));
          await capture(`chain-exact-${expected}`);
        }
        sendFixture(1);
        await pause(100);
        await exactCount(1);
        sendFixture(2, { before: 1, after: 2 });
        await pause(350);
        result.singleLock =
          await inspect(`({ kind: document.querySelector('.chain-motion').dataset.kind,
          count: document.querySelector('.chain-motion').dataset.renderedCount,
          from: document.querySelector('.chain-motion').dataset.from, to: document.querySelector('.chain-motion').dataset.to })`);
        await capture('chain-single-bind');
        await pause(850);
        result.exactCounts.push(await exactCount(2));
        sendFixture(1, { before: 2, after: 1 });
        await pause(120);
        await capture('chain-single-crack');
        await pause(230);
        result.singleUnlock =
          await inspect(`({ kind: document.querySelector('.chain-motion').dataset.kind,
          count: document.querySelector('.chain-motion').dataset.renderedCount,
          from: document.querySelector('.chain-motion').dataset.from, to: document.querySelector('.chain-motion').dataset.to })`);
        await capture('chain-single-break');
        await pause(300);
        await capture('chain-single-melt');
        await pause(550);
        result.exactCounts.push(await exactCount(1));
        result.continuity = await checkChainTransitions(output!, gameState());
        result.themes = await checkThemes(mainWindow!, () => output!, command, snapshot);
        await command({ type: 'stopRound' });
        await command({
          type: 'startRound',
          product: 'prank.stage',
          mode: 'demo',
          initial: '1000',
        });
        await command({ type: 'simulate', giftId: '2001', quantity: '2' });
        await new Promise<void>((resolve) => setTimeout(resolve, 150));
        result.prankRemaining = snapshot().round!.remaining;
        const prank = snapshot().library.find(
          (item) => item.manifest.id === 'prank.stage',
        )!.configuration!;
        const configuredRules = prank.rules.map((rule) =>
          rule.giftId === '2001' ? { ...rule, eventId: 'glitch', delta: 0, amount: 4 } : rule,
        );
        await command({
          type: 'saveGiftRules',
          product: prank.product,
          packageVersion: prank.packageVersion,
          rules: configuredRules,
        });
        await command({ type: 'simulate', giftId: '2001', quantity: '2' });
        await pause(200);
        result.configuredEvent = gameState().lastAction;
        result.configuredPrankRemaining = snapshot().round!.remaining;
        result.configuredEffectClass = await inspect('document.querySelector(".stage").className');
        writeFileSync(report, JSON.stringify(result, null, 2));
        app.quit();
      }
    })
    .catch((error) => {
      console.error('工作台启动失败：', error);
      app.quit();
    });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    sceneHotkeys?.dispose();
    mobilePreview?.stop();
    if (refreshTimer) clearInterval(refreshTimer);
    if (maintenanceTimer) clearInterval(maintenanceTimer);
    if (publishTimer) clearTimeout(publishTimer);
    scenes?.pauseAll();
    collector?.close();
    plugins?.dispose();
    if (output && !output.isDestroyed()) output.destroy();
    if (sceneOutput && !sceneOutput.isDestroyed()) sceneOutput.destroy();
    store?.close();
  });
}
