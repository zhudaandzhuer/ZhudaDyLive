import { z } from 'zod';
import { duelConfigSchema, type DuelState } from './duel';
import { gameEvent, gameRules, gameTheme, type GameState, type GameRule } from './index';
import { globalHotkeysSchema, sceneHotkeysSchema, type SceneHotkeyStatus } from './hotkeys';

const key = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,47}$/);
const parameter = z
  .object({
    key,
    label: z.string().min(1).max(40),
    type: z.enum(['text', 'number', 'color', 'boolean', 'select', 'image', 'video']),
    default: z.union([z.string().max(4000), z.number().finite(), z.boolean()]),
    group: z.string().trim().min(1).max(40).optional(),
    live: z.boolean().optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    options: z
      .array(z.object({ value: z.string().max(60), label: z.string().max(40) }).strict())
      .max(30)
      .optional(),
  })
  .strict();
export const sceneSourceSchema = z
  .object({
    id: key,
    name: z.string().min(1).max(60),
    description: z.string().max(300),
    entry: z
      .string()
      .regex(/^[a-zA-Z0-9_/-]+\.html$/)
      .max(150),
    width: z.number().int().min(16).max(8192),
    height: z.number().int().min(16).max(8192),
    parameters: z
      .array(parameter)
      .max(30)
      .refine((p) => new Set(p.map((x) => x.key)).size === p.length),
    events: z.lazy(() => z.array(gameEvent).max(100)),
    rules: z.lazy(() => gameRules),
    themes: z.lazy(() => z.array(gameTheme).max(30)),
    runtime: z.enum(['static', 'interactive', 'media']).optional(),
    battle: duelConfigSchema.optional(),
    kind: z.enum(['content', 'instructions', 'status', 'view']).optional(),
    instructionSourceId: key.optional(),
    statusSourceId: key.optional(),
    targetSourceId: key.optional(),
    defaultTheme: z.string().max(48).optional(),
    sizing: z.enum(['scale', 'layout']).optional(),
    splitSources: z
      .array(
        z
          .object({
            sourceId: key,
            x: z.number().finite().min(0).max(8192),
            y: z.number().finite().min(0).max(8192),
          })
          .strict(),
      )
      .min(2)
      .max(8)
      .optional(),
    completion: z
      .object({ text: z.string().max(120), color: z.string().regex(/^#[a-fA-F0-9]{6}$/) })
      .strict()
      .optional(),
    variables: z
      .array(
        z
          .object({
            key,
            label: z.string().min(1).max(40),
            initial: z.number().int().min(0).max(1_000_000_000),
            parameter: key.optional(),
            clock: z.literal('countdown').optional(),
            finishAtZero: z.boolean().optional(),
          })
          .strict(),
      )
      .max(16)
      .optional(),
    observations: z
      .array(
        z
          .object({
            kind: z.enum(['like', 'follow', 'gift-sender', 'gift']),
            target: key,
          })
          .strict(),
      )
      .max(16)
      .optional(),
    counter: z
      .object({ initial: z.string().regex(/^[1-9][0-9]{0,8}$/), label: z.string().max(40) })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (source) =>
      !source.battle ||
      (source.runtime === 'interactive' &&
        !source.counter &&
        !['instructions', 'status', 'view'].includes(source.kind ?? '') &&
        ['hero', 'dragon'].every((side) =>
          ['Health', 'Attack', 'Defense', 'Speed'].every((stat) =>
            source.variables?.some((v) => v.key === `${side}${stat}` && v.initial > 0 && !v.clock),
          ),
        ) &&
        [source.battle.prepParameter, source.battle.retentionParameter].every(
          (key) => !key || source.parameters.some((p) => p.key === key && p.type === 'number'),
        )),
    '对战来源必须声明八项正数属性和有效参数',
  )
  .refine(
    (source) => new Set(source.events.map((e) => e.id)).size === source.events.length,
    '来源动作不可重复',
  )
  .refine(
    (source) =>
      ['status', 'view'].includes(source.kind ?? '')
        ? !!source.targetSourceId &&
          !source.events.length &&
          !source.rules.length &&
          !source.counter &&
          !source.variables?.length &&
          !source.observations?.length &&
          !source.completion &&
          !source.statusSourceId &&
          !source.splitSources &&
          (!source.runtime || source.runtime === 'static')
        : !source.targetSourceId,
    '状态面板必须声明绑定来源，且不能独立处理交互',
  )
  .refine(
    (source) =>
      !source.completion ||
      source.parameters.every(
        (p) =>
          ![
            'completionEnabled',
            'completionText',
            'completionDuration',
            'completionColor',
            'completionFireworks',
          ].includes(p.key),
      ),
    '完成特效参数名已由工作台保留',
  )
  .refine((source) => {
    const keys = new Set(source.variables?.map((v) => v.key) ?? []);
    return (
      keys.size === (source.variables?.length ?? 0) &&
      !keys.has('remaining') &&
      (source.variables ?? []).every(
        (v) =>
          !v.parameter ||
          source.parameters.some((p) => p.key === v.parameter && p.type === 'number'),
      ) &&
      source.events.every(
        (e) => !e.mutation || e.mutation.target === 'remaining' || keys.has(e.mutation.target),
      ) &&
      (source.observations ?? []).every((o) => keys.has(o.target))
    );
  }, '来源变量或动作目标无效');
export type SceneSource = z.infer<typeof sceneSourceSchema>;
export type SceneParameter = SceneSource['parameters'][number];
export function completionParameters(
  config: NonNullable<SceneSource['completion']>,
): SceneParameter[] {
  const parameters: SceneParameter[] = [
    { key: 'completionEnabled', label: '播放完成特效', type: 'boolean', default: true },
    { key: 'completionText', label: '完成文案', type: 'text', default: config.text },
    {
      key: 'completionDuration',
      label: '展示时长（秒，下次完成生效）',
      type: 'number',
      default: 4,
      min: 3,
      max: 5,
    },
    { key: 'completionColor', label: '特效颜色', type: 'color', default: config.color },
    { key: 'completionFireworks', label: '播放烟火', type: 'boolean', default: true },
  ];
  return parameters.map((p) => ({ ...p, group: '完成特效', live: true }));
}
export function sceneParameters(source: SceneSource): SceneParameter[] {
  return [
    ...source.parameters,
    ...(source.completion ? completionParameters(source.completion) : []),
  ];
}
export const sceneLayerSchema = z
  .object({
    id: z.string().uuid(),
    pluginId: z.string().regex(/^plugin\.[a-z0-9][a-z0-9-]{0,47}$/),
    pluginVersion: z
      .string()
      .max(50)
      .regex(/^\d+\.\d+\.\d+$/),
    sourceId: key,
    name: z.string().trim().min(1).max(60),
    x: z.number().finite().min(-8192).max(16384),
    y: z.number().finite().min(-8192).max(16384),
    width: z.number().finite().min(16).max(8192),
    height: z.number().finite().min(16).max(8192),
    contentSize: z
      .object({
        width: z.number().finite().min(16).max(8192),
        height: z.number().finite().min(16).max(8192),
      })
      .strict()
      .nullable()
      .optional(),
    rotation: z.number().finite().min(-180).max(180),
    opacity: z.number().min(0).max(1),
    visible: z.boolean(),
    locked: z.boolean(),
    initial: z
      .string()
      .regex(/^[1-9][0-9]{0,8}$/)
      .optional(),
    settings: z.record(
      z.string().max(48),
      z.union([z.string().max(4000), z.number().finite(), z.boolean()]),
    ),
    theme: z.string().max(48),
    rules: z.lazy(() => gameRules),
    hotkeys: sceneHotkeysSchema.optional(),
    binding: z.object({ targetLayerId: z.string().uuid() }).strict().optional(),
  })
  .strict();
export type SceneLayer = z.infer<typeof sceneLayerSchema>;
export const sceneDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
    width: z.number().int().min(240).max(8192),
    height: z.number().int().min(240).max(8192),
    background: z.enum(['transparent', 'green', 'dark']),
    layers: z
      .array(sceneLayerSchema)
      .max(32)
      .refine((layers) => new Set(layers.map((l) => l.id)).size === layers.length),
    globalHotkeys: globalHotkeysSchema.optional(),
    revision: z.number().int().nonnegative(),
    updatedAt: z.string(),
  })
  .strict();
export type SceneDocument = z.infer<typeof sceneDocumentSchema>;
export interface SceneEvent {
  id: string;
  seq?: number;
  kind: 'gift' | 'message' | 'status';
  source: 'live' | 'demo';
  webId: string;
  at: string;
  data: Record<string, string | number | boolean | null>;
}
export interface SceneRuntime {
  // Interaction lifecycle. Completion lives in game.round.status and keeps reception running.
  status: 'idle' | 'running' | 'paused' | 'stopped' | 'won';
  mode: 'live' | 'demo';
  webId: string;
  startedAt: string;
  startSeq: string;
  elapsedMs?: number;
  completedAt?: number;
  completionId?: string;
  completionDurationMs?: number;
  game: GameState;
  events: SceneEvent[];
  eventSeq?: number;
  actionSeq?: number;
  failure?: { message: string; at: string };
  variables?: Record<string, number>;
  battle?: DuelState;
}
export interface SceneLayerView {
  failure?: SceneRuntime['failure'];
  layer: SceneLayer;
  source: SceneSource | null;
  available: boolean;
  error: string | null;
  runtime: SceneRuntime;
  url: string | null;
  instructions?: SceneInstructions;
  variables?: Record<string, number>;
  battle?: DuelState;
}
export interface SceneInstructions {
  targetLayerId: string;
  targetName: string;
  theme: string;
  mappings: {
    giftId: string;
    giftName: string;
    icon: string | null;
    eventId: string;
    label: string;
    description: string;
    operation: 'add' | 'subtract' | 'effect';
    amount: number;
    unit: string;
  }[];
}
export interface SceneLibraryEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  layerCount: number;
  updatedAt: string;
}
export interface SceneSnapshot {
  history?: { canUndo: boolean; canRedo: boolean };
  document: SceneDocument;
  library: SceneLibraryEntry[];
  layers: SceneLayerView[];
  outputOpen: boolean;
  generatedAt: number;
  warning?: string;
  hotkeys?: SceneHotkeyStatus[];
}
export interface MobilePreviewStatus {
  active: boolean;
  addresses: { name: string; address: string; url: string; qr: string }[];
}
export interface SceneFrameState {
  audio?: { enabled: boolean; transport?: 'host' };
  /** Total presentation scale, including the scene and source transforms. */
  renderScale?: number;
  viewport?: { width: number; height: number; scale: number };
  visible?: boolean;
  layerId: string;
  name: string;
  settings: SceneLayer['settings'];
  theme: string;
  status: SceneRuntime['status'];
  mode: SceneRuntime['mode'];
  /** Changes only when the playback timeline changes, never for presentation edits. */
  playbackRevision?: string;
  playbackTime: number;
  completion?: { id: string; at: number; durationMs?: number };
  game: GameState;
  events: SceneEvent[];
  instructions?: SceneInstructions;
  variables?: Record<string, number>;
  battle?: DuelState;
}
export const sceneCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('undo'), sceneId: z.string().uuid().optional() }).strict(),
  z.object({ action: z.literal('redo'), sceneId: z.string().uuid().optional() }).strict(),
  z.object({ action: z.literal('exportScene'), sceneId: z.string().uuid().optional() }).strict(),
  z.object({ action: z.literal('importScene'), sceneId: z.string().uuid().optional() }).strict(),
  z
    .object({
      action: z.literal('addView'),
      sceneId: z.string().uuid().optional(),
      id: z.string().uuid(),
      sourceId: key,
    })
    .strict(),
  z
    .object({
      action: z.literal('retrySource'),
      sceneId: z.string().uuid().optional(),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('split'),
      id: z.string().uuid(),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('hotkeys'),
      id: z.string().uuid(),
      revision: z.number().int().nonnegative(),
      bindings: sceneHotkeysSchema,
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('hotkey'),
      id: z.string().uuid(),
      hotkeyId: z.string().uuid(),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('globalHotkeys'),
      revision: z.number().int().nonnegative(),
      bindings: globalHotkeysSchema,
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('globalHotkey'),
      hotkeyId: z.string().uuid(),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('manual'),
      id: z.string().uuid(),
      eventId: key,
      amount: z.number().int().positive().max(1_000_000),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('settings'),
      id: z.string().uuid(),
      values: sceneLayerSchema.shape.settings,
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('simulateObservation'),
      id: z.string().uuid(),
      kind: z.enum(['like', 'follow', 'gift-sender', 'gift']),
      quantity: z.number().int().min(1).max(1_000_000),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('configure'),
      name: z.string().trim().min(1).max(60),
      width: z.number().int().min(240).max(8192),
      height: z.number().int().min(240).max(8192),
      background: z.enum(['transparent', 'green', 'dark']),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('add'),
      pluginId: z.string().max(60),
      sourceId: key,
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('patch'),
      id: z.string().uuid(),
      revision: z.number().int().nonnegative(),
      patch: sceneLayerSchema
        .omit({ id: true, pluginId: true, pluginVersion: true, sourceId: true })
        .partial(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('order'),
      id: z.string().uuid(),
      direction: z.enum(['up', 'down']),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('reorder'),
      id: z.string().uuid(),
      targetId: z.string().uuid(),
      placement: z.enum(['above', 'below']),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('duplicate'),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('remove'),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('control'),
      id: z.string().uuid(),
      state: z.enum(['start', 'pause', 'resume', 'stop', 'reset']),
      mode: z.enum(['live', 'demo']).optional(),
      initial: z
        .string()
        .regex(/^[1-9][0-9]{0,8}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('setCounter'),
      id: z.string().uuid(),
      value: z.string().regex(/^(0|[1-9][0-9]{0,8})$/),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('simulate'),
      id: z.string().uuid(),
      giftId: z.string().regex(/^[1-9][0-9]{0,19}$/),
      quantity: z.string().regex(/^[1-9][0-9]{0,5}$/),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('globalGift'),
      giftId: z.string().regex(/^[1-9][0-9]{0,19}$/),
      quantity: z.string().regex(/^[1-9][0-9]{0,5}$/),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('trigger'),
      id: z.string().uuid(),
      eventId: key,
      amount: z.number().int().positive().max(1_000_000),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('addInstructions'),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('addStatus'),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('sceneCreate'),
      name: z.string().trim().min(1).max(60),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('sceneCopy'),
      name: z.string().trim().min(1).max(60),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('sceneSwitch'),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('sceneRename'),
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(60),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('sceneDelete'),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('upgrade'),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('output'),
      open: z.boolean(),
    })
    .strict(),
  z
    .object({
      sceneId: z.string().uuid().optional(),
      action: z.literal('importMedia'),
      id: z.string().uuid(),
      key,
    })
    .strict(),
]);
export type SceneCommand = z.infer<typeof sceneCommand>;
export function validateSceneSettings(source: SceneSource, input: SceneLayer['settings']) {
  const next: SceneLayer['settings'] = {};
  const parameters = sceneParameters(source);
  if (Object.keys(input).some((name) => !parameters.some((p) => p.key === name)))
    throw new Error('来源不支持此参数');
  for (const p of parameters) {
    const value = Object.hasOwn(input, p.key) ? input[p.key]! : p.default;
    if (
      p.type === 'number' &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < (p.min ?? -1e6) ||
        value > (p.max ?? 1e6))
    )
      throw new Error(`${p.label}超出范围`);
    if (p.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${p.label}格式错误`);
    if (!['number', 'boolean'].includes(p.type) && typeof value !== 'string')
      throw new Error(`${p.label}格式错误`);
    if (p.type === 'color' && !/^#[a-fA-F0-9]{6}$/.test(String(value)))
      throw new Error('颜色格式错误');
    if (p.type === 'select' && !p.options?.some((o) => o.value === value))
      throw new Error('选项无效');
    if (
      ['image', 'video'].includes(p.type) &&
      value !== '' &&
      !/^zhuda-scene:\/\/media\/[a-f0-9]{64}\.(png|jpg|jpeg|webp|gif|mp4|webm)$/.test(String(value))
    )
      throw new Error('请选择本机素材');
    next[p.key] = value;
  }
  return next;
}
