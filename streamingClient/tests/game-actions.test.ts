import { expect, it } from 'vitest';
import type { GameAction, GameState, Round } from '@zhuda/contracts';
import { ActionCursor } from '../games/shared/actions';
const now = Date.now();
const round = { id: 'round-1' } as Round;
function action(id: string, delta: string, age = 0): GameAction {
  return {
    id,
    roundId: round.id,
    giftId: '2001',
    giftName: '玫瑰',
    senderName: '观众',
    quantity: '1',
    delta,
    before: '4000',
    after: '3990',
    won: false,
    at: new Date(now - age).toISOString(),
  };
}
function state(recent: GameAction[], active = round): GameState {
  return { round: active, recent, lastAction: recent[0] ?? null, background: 'green' };
}
it('开窗不重播历史；重叠快照中的加锁与解锁依序只播放一次', () => {
  const cursor = new ActionCursor(),
    old = action('old', '-10');
  expect(cursor.consume(state([old]), now)).toEqual([]);
  const lock = action('a', '100'),
    unlock = action('b', '-10');
  expect(cursor.consume(state([unlock, lock, old]), now).map((a) => a.id)).toEqual(['a', 'b']);
  expect(cursor.consume(state([unlock, lock]), now)).toEqual([]);
});
it('新回合、过时或其他回合的交互不触发；lastAction 缺于 recent 时仍只消费一次', () => {
  const cursor = new ActionCursor();
  cursor.consume(state([]), now);
  expect(
    cursor.consume(
      state([action('stale', '100', 7000), { ...action('foreign', '100'), roundId: 'other' }]),
      now,
    ),
  ).toEqual([]);
  const last = { ...state([]), lastAction: action('only', '-10') };
  expect(cursor.consume(last, now).map((a) => a.id)).toEqual(['only']);
  expect(cursor.consume(last, now)).toEqual([]);
  expect(
    cursor.consume(state([action('new-round-history', '100')], { id: 'round-2' } as Round), now),
  ).toEqual([]);
});
it('不改计数的纯特效事件仍播放一次，重新开窗不重播', () => {
  const cursor = new ActionCursor();
  cursor.consume(state([]), now);
  const effect = { ...action('effect', '0'), eventId: 'glitch', eventName: '信号故障', value: '3' };
  expect(cursor.consume(state([effect]), now)).toEqual([effect]);
  expect(cursor.consume(state([effect]), now)).toEqual([]);
  expect(new ActionCursor().consume(state([effect]), now)).toEqual([]);
});
