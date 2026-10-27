import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestSchema, themesFor, themeFor } from '@zhuda/contracts';
import { LocalStore } from '@zhuda/core';
import { manifest } from './fixtures';

const themed = manifestSchema.parse({
  ...manifest,
  version: '0.6.0',
  defaultTheme: 'classic',
  themes: [
    { id: 'classic', name: '原版', description: '钢链', accent: '#d8f68b' },
    { id: 'monochrome', name: '黑白', description: '粗链', accent: '#ccddee' },
    { id: 'plush', name: '粉色', description: '玩偶', accent: '#ffaacc' },
  ],
});
it('任意游戏可提供一到多款主题，旧包只有原版，拒绝重复与无效预设', () => {
  expect(themesFor(manifest).map((t) => t.id)).toEqual(['default']);
  expect(themeFor(themed, 'missing')).toBe('classic');
  expect(themeFor({ ...themed, defaultTheme: undefined }, 'plush')).toBe('plush');
  for (const invalid of [
    { themes: [] },
    { themes: [themed.themes![0], themed.themes![0]] },
    { defaultTheme: 'unknown' },
    { themes: undefined, defaultTheme: 'classic' },
    { themes: [{ ...themed.themes![0], id: '../asset' }] },
  ])
    expect(() => manifestSchema.parse({ ...themed, ...invalid })).toThrow();
});
it('切换主题保留回合、礼物映射与历史，仅修改相符包版本的现有回合', () => {
  const store = new LocalStore(':memory:');
  try {
    const live = store.startRound(themed, 'live', 'room', '100');
    const demo = store.startRound({ ...themed, version: '0.7.0' }, 'demo', 'demo', '100');
    store.simulate('2001', '1');
    const before = store.round('live')!;
    store.configureTheme(themed, 'monochrome');
    expect(store.round('live')).toEqual({ ...before, theme: 'monochrome' });
    expect(store.round('demo')).toMatchObject({ id: demo.id, theme: 'classic', remaining: '90' });
    expect(store.actions(live.id)).toHaveLength(0);
    expect(store.actions(demo.id)).toHaveLength(1);
    expect(() => store.configureTheme(themed, 'unknown')).toThrow('不支持');
    expect(store.configuration(themed).theme).toBe('monochrome');
  } finally {
    store.close();
  }
});
it('各游戏主题独立持久化；兼容更新沿用，不兼容版本回退，不污染旧包', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhuda-themes-'));
  let store = new LocalStore(join(dir, 'test.sqlite'));
  try {
    store.configureTheme(themed, 'plush');
    store.close();
    store = new LocalStore(join(dir, 'test.sqlite'));
    expect(store.configuration(themed).theme).toBe('plush');
    expect(store.startRound(themed, 'demo', 'demo', '100').theme).toBe('plush');
    expect(store.configuration({ ...themed, version: '0.7.0' }).theme).toBe('plush');
    expect(store.configuration({ ...themed, id: 'game.other' }).theme).toBe('classic');
    expect(store.configuration(manifest).theme).toBe('default');
    const next = { ...themed, version: '0.8.0', themes: [themed.themes![0]!] };
    expect(store.configuration(next).theme).toBe('classic');
    store.configureTheme(next, 'classic');
    expect(store.configuration(themed).theme).toBe('plush');
    expect(store.round('demo')?.theme).toBe('plush');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('通关画面仍可切换主题，保留通关结果与历史', () => {
  const store = new LocalStore(':memory:');
  try {
    const round = store.startRound(themed, 'demo', 'demo', '10');
    store.simulate('2001', '1');
    const before = store.round('demo')!;
    expect(before.status).toBe('won');
    store.configureTheme(themed, 'plush');
    expect(store.round('demo')).toEqual({ ...before, theme: 'plush' });
    expect(store.actions(round.id)).toHaveLength(1);
  } finally {
    store.close();
  }
});
