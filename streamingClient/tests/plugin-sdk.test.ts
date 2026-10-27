import { expect, it } from 'vitest';
import { SceneClient } from '../packages/plugin-sdk/src/scene-client';
import { DeliveryCursor } from '../packages/plugin-sdk/src/cursor';
import type { SceneFrameState } from '@zhuda/contracts';
const frame = (status: SceneFrameState['status'] = 'running'): SceneFrameState => ({
  layerId: 'layer',
  name: '',
  settings: {},
  theme: '',
  status,
  mode: 'demo',
  playbackTime: 0,
  game: { round: null, recent: [], lastAction: null, background: 'transparent' },
  events: [],
});
it('突发事件保序去重，首次加载不补播，超出保留窗口明确报告缺口', () => {
  const cursor = new DeliveryCursor<{ id: string; seq: number }>(),
    gaps: unknown[] = [];
  const event = (seq: number) => ({ id: String(seq), seq });
  expect(cursor.consume('round', [event(1)])).toEqual([]);
  expect(
    cursor.consume(
      'round',
      Array.from({ length: 80 }, (_, i) => event(i + 1)),
    ),
  ).toHaveLength(79);
  expect(cursor.consume('round', [event(80)])).toEqual([]);
  expect(cursor.consume('round', [event(400)], (gap) => gaps.push(gap))).toEqual([event(400)]);
  expect(gaps).toEqual([{ expected: 81, received: 400, missed: 319 }]);
  expect(cursor.consume('next', [event(1)])).toEqual([]);
});
it('订阅者异常不会阻止其他订阅，生命周期按暂停恢复运行并只清理一次', () => {
  const failures: unknown[] = [],
    calls: string[] = [];
  const client = new SceneClient(
    () => {},
    (e) => failures.push(e),
  );
  client.subscribe(() => {
    throw new Error('bad plugin');
  });
  client.lifecycle({
    onStart: () => calls.push('start'),
    onPause: () => calls.push('pause'),
    onResume: () => calls.push('resume'),
    onStop: () => calls.push('stop'),
    onDispose: () => calls.push('dispose'),
    onAudio: (enabled) => calls.push(`audio:${enabled}`),
  });
  client.receive(frame());
  client.receive(frame('paused'));
  client.receive(frame());
  client.receive({ ...frame('stopped'), audio: { enabled: true } });
  client.dispose();
  client.dispose();
  client.receive(frame());
  expect(calls).toEqual([
    'start',
    'audio:false',
    'pause',
    'resume',
    'stop',
    'audio:true',
    'dispose',
  ]);
  expect(failures).toHaveLength(4);
});
it('事件回调异常不导致重播，缺口回调异常也不阻止新事件', () => {
  const errors: unknown[] = [],
    events: string[] = [];
  const client = new SceneClient(
    () => {},
    (e) => errors.push(e),
  );
  client.onEvent(
    (event) => {
      events.push(event.id);
      throw new Error('callback');
    },
    {
      onGap: () => {
        throw new Error('gap');
      },
    },
  );
  client.receive(frame());
  const event = {
    id: 'event',
    seq: 3,
    kind: 'gift' as const,
    source: 'demo' as const,
    webId: '',
    at: '',
    data: {},
  };
  client.receive({ ...frame(), events: [event] });
  client.receive({ ...frame(), events: [event] });
  expect(events).toEqual(['event']);
  expect(errors).toHaveLength(2);
});

it('显式清理生命周期后再次清理或销毁页面，不重复释放资源', () => {
  const calls: string[] = [];
  const client = new SceneClient(
    () => {},
    () => {},
  );
  const stop = client.lifecycle({
    onStart: () => calls.push('start'),
    onDispose: () => calls.push('dispose'),
  });
  client.receive(frame());
  stop();
  stop();
  client.receive(frame('stopped'));
  client.receive(frame());
  client.dispose();
  expect(calls).toEqual(['start', 'dispose']);
});
