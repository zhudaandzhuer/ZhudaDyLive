import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { encode } from './fixtures';

interface TestWindow extends EventEmitter {
  webContents: EventEmitter & {
    debugger: EventEmitter & { attach: Mock; sendCommand: Mock };
  };
  loadURL: Mock;
  show: Mock;
  restore: Mock;
  focus: Mock;
  destroy: Mock;
  resolveEnable: () => void;
  rejectEnable: (error: Error) => void;
}
const scenario = vi.hoisted(() => ({
  windows: [] as TestWindow[],
  releaseOnNavigate: true,
  rejectNavigation: false,
  holdNavigation: false,
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    destroyed = false;
    resolveEnable!: () => void;
    rejectEnable!: (error: Error) => void;
    enable = new Promise<void>((resolve, reject) => {
      this.resolveEnable = resolve;
      this.rejectEnable = reject;
    });
    webContents = Object.assign(new EventEmitter(), {
      getUserAgent: () => 'Chrome Electron/test',
      setUserAgent: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      setAudioMuted: vi.fn(),
      debugger: Object.assign(new EventEmitter(), {
        attach: vi.fn(),
        sendCommand: vi.fn(() => this.enable),
      }),
    });
    constructor() {
      super();
      scenario.windows.push(this);
    }
    isDestroyed = () => this.destroyed;
    isMinimized = () => true;
    restore = vi.fn();
    focus = vi.fn();
    show = vi.fn();
    hide = vi.fn();
    loadURL = vi.fn(async () => {
      if (scenario.releaseOnNavigate) this.resolveEnable();
      if (scenario.rejectNavigation) throw new Error('fixture navigation failure');
      if (scenario.holdNavigation) await new Promise(() => {});
    });
    destroy = vi.fn(() => {
      this.destroyed = true;
      this.emit('closed');
    });
  }
  return {
    BrowserWindow: Window,
    session: {
      fromPartition: () => ({
        setPermissionRequestHandler: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() },
        cookies: { get: vi.fn(async () => []), set: vi.fn(async () => {}) },
        clearStorageData: vi.fn(async () => {}),
      }),
    },
  };
});
import { DouyinCollector } from '../client/src/main/collector';

let collector: DouyinCollector;
beforeEach(() => {
  vi.useFakeTimers();
  scenario.windows = [];
  scenario.releaseOnNavigate = true;
  scenario.rejectNavigation = false;
  scenario.holdNavigation = false;
  collector = new DouyinCollector(vi.fn(), vi.fn(), vi.fn());
  collector.status.loggedIn = true;
});
afterEach(() => {
  collector.close();
  vi.useRealTimers();
});
const latest = () => scenario.windows.at(-1)!;
function receive(window = latest()) {
  const debuggerEvents = window.webContents.debugger;
  debuggerEvents.emit('message', {}, 'Network.webSocketCreated', {
    requestId: 'fixture-socket',
    url: 'wss://webcast-fixture.douyin.com/webcast/im/push/',
  });
  debuggerEvents.emit('message', {}, 'Network.webSocketFrameReceived', {
    requestId: 'fixture-socket',
    response: {
      opcode: 2,
      payloadData: Buffer.from(
        encode('PushFrame', {
          payload: encode('Response', {
            messages: [{ method: 'WebcastMemberMessage', msgId: '1', payload: new Uint8Array() }],
          }),
        }),
      ).toString('base64'),
    },
  });
}

describe('直播采集初始化与取消', () => {
  it('登录指令打开独立的抖音官方登录页', async () => {
    await collector.login();
    expect(latest().loadURL).toHaveBeenCalledWith('https://live.douyin.com/');
    expect(latest().show).not.toHaveBeenCalled();
  });
  it('登录网页仍在加载时指令立即返回，重复点击恢复并聚焦同一窗口', async () => {
    scenario.holdNavigation = true;
    await collector.login();
    const window = latest();
    await collector.login();
    expect(scenario.windows).toHaveLength(1);
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });
  it('登录网页加载失败会显示错误', async () => {
    scenario.rejectNavigation = true;
    await collector.login();
    expect(collector.status.message).toContain('官方页面暂时无法打开');
  });
  it('先用空白页启动渲染器，再完成监听才加载直播页，开始指令不会卡住', async () => {
    scenario.releaseOnNavigate = false;
    const starting = collector.start('12345678demo');
    expect(latest().loadURL).toHaveBeenCalledWith('about:blank');
    await starting;
    expect(collector.status.state).toBe('connecting');
    expect(latest().loadURL).toHaveBeenCalledTimes(1);
    latest().resolveEnable();
    await vi.advanceTimersByTimeAsync(0);
    expect(latest().loadURL).toHaveBeenLastCalledWith('https://live.douyin.com/12345678demo');
  });
  it('监听初始化未完成也可显示窗口与停止', async () => {
    scenario.releaseOnNavigate = false;
    await collector.start('12345678demo');
    collector.show();
    expect(latest().show).toHaveBeenCalledOnce();
    collector.stop();
    expect(latest().destroy).toHaveBeenCalledOnce();
    expect(collector.status.state).toBe('stopped');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(collector.status.state).toBe('stopped');
  });
  it('20 秒没有消息就显示明确错误，仍可显示官方页完成验证', async () => {
    await collector.start('12345678demo');
    await vi.advanceTimersByTimeAsync(0);
    latest().webContents.emit('did-finish-load');
    expect(collector.status.message).toContain('官方直播页已打开');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(collector.status.state).toBe('error');
    expect(collector.status.message).toContain('20 秒');
    collector.show();
    expect(latest().show).toHaveBeenCalledOnce();
  });
  it('收到消息才标记已连接，并取消初次连接逾时', async () => {
    await collector.start('12345678demo');
    receive();
    expect(collector.status.state).toBe('connected');
    expect(collector.status.messageCount).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(collector.status.state).toBe('connected');
  });
  it('一般直播消息也送入观测明细，不误算成礼物', async () => {
    const onMessage = vi.fn();
    collector.close();
    collector = new DouyinCollector(vi.fn(), onMessage, vi.fn());
    collector.status.loggedIn = true;
    await collector.start('12345678demo');
    receive();
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'WebcastMemberMessage', messageId: '1' }),
      expect.objectContaining({ webId: '12345678demo' }),
    );
    expect(collector.status.giftCount).toBe(0);
  });
  it('完成官方验证后的迟到消息仍可恢复已连接', async () => {
    await collector.start('12345678demo');
    await vi.advanceTimersByTimeAsync(20_000);
    receive();
    expect(collector.status.state).toBe('connected');
  });
  it('切换直播间后忽略旧窗口的迟到错误与消息', async () => {
    scenario.releaseOnNavigate = false;
    await collector.start('12345678demo');
    const old = latest();
    await collector.start('123456');
    old.rejectEnable(new Error('late fixture error'));
    receive(old);
    await Promise.resolve();
    expect(collector.status.webId).toBe('123456');
    expect(collector.status.state).toBe('connecting');
    expect(collector.status.messageCount).toBe(0);
  });
  it('页面加载或监听初始化失败会结束等待', async () => {
    scenario.rejectNavigation = true;
    await collector.start('12345678demo');
    await Promise.resolve();
    expect(collector.status.state).toBe('error');
    expect(collector.status.message).toContain('页面无法打开');
    scenario.rejectNavigation = false;
    scenario.releaseOnNavigate = false;
    await collector.start('12345678demo');
    latest().rejectEnable(new Error('fixture observer failure'));
    await Promise.resolve();
    expect(collector.status.state).toBe('error');
    expect(collector.status.message).toContain('监听初始化失败');
  });
});
