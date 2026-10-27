import { BrowserWindow, session, type Cookie, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { parseRoom, type CollectorStatus } from '@zhuda/contracts';
import { decodePush, decodeResponse, isLiveEnd, type IncomingMessage } from '@zhuda/core';

const initialStatus = (): CollectorStatus => ({
  state: 'idle',
  webId: '',
  loggedIn: false,
  messageCount: 0,
  giftCount: 0,
  parseErrors: 0,
  lastMessageAt: null,
  lastGiftAt: null,
  partial: false,
  message: '登录抖音后，选择要连接的直播间',
});
const applicable = (cookie: Cookie) =>
  ['.douyin.com', 'live.douyin.com', '.live.douyin.com', 'douyin.com'].includes(
    cookie.domain ?? '',
  ) &&
  (!cookie.expirationDate || cookie.expirationDate > Date.now() / 1000);
const authenticated = (cookies: Cookie[]) =>
  cookies.some((c) => applicable(c) && ['sessionid', 'sessionid_ss'].includes(c.name) && c.value);
export class DouyinCollector {
  status = initialStatus();
  runId = '';
  private auth: Session;
  private window: BrowserWindow | null = null;
  private loginWindow: BrowserWindow | null = null;
  private generation = 0;
  private timer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private connectionTimer: NodeJS.Timeout | null = null;
  constructor(
    private onChange: () => void,
    private onMessage: (
      message: IncomingMessage,
      context: { runId: string; webId: string },
    ) => void,
    private saveCookies: (cookies: Cookie[]) => void,
  ) {
    this.auth = session.fromPartition('zhuda-douyin-runtime');
    this.auth.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    this.auth.webRequest.onBeforeRequest((details, callback) => {
      let media = details.resourceType === 'media';
      try {
        media ||= /\.(flv|mp4|m3u8|ts)(\?|$)/i.test(new URL(details.url).pathname);
      } catch {
        /* invalid requests are handled by Chromium */
      }
      callback({ cancel: media });
    });
  }
  async restore(cookies: Cookie[]) {
    for (const cookie of cookies.filter(applicable)) await this.setCookie(this.auth, cookie);
    await this.refreshAuth();
  }
  private async setCookie(target: Session, cookie: Cookie) {
    const domain = (cookie.domain ?? '').replace(/^\./, '');
    await target.cookies.set({
      url: `https://${domain}${cookie.path || '/'}`,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: cookie.expirationDate ?? Date.now() / 1000 + 30 * 86400,
    });
  }
  async refreshAuth() {
    this.status.loggedIn = authenticated(await this.auth.cookies.get({}));
    this.onChange();
  }
  private configureWindow(window: BrowserWindow) {
    window.webContents.setUserAgent(
      window.webContents
        .getUserAgent()
        .replace(/\sElectron\/[^\s]+/g, '')
        .replace(/\szhuda-live\/[^\s]+/g, ''),
    );
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      try {
        const u = new URL(url);
        if (
          u.protocol !== 'https:' ||
          !(u.hostname === 'douyin.com' || u.hostname.endsWith('.douyin.com'))
        )
          event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    window.webContents.setAudioMuted(true);
  }
  async login() {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      if (this.loginWindow.isMinimized()) this.loginWindow.restore();
      this.loginWindow.show();
      this.loginWindow.focus();
      return;
    }
    const loginSession = session.fromPartition(`zhuda-login-${randomUUID()}`);
    loginSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    const window = new BrowserWindow({
      title: '猪大直播 · 抖音官方登录',
      width: 1100,
      height: 800,
      autoHideMenuBar: true,
      webPreferences: {
        session: loginSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.loginWindow = window;
    this.configureWindow(window);
    this.status.message = '请在独立窗口使用手机抖音扫码；官方额外验证请在该窗口完成';
    this.onChange();
    let busy = false,
      stable = '',
      stableAt = 0;
    this.timer = setTimeout(() => {
      if (!window.isDestroyed()) window.close();
    }, 10 * 60_000);
    this.pollTimer = setInterval(async () => {
      if (busy || window.isDestroyed()) return;
      busy = true;
      try {
        const cookies = (await loginSession.cookies.get({})).filter(applicable);
        if (!authenticated(cookies)) {
          stable = '';
          return;
        }
        const key = cookies
          .filter((c) => ['sessionid', 'sessionid_ss'].includes(c.name))
          .map((c) => c.name + '=' + c.value)
          .join(';');
        if (key !== stable) {
          stable = key;
          stableAt = Date.now();
          return;
        }
        if (Date.now() - stableAt < 3000) return;
        this.saveCookies(cookies);
        await this.auth.clearStorageData();
        for (const cookie of cookies) await this.setCookie(this.auth, cookie);
        this.status.loggedIn = true;
        this.status.message = '已保存登录会话；请连接直播间并确认真实礼物接收';
        this.onChange();
        window.close();
        if (this.window && this.status.webId) {
          const room = this.status.webId;
          this.stop();
          await this.start(room);
        }
      } catch {
        this.status.message = '登录会话保存未完成，请重试';
        this.onChange();
      } finally {
        busy = false;
      }
    }, 1000);
    window.on('closed', () => {
      if (this.timer) clearTimeout(this.timer);
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.timer = null;
      this.pollTimer = null;
      this.loginWindow = null;
      void loginSession.clearStorageData();
    });
    void window.loadURL('https://live.douyin.com/').catch(() => {
      if (window.isDestroyed() || this.loginWindow !== window) return;
      this.status.message = '抖音官方页面暂时无法打开，请检查网络';
      this.onChange();
    });
  }
  async start(input: string) {
    const webId = parseRoom(input);
    if (
      this.status.webId === webId &&
      this.window &&
      ['connecting', 'connected', 'reconnecting'].includes(this.status.state)
    )
      return;
    this.stop();
    if (!this.status.loggedIn) throw new Error('请先扫码登录抖音');
    const generation = ++this.generation;
    this.runId = randomUUID();
    this.status = {
      ...initialStatus(),
      loggedIn: true,
      state: 'connecting',
      webId,
      message: '正在连接官方直播页，等待直播消息流',
    };
    this.onChange();
    const window = new BrowserWindow({
      title: `猪大直播 · 采集 ${webId}`,
      width: 1100,
      height: 800,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        session: this.auth,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.window = window;
    this.configureWindow(window);
    const sockets = new Set<string>(),
      responses = new Map<string, 'fetch'>();
    let loadingRoom = false;
    const current = () => generation === this.generation && !window.isDestroyed();
    const clearDeadline = () => {
      if (this.connectionTimer) clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    };
    const fail = (message: string) => {
      if (!current()) return;
      clearDeadline();
      this.status.state = 'error';
      this.status.partial = true;
      this.status.message = message;
      this.onChange();
    };
    const deadline = () => {
      clearDeadline();
      this.connectionTimer = setTimeout(() => {
        fail('20 秒内未收到直播消息。请显示采集窗口，确认已开播或完成官方验证，再重新连接。');
      }, 20_000);
    };
    window.on('close', (event) => {
      if (current()) {
        event.preventDefault();
        window.hide();
      }
    });
    try {
      window.webContents.debugger.attach('1.3');
    } catch {
      fail('无法启动直播网络监听，请重新连接');
      return;
    }
    window.webContents.debugger.on('detach', () => {
      if (current()) {
        fail('采集调试连接已中断，请重新连接');
      }
    });
    const deliver = (messages: IncomingMessage[]) => {
      if (!current()) return;
      if (messages.length) clearDeadline();
      for (const message of messages) {
        this.status.messageCount++;
        this.status.lastMessageAt = new Date().toISOString();
        this.status.state = 'connected';
        this.status.message = '直播数据流已连接；礼物接收以实际观测为准';
        if (message.method === 'WebcastGiftMessage') {
          this.status.giftCount++;
          this.status.lastGiftAt = this.status.lastMessageAt;
        }
        this.onMessage(message, { runId: this.runId, webId });
        if (message.method === 'WebcastControlMessage' && isLiveEnd(message.payload)) {
          this.stop();
          this.status.message = '直播已结束';
          break;
        }
      }
      this.onChange();
    };
    window.webContents.debugger.on('message', (_event, method, params) => {
      if (!current()) return;
      try {
        if (method === 'Network.webSocketCreated') {
          const url = new URL(params.url as string);
          if (url.hostname.endsWith('.douyin.com') && url.pathname.includes('/webcast/im/push/'))
            sockets.add(String(params.requestId));
        } else if (
          method === 'Network.webSocketFrameReceived' &&
          sockets.has(String(params.requestId))
        ) {
          const frame = params.response as { opcode: number; payloadData: string };
          if (frame.opcode === 2 && frame.payloadData.length <= 3_000_000)
            deliver(decodePush(Buffer.from(frame.payloadData, 'base64')));
        } else if (
          method === 'Network.webSocketClosed' &&
          sockets.delete(String(params.requestId))
        ) {
          this.status.state = 'reconnecting';
          this.status.partial = true;
          this.status.message = '直播数据连接中断，官方页面正在尝试重连';
          deadline();
          this.onChange();
        } else if (method === 'Network.responseReceived') {
          const url = new URL(params.response.url as string);
          if (url.hostname === 'live.douyin.com' && url.pathname === '/webcast/im/fetch/')
            responses.set(String(params.requestId), 'fetch');
        } else if (
          method === 'Network.loadingFinished' &&
          responses.delete(String(params.requestId))
        ) {
          void window.webContents.debugger
            .sendCommand('Network.getResponseBody', { requestId: params.requestId })
            .then((body: { body: string; base64Encoded: boolean }) => {
              if (current() && body.body.length <= 12_000_000)
                deliver(
                  decodeResponse(Buffer.from(body.body, body.base64Encoded ? 'base64' : 'utf8')),
                );
            })
            .catch(() => {
              /* WebSocket remains the primary transport. */
            });
        } else if (method === 'Network.loadingFailed') responses.delete(String(params.requestId));
      } catch {
        this.status.parseErrors++;
        this.status.partial = true;
        this.onChange();
      }
    });
    window.webContents.on('did-finish-load', () => {
      if (current() && loadingRoom && this.status.state === 'connecting') {
        this.status.message = '官方直播页已打开，等待直播消息；若需要验证，请显示采集窗口';
        this.onChange();
      }
    });
    window.webContents.on('render-process-gone', () => fail('官方直播页意外关闭，请重新连接'));
    deadline();
    // Start a renderer before enabling CDP, then observe before loading the room
    // so fast pages cannot emit their first messages before Network is ready.
    // Keep this work outside the command promise so show/stop remain available.
    void (async () => {
      try {
        await window.loadURL('about:blank');
        if (!current()) return;
        try {
          await window.webContents.debugger.sendCommand('Network.enable', {
            maxTotalBufferSize: 16 * 1024 * 1024,
            maxResourceBufferSize: 8 * 1024 * 1024,
          });
        } catch {
          fail('直播网络监听初始化失败，请重新连接');
          return;
        }
        if (!current()) return;
        loadingRoom = true;
        await window.loadURL(`https://live.douyin.com/${webId}`);
      } catch {
        fail('直播页面无法打开，请检查网络或显示采集窗口完成验证');
      }
    })();
  }
  show() {
    if (this.window && !this.window.isDestroyed()) this.window.show();
    else throw new Error('尚未打开直播采集');
  }
  stop() {
    this.generation++;
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    if (this.status.state !== 'idle') {
      this.status.state = 'stopped';
      this.status.message = '采集已停止，已保存的纪录仍保留';
    }
    this.onChange();
  }
  close() {
    this.stop();
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.destroy();
  }
}
