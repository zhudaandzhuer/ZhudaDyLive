import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneAudioOutput, sceneAudioUrl } from '../client/src/renderer/scene-audio';

function createTestSource() {
  const source = {
    buffer: null as { duration: number } | null,
    onended: null as (() => void) | null,
    connect: (target: unknown) => target,
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn((): void => {
      source.onended?.();
    }),
  };
  return source;
}

class TestAudioContext {
  state = 'suspended';
  sampleRate = 48000;
  destination = {};
  sources: ReturnType<typeof createTestSource>[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createBuffer = () => ({ duration: 1 / 48000 });
  decodeAudioData = vi.fn(async () => ({ duration: 0.7 }));
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() });
  createBufferSource() {
    const source = createTestSource();
    this.sources.push(source);
    return source;
  }
}

describe('手机声音输出', () => {
  let context: TestAudioContext;
  const request = { action: 'play' as const, layerId: 'chain', url: '/chain.wav', volume: 0.3 };
  beforeEach(() => {
    context = new TestAudioContext();
    vi.stubGlobal('AudioContext', function () {
      return context;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1]))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('点按前不加载或播放；静音会停止当前声音，重新开启不补播', async () => {
    const output = new SceneAudioOutput();
    await output.play(request);
    expect(fetch).not.toHaveBeenCalled();
    await output.unlock();
    await output.play(request);
    const voice = context.sources.find((source) => source.buffer?.duration === 0.7)!;
    expect(voice.start).toHaveBeenCalledOnce();
    output.mute();
    expect(voice.stop).toHaveBeenCalledOnce();
    await output.unlock();
    expect(context.sources.filter((source) => source.buffer?.duration === 0.7)).toHaveLength(1);
    output.dispose();
  });

  it('音效加载期间暂停该图层，不会在加载完成后突然补播', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const output = new SceneAudioOutput();
    await output.unlock();
    const playing = output.play(request);
    output.stop(request.layerId);
    finish(new Response(new Uint8Array([1])));
    await playing;
    expect(context.sources.filter((source) => source.buffer?.duration === 0.7)).toHaveLength(0);
    await output.play(request);
    expect(context.sources.filter((source) => source.buffer?.duration === 0.7)).toHaveLength(1);
    output.dispose();
  });

  it('连送礼物每层最多叠加两个声音，所有图层合计不超过八个', async () => {
    const output = new SceneAudioOutput();
    await output.unlock();
    for (let i = 0; i < 12; i++) await output.play(request);
    const active = () =>
      context.sources.filter(
        (source) => source.buffer?.duration === 0.7 && !source.stop.mock.calls.length,
      );
    expect(active()).toHaveLength(2);
    for (let i = 0; i < 12; i++) await output.play({ ...request, layerId: `other-${i}` });
    expect(active()).toHaveLength(8);
    output.mute();
    expect(active()).toHaveLength(0);
    output.dispose();
  });

  it('声音资源限定在插件目录，拒绝外链、目录跳转及带参数的地址', () => {
    const entry = 'http://192.168.1.2:1234/p/session/plugin/plugin.chain/1.2.4/assets/index.html';
    expect(sceneAudioUrl(entry, 'audio/chain.wav')).toBe(new URL('audio/chain.wav', entry).href);
    expect(sceneAudioUrl(new URL(entry).pathname, 'chain.wav', entry)).toBe(
      new URL('chain.wav', entry).href,
    );
    for (const file of [
      '../chain.wav',
      '/chain.wav',
      '//example.com/a.wav',
      'https://example.com/a.wav',
      'a.wav?x=1',
      'a/%2e%2e/a.wav',
    ])
      expect(sceneAudioUrl(entry, file)).toBeNull();
  });
});
