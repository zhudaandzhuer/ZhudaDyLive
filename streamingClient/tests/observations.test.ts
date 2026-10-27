import { describe, expect, it } from 'vitest';
import type { CollectorStatus } from '@zhuda/contracts';
import { ObservationJournal } from '../client/src/main/observations';

const status: CollectorStatus = {
  state: 'connected',
  webId: '12345678demo',
  loggedIn: true,
  messageCount: 1,
  giftCount: 0,
  parseErrors: 0,
  lastMessageAt: null,
  lastGiftAt: null,
  partial: false,
  message: '已连接',
};

describe('观测明细', () => {
  it('保留不同消息类型与 64 位编号，并限制最近消息数量', () => {
    const journal = new ObservationJournal();
    for (let i = 0; i < 250; i++)
      journal.recordMessage(
        {
          method: i % 2 ? 'WebcastGiftMessage' : 'WebcastChatMessage',
          messageId: String(9223372036854775901n + BigInt(i)),
          payload: new Uint8Array(42),
        },
        { runId: 'run-1', webId: status.webId },
      );
    const messages = journal.snapshot('run-1').messages;
    expect(messages).toHaveLength(100);
    expect(messages[0]).toMatchObject({
      method: 'WebcastGiftMessage',
      messageId: '9223372036854776150',
      bytes: 42,
    });
    expect(messages[1]?.method).toBe('WebcastChatMessage');
    expect(messages[0]).not.toHaveProperty('payload');
    expect(journal.snapshot('run-2').messages).toHaveLength(0);
    journal.recordMessage(
      { method: 'WebcastMemberMessage', messageId: '1', payload: new Uint8Array() },
      { runId: 'run-2', webId: 'other' },
    );
    expect(journal.snapshot('run-2').messages).toHaveLength(1);
  });
  it('数量持续更新不会重复产生状态纪录，重连与解析异常可独立查找', () => {
    const journal = new ObservationJournal();
    journal.recordStatus(status);
    journal.recordStatus({ ...status, messageCount: 100, giftCount: 10 });
    expect(journal.snapshot('run').events).toHaveLength(1);
    journal.recordStatus({ ...status, state: 'reconnecting', message: '连接中断', partial: true });
    journal.recordStatus({ ...status, parseErrors: 3 });
    journal.recordStatus({ ...status, parseErrors: 3, messageCount: 200 });
    const result = journal.snapshot('run');
    expect(result.errorCount).toBe(2);
    expect(result.errors.map((event) => event.level)).toEqual(['error', 'warning']);
    expect(result.errors[0]?.message).toBe('添加 3 笔消息解析异常');
    expect(result.events[0]?.receivedAt).toMatch(/^\d{4}-/);
  });
  it('一般状态更新不会挤掉异常明细，两种列表都有上限', () => {
    const journal = new ObservationJournal();
    journal.recordStatus({ ...status, state: 'error', message: '无法连接' });
    for (let i = 0; i < 250; i++) journal.recordStatus({ ...status, message: `状态 ${i}` });
    expect(journal.snapshot('run').events).toHaveLength(100);
    expect(journal.snapshot('run').errors).toHaveLength(1);
    expect(journal.snapshot('run').errorCount).toBe(1);
    for (let i = 0; i < 150; i++) journal.recordStatus({ ...status, parseErrors: i + 1 });
    expect(journal.snapshot('run').errors).toHaveLength(100);
    expect(journal.snapshot('run').errorCount).toBe(151);
  });
});
