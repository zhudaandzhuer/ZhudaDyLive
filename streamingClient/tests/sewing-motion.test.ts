import { describe, expect, it } from 'vitest';
import type { GameAction, SceneFrameState } from '@zhuda/contracts';
import { SewingMotion } from '../../plugins/live-modes/sewing-motion';

const state = (remaining: string, status: SceneFrameState['status'] = 'running', id = 'round') =>
  ({
    status: status === 'won' ? 'running' : status,
    game: {
      round: { id, initial: '3000', remaining, status: status === 'won' ? 'won' : 'running' },
    },
  }) as SceneFrameState;
const action = (before: string, after: string, eventId: string) =>
  ({
    before,
    after,
    eventId,
  }) as GameAction;

describe('缝纫机加工表现', () => {
  it('等待礼物时机器待机，补布只追加订单，不启动机针', () => {
    const motion = new SewingMotion();
    motion.sync(state('3000'), [], 0);
    expect(motion.sample(500).work).toBe('idle');
    motion.sync(state('3100'), [action('3000', '3100', 'stitch-add')], 1000);
    expect(motion.sample(1300)).toMatchObject({ work: 'supply', complete: false });
    expect(motion.sample(1300).count).toBeGreaterThan(3000n);
    expect(motion.sample(1700).count).toBe(3100n);
    expect(motion.sample(2300).work).toBe('idle');
  });
  it('减量才缝制，成品增加，数字最终精确对齐宿主', () => {
    const motion = new SewingMotion();
    motion.sync(state('3000'), [], 0);
    motion.sync(state('2800'), [action('3000', '2800', 'stitch-remove')], 1000);
    const view = motion.sample(1500);
    expect(view.work).toBe('sewing');
    expect(view.count).toBeLessThan(3000n);
    expect(view.count).toBeGreaterThan(2800n);
    expect(view.finishedLoad).toBeGreaterThan(0);
    expect(motion.sample(5000)).toMatchObject({ count: 2800n, work: 'idle' });
  });
  it('连续加减与翻倍不会重复扣数，连击尾部动画最多 3.6 秒', () => {
    const motion = new SewingMotion();
    motion.sync(state('3000'), [], 0);
    motion.sync(state('9000'), [action('3000', '9000', 'stitch-multiply')], 1000);
    for (let i = 0; i < 100; i++)
      motion.sync(
        state(String(8999 - i)),
        [action(String(9000 - i), String(8999 - i), 'stitch-remove')],
        1100 + i,
      );
    expect(motion.sample(1300).work).toBe('sewing');
    expect(motion.sample(5000)).toMatchObject({ count: 8900n, work: 'idle' });
    expect(motion.sample(5000).finishedLoad).toBeGreaterThan(0);
  });
  it('快速翻倍后立即缝制，机身数字沿着减量方向变化', () => {
    const motion = new SewingMotion();
    motion.sync(state('3000'), [], 0);
    motion.sync(state('6000'), [action('3000', '6000', 'stitch-multiply')], 1000);
    motion.sync(state('5800'), [action('6000', '5800', 'stitch-remove')], 1050);
    expect(motion.sample(1050).count).toBe(6000n);
    expect(motion.sample(1500).count).toBeLessThan(6000n);
    expect(motion.sample(1500).count).toBeGreaterThan(5800n);
    expect(motion.sample(5000).count).toBe(5800n);
    motion.sync(
      state('5800'),
      [action('5800', '5900', 'stitch-add'), action('5900', '5800', 'stitch-remove')],
      5100,
    );
    expect(motion.sample(5100).count).toBe(5900n);
    expect(motion.sample(5600).count).toBeLessThan(5900n);
    expect(motion.sample(10000).count).toBe(5800n);
  });
  it('暂停即停止表现，继续和重新打开窗口不重播旧加工', () => {
    const motion = new SewingMotion();
    motion.sync(state('3000'), [], 0);
    motion.sync(state('2900'), [action('3000', '2900', 'stitch-remove')], 1000);
    motion.sync(state('2900', 'paused'), [], 1050);
    expect(motion.sample(1050)).toMatchObject({ count: 2900n, work: 'idle' });
    motion.sync(state('2900'), [], 1100);
    expect(motion.sample(1100).work).toBe('idle');
    const reopened = new SewingMotion();
    reopened.sync(state('2900'), [action('3000', '2900', 'stitch-remove')], 1200);
    expect(reopened.sample(1200)).toMatchObject({ count: 2900n, work: 'idle' });
  });
  it('最后一单缝完才收工开门，已经完成的回合重开直接恢复', () => {
    for (const eventId of ['release', 'stitch-remove']) {
      const motion = new SewingMotion();
      motion.sync(state('3000'), [], 0);
      motion.sync(state('0', 'won'), [action('3000', '0', eventId)], 1000);
      expect(motion.sample(1200)).toMatchObject({ work: 'sewing', complete: false });
      expect(motion.sample(5000)).toMatchObject({ count: 0n, work: 'finished', complete: true });
      const reopened = new SewingMotion();
      reopened.sync(state('0', 'won'), [], 1200);
      expect(reopened.sample(1200).complete).toBe(true);
    }
  });
  it('大额订单保持 BigInt 精度，过载与时间事件不会加工布料', () => {
    const motion = new SewingMotion();
    const huge = '9'.repeat(40);
    motion.sync(state('3000'), [], 0);
    motion.sync(state(huge), [action('3000', huge, 'stitch-add')], 1000);
    expect(motion.sample(3000)).toMatchObject({ count: BigInt(huge), work: 'idle' });
    motion.sync(state(huge), [action(huge, huge, 'time-add')], 3100);
    expect(motion.sample(3100).work).toBe('idle');
    motion.sync(state(huge), [action(huge, huge, 'overdrive')], 3200);
    expect(motion.sample(3200)).toMatchObject({
      count: BigInt(huge),
      work: 'overdrive',
      finishedLoad: 0,
    });
  });
  it('完工动画中或下班后追加布料立即恢复，下次归零仍可再次完成', () => {
    for (const nextAt of [1200, 5000]) {
      const motion = new SewingMotion();
      motion.sync(state('3000'), [], 0);
      motion.sync(state('0', 'won'), [action('3000', '0', 'release')], 1000);
      expect(motion.sample(1100).complete).toBe(false);
      motion.sync(state('100'), [action('0', '100', 'stitch-add')], nextAt);
      expect(motion.sample(nextAt)).toMatchObject({
        complete: false,
        work: 'supply',
        target: 100n,
      });
      expect(motion.sample(nextAt + 1500)).toMatchObject({
        complete: false,
        work: 'idle',
        count: 100n,
      });
      motion.sync(state('0', 'won'), [action('100', '0', 'stitch-remove')], nextAt + 2000);
      expect(motion.sample(nextAt + 6000)).toMatchObject({
        complete: true,
        work: 'finished',
        count: 0n,
      });
    }
  });
});
