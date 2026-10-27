import { describe, expect, it } from 'vitest';
import type { SceneLayerView } from '@zhuda/contracts';
import { validateSceneSettings, sceneSourceSchema } from '@zhuda/contracts';
import { sewingSource } from '../../plugins/live-modes/definitions';
import { CompletionPlayback } from '../client/src/renderer/completion-playback';

const complete = () =>
  ({
    available: true,
    source: sewingSource,
    layer: { settings: validateSceneSettings(sewingSource, {}) },
    runtime: {
      status: 'running',
      completedAt: 1000,
      completionId: 'first',
      completionDurationMs: 4000,
      game: { round: { id: 'round', status: 'won', remaining: '0' } },
    },
  }) as SceneLayerView;

describe('通用完成特效时间线', () => {
  it('完成只播放一次，场景持续更新与参数修改不会延长或重播', () => {
    const player = new CompletionPlayback(),
      view = complete();
    expect(player.sample(view, 1100)).toMatchObject({ text: '下班啦！', deadline: 5000 });
    view.layer.settings.completionText = '终于收工！';
    view.layer.settings.completionColor = '#123456';
    view.layer.settings.completionDuration = 5;
    expect(player.sample(view, 4500)).toMatchObject({
      text: '终于收工！',
      color: '#123456',
      deadline: 5000,
    });
    expect(player.sample(view, 5000)).toBeNull();
    expect(player.sample(view, 5100)).toBeNull();
    expect(new CompletionPlayback().sample(view, 5100)).toBeNull();
  });
  it('新增工作立即取消，连续再次完成可在同一回合重播一次', () => {
    const player = new CompletionPlayback(),
      view = complete();
    expect(player.sample(view, 1000)).not.toBeNull();
    view.runtime.game.round!.status = 'running';
    view.runtime.game.round!.remaining = '100';
    expect(player.sample(view, 1200)).toBeNull();
    view.runtime.game.round!.status = 'won';
    view.runtime.game.round!.remaining = '0';
    expect(player.sample(view, 1300)).toBeNull(); // A stale completion cannot resurrect.
    view.runtime.completionId = 'second';
    view.runtime.completedAt = 1400;
    expect(player.sample(view, 1400)).toMatchObject({ id: 'second', deadline: 5400 });
  });
  it('关闭、暂停和停止立即撤掉；重新启用不重播已经取消的事件', () => {
    for (const cause of ['enabled', 'paused', 'stopped', 'unavailable']) {
      const player = new CompletionPlayback(),
        view = complete();
      expect(player.sample(view, 1100)).not.toBeNull();
      if (cause === 'enabled') view.layer.settings.completionEnabled = false;
      if (cause === 'paused' || cause === 'stopped') view.runtime.status = cause;
      if (cause === 'unavailable') view.available = false;
      expect(player.sample(view, 1200)).toBeNull();
      view.layer.settings.completionEnabled = true;
      view.runtime.status = 'running';
      view.available = true;
      expect(player.sample(view, 1300)).toBeNull();
    }
  });
  it('新输出沿用当前剩余时长，旧完成态、未来时间或缺失时间不播放', () => {
    const view = complete();
    expect(new CompletionPlayback().sample(view, 4000)).toMatchObject({ deadline: 5000 });
    expect(new CompletionPlayback().sample(view, 6000)).toBeNull();
    expect(new CompletionPlayback().sample(view, 900)).toBeNull();
    delete view.runtime.completedAt;
    expect(new CompletionPlayback().sample(view, 1100)).toBeNull();
  });
  it('声明自动生成参数，校验时长与保留字段，插件仍可自定义分组和实时参数', () => {
    const settings = validateSceneSettings(sewingSource, {});
    expect(settings).toMatchObject({
      completionDuration: 4,
      completionEnabled: true,
      completionFireworks: true,
    });
    for (const completionDuration of [0, 2, 6, NaN])
      expect(() => validateSceneSettings(sewingSource, { completionDuration })).toThrow();
    expect(
      sceneSourceSchema.safeParse({
        ...sewingSource,
        parameters: [{ key: 'completionText', label: '冲突', type: 'text', default: '' }],
      }).success,
    ).toBe(false);
    expect(
      sceneSourceSchema.safeParse({
        ...sewingSource,
        parameters: [
          ...sewingSource.parameters,
          {
            key: 'customText',
            label: '自定义文字',
            type: 'text',
            default: '',
            group: '自定义外观',
            live: true,
          },
        ],
      }).success,
    ).toBe(true);
  });
});
