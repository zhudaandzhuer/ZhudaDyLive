import { describe, expect, it, vi } from 'vitest';
import type { GameAction, SceneFrameState } from '@zhuda/contracts';
import { SewingAudio } from '../../plugins/live-modes/sewing-audio';
import { SewingMotion } from '../../plugins/live-modes/sewing-motion';

function fixture() {
  const output = { play: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
  const audio = new SewingAudio(output),
    motion = new SewingMotion();
  const frame = (remaining = '3000', overrides: Partial<SceneFrameState> = {}) =>
    ({
      status: 'running',
      audio: { enabled: true, transport: 'host' },
      settings: {},
      game: {
        round: {
          id: 'round',
          remaining,
          initial: '3000',
          status: remaining === '0' ? 'won' : 'running',
        },
      },
      ...overrides,
    }) as SceneFrameState;
  let state = frame();
  function update(next: SceneFrameState, now: number, actions: GameAction[] = []) {
    state = next;
    motion.sync(state, actions, now);
    audio.update(state, actions, motion.sample(now), now);
  }
  const action = (before: string, after: string, eventId: string) =>
    ({ before, after, eventId }) as GameAction;
  const tick = (now: number) => audio.update(state, [], motion.sample(now), now);
  return { output, audio, frame, update, action, tick };
}

describe('缝纫机拟音生命周期', () => {
  it('打开场景和补布不误启动机器，机针音效跟随减量动画且有频率上限', () => {
    const f = fixture();
    f.update(f.frame(), 0);
    expect(f.output.play).not.toHaveBeenCalled();
    f.update(f.frame('3100'), 100, [f.action('3000', '3100', 'stitch-add')]);
    expect(f.output.play).toHaveBeenLastCalledWith('supply', 0.3, true);
    f.update(f.frame('3000'), 200, [f.action('3100', '3000', 'stitch-remove')]);
    for (let time = 210; time < 600; time += 10) f.tick(time);
    expect(f.output.play.mock.calls.filter(([cue]) => cue === 'machine')).toHaveLength(1);
    f.tick(700);
    expect(f.output.play.mock.calls.filter(([cue]) => cue === 'machine')).toHaveLength(2);
    f.tick(5000);
    expect(f.output.stop).toHaveBeenCalledOnce();
  });
  it('完工只在最后一单加工结束后播放一次，新订单立刻打断收工声', () => {
    const f = fixture();
    f.update(f.frame(), 0);
    f.update(f.frame('0'), 100, [f.action('3000', '0', 'release')]);
    expect(f.output.play).toHaveBeenLastCalledWith('machine', 0.3, true);
    f.tick(1200);
    f.tick(1300);
    expect(f.output.play.mock.calls.filter(([cue]) => cue === 'finish')).toHaveLength(1);
    const stops = f.output.stop.mock.calls.length;
    f.update(f.frame('100'), 1400, [f.action('0', '100', 'stitch-add')]);
    expect(f.output.stop.mock.calls.length).toBe(stops + 1);
    expect(f.output.play).toHaveBeenLastCalledWith('supply', 0.3, true);
    f.update(f.frame('0'), 1500, [f.action('100', '0', 'release')]);
    f.tick(2600);
    expect(f.output.play.mock.calls.filter(([cue]) => cue === 'finish')).toHaveLength(2);
  });
  it.each(['paused', 'stopped', 'idle'] as const)('%s 立即静音，恢复不补播旧动作', (status) => {
    const f = fixture();
    f.update(f.frame(), 0);
    f.update(f.frame('2900'), 100, [f.action('3000', '2900', 'stitch-remove')]);
    f.update(f.frame('2900', { status }), 200);
    expect(f.output.stop).toHaveBeenCalledOnce();
    const count = f.output.play.mock.calls.length;
    f.update(f.frame('2900'), 300);
    f.tick(5000);
    expect(f.output.play).toHaveBeenCalledTimes(count);
  });
  it('编辑器静音、插件开关与零音量都会停止声音；手机走同一宿主通道', () => {
    const mutedStates: Partial<SceneFrameState>[] = [
      { audio: { enabled: false } },
      { settings: { soundEnabled: false } },
      { settings: { soundVolume: 0 } },
    ];
    for (const muted of mutedStates) {
      const f = fixture();
      f.update(f.frame(), 0);
      f.update(f.frame('2900'), 100, [f.action('3000', '2900', 'stitch-remove')]);
      f.update(f.frame('2800', muted), 200, [f.action('2900', '2800', 'stitch-remove')]);
      expect(f.output.stop).toHaveBeenCalledOnce();
      expect(f.output.play).toHaveBeenCalledTimes(1);
      f.audio.dispose();
      expect(f.output.dispose).toHaveBeenCalledOnce();
    }
  });
  it('重新打开已完成场景、重开回合和时间调整不会重放历史音效', () => {
    const f = fixture();
    f.update(f.frame('0'), 0, [f.action('3000', '0', 'release')]);
    f.tick(2000);
    expect(f.output.play).not.toHaveBeenCalled();
    const next = f.frame();
    next.game.round!.id = 'next';
    f.update(next, 2100);
    f.update(next, 2200, [f.action('3000', '3000', 'time-add')]);
    expect(f.output.play).not.toHaveBeenCalled();
  });
});
