import { describe, expect, it } from 'vitest';
import type { SceneFrameState } from '@zhuda/contracts';
import { sequenceAt } from '../../plugins/dragon/sequences';

const state = () =>
  ({
    settings: {},
    status: 'running',
    playbackTime: 0,
    game: { round: { id: 'game-1' } },
    battle: {
      phase: 'prepare',
      round: 1,
      nextAtMs: 20000,
      prepMs: 20000,
      clashMs: 8000,
      winner: null,
      lastClash: null,
    },
  }) as unknown as SceneFrameState;
const clash = (patch: object = {}) => {
  const s = state();
  Object.assign(s.battle!, {
    phase: 'clash',
    nextAtMs: 28000,
    lastClash: { atMs: 20000, round: 1, dodged: false, blocked: false, countered: false, ...patch },
  });
  return s;
};

describe('影片回合衔接时间线', () => {
  it.each([5, 7, 10, 20, 30, 120])('任意 %s 秒备战完整呼吸循环后停在共同尾帧', (seconds) => {
    const s = state();
    Object.assign(s.battle!, { prepMs: seconds * 1000, nextAtMs: seconds * 1000 });
    const end = sequenceAt(s, seconds * 1000);
    expect(end).toMatchObject({ clip: 'idle', loop: false, playing: false });
    expect(end.time).toBeCloseTo(10 - 1 / 24);
    expect(sequenceAt(s, seconds * 1000 - 500).playing).toBe(true);
  });
  it.each([
    [{}, 'hit'],
    [{ countered: true }, 'hit-counter'],
    [{ blocked: true, countered: true }, 'block-counter'],
    [{ dodged: true, countered: true }, 'dodge-counter'],
  ])('依权威攻防结果选择实际影片 %s', (patch, clip) => {
    expect(sequenceAt(clash(patch), 20000)).toMatchObject({
      clip,
      time: 0,
      loop: false,
      playing: true,
    });
  });
  it('胜负影片优先，完成后保持败者倒地尾帧，不重播攻击', () => {
    for (const winner of ['hero', 'dragon'] as const) {
      const s = clash();
      s.battle!.winner = winner;
      expect(sequenceAt(s, 21000).clip).toBe(`${winner}-win`);
      s.battle!.phase = 'finished';
      s.status = 'stopped';
      expect(sequenceAt(s, 28000)).toMatchObject({
        clip: `${winner}-win`,
        time: 8 - 1 / 24,
        playing: false,
      });
      expect(sequenceAt(s, 50000)).toEqual(sequenceAt(s, 28000));
    }
  });
  it('晚加入、暂停和恢复取同一个影片时间，不从头再播', () => {
    const s = clash({ countered: true });
    const live = sequenceAt(s, 23500);
    expect(live.time).toBe(3.5);
    s.status = 'paused';
    expect(sequenceAt(s, 23500)).toEqual({ ...live, playing: false });
    s.status = 'running';
    expect(sequenceAt(s, 23500)).toEqual(live);
  });
  it('关闭呼吸只停待机，回合攻防仍播影片', () => {
    const s = state();
    s.settings.motion = false;
    expect(sequenceAt(s, 5000).playing).toBe(false);
    Object.assign(s.battle!, clash().battle);
    expect(sequenceAt(s, 21000).playing).toBe(true);
  });
  it('同一片段在下一回合有新播放键；准备结束到结果送达之间保持尾帧', () => {
    const s = state();
    expect(sequenceAt(s, 20300).playing).toBe(false);
    const first = sequenceAt(clash(), 21000);
    const next = clash();
    next.battle!.lastClash!.round = 2;
    expect(sequenceAt(next, 21000).key).not.toBe(first.key);
  });
});
