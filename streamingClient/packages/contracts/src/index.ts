import { pluginId, type PluginSnapshot, type PluginCommand, type PluginRequest } from './plugins';
export * from './plugins';
export * from './scenes';
export * from './hotkeys';
export { systemText } from './locale';
import type { SceneSnapshot, SceneCommand } from './scenes';
import { z } from 'zod';

export const APP_VERSION = '0.3.2';
export const GAME_API_VERSION = 1;
export const gameProductId = z.string().regex(/^(game|prank)\.[a-z0-9-]{1,48}$/);
export const productId = z.union([gameProductId, pluginId]);
export const deviceId = z.string().uuid();
export const decimal = z.string().regex(/^(0|[1-9][0-9]{0,39})$/);
export const roomInput = z.string().trim().max(150);
export function parseRoom(input: string): string {
  let value = roomInput.parse(input);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const url = new URL(value);
    if (
      url.hostname !== 'live.douyin.com' ||
      url.username ||
      url.password ||
      url.port ||
      !['http:', 'https:'].includes(url.protocol)
    )
      throw new Error('请输入抖音官方直播网址');
    value = url.pathname.replace(/^\/+|\/+$/g, '');
  }
  // Official live URLs also accept alphabetic identifiers. Keep this as text;
  // a handle may contain letters or leading zeroes and is not an internal room ID.
  if (!/^(?!\.{1,2}$)[A-Za-z0-9._-]{1,64}$/.test(value))
    throw new Error('请输入英数直播号（可含底线、连字号、点号，最多 64 字）或抖音官方直播网址');
  return value;
}
export interface SignedValue {
  payload: string;
  signature: string;
}
export const gameRule = z
  .object({
    giftId: z.string().regex(/^[1-9][0-9]{0,19}$/),
    giftName: z.string().min(1).max(80),
    eventId: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,47}$/)
      .optional(),
    amount: z.number().int().min(1).max(1_000_000).optional(),
    delta: z.number().int().min(-1_000_000).max(1_000_000),
  })
  .strict()
  .refine((rule) => rule.delta !== 0 || !!rule.eventId, '纯特效须指定游戏事件');
export const gameEvent = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
    label: z.string().min(1).max(60),
    description: z.string().max(200),
    operation: z.enum(['add', 'subtract', 'effect']),
    amountLabel: z.string().min(1).max(40),
    unit: z.string().max(12),
    min: z.number().int().min(1).max(1_000_000),
    max: z.number().int().min(1).max(1_000_000),
    default: z.number().int().min(1).max(1_000_000),
    mutation: z
      .object({
        target: z.string().regex(/^[a-z][a-zA-Z0-9-]{0,47}$/),
        operation: z.enum(['add', 'subtract', 'multiply', 'set']),
        value: z.number().int().min(0).max(1_000_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((event) => event.min <= event.default && event.default <= event.max, '事件参数范围错误');
export type GameEventDefinition = z.infer<typeof gameEvent>;
export const themeId = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
export const gameTheme = z
  .object({
    id: themeId,
    name: z.string().min(1).max(40),
    description: z.string().max(160),
    accent: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  })
  .strict();
export type GameThemeDefinition = z.infer<typeof gameTheme>;
export function themesFor(game: { themes?: GameThemeDefinition[] }): GameThemeDefinition[] {
  return (
    game.themes ?? [{ id: 'default', name: '原版', description: '游戏原始外观', accent: '#d8f68b' }]
  );
}
export function themeFor(
  game: { themes?: GameThemeDefinition[]; defaultTheme?: string },
  selected?: string,
): string {
  const themes = themesFor(game);
  return themes.find((theme) => theme.id === selected)?.id ?? game.defaultTheme ?? themes[0]!.id;
}
export const gameRules = z
  .array(gameRule)
  .max(500)
  .refine(
    (rules) => new Set(rules.map((rule) => rule.giftId)).size === rules.length,
    '同一礼物只能设置一个触发功能',
  );
export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    apiVersion: z.literal(GAME_API_VERSION),
    id: gameProductId,
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    name: z.string().min(1).max(60),
    description: z.string().max(300),
    category: z.enum(['game', 'prank']),
    entry: z.literal('index.html'),
    files: z.record(
      z.string(),
      z
        .object({
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          bytes: z.number().int().min(0).max(10_000_000),
        })
        .strict(),
    ),
    rules: gameRules,
    events: z.array(gameEvent).min(1).max(100).optional(),
    themes: z.array(gameTheme).min(1).max(30).optional(),
    defaultTheme: themeId.optional(),
    initial: decimal,
    accent: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  })
  .strict()
  .refine(
    (m) => !m.themes || new Set(m.themes.map((theme) => theme.id)).size === m.themes.length,
    '主题 ID 不可重复',
  )
  .refine(
    (m) => !m.defaultTheme || !!m.themes?.some((theme) => theme.id === m.defaultTheme),
    '预设主题必须由此游戏提供',
  )
  .refine(
    (m) => !m.events || new Set(m.events.map((e) => e.id)).size === m.events.length,
    '事件 ID 不可重复',
  )
  .refine((m) => {
    try {
      validateGameRules(eventsFor(m), m.rules);
      return true;
    } catch {
      return false;
    }
  }, '礼物规则与游戏事件不相符');
export type GameManifest = z.infer<typeof manifestSchema>;
export type GameRule = z.infer<typeof gameRule>;
export function eventsFor(manifest: {
  events?: GameEventDefinition[];
  id?: string;
  product?: string;
}): GameEventDefinition[] {
  // Older signed packs predate event metadata. Adapt their existing +/- behavior;
  // new packs define their own IDs, labels and limits in the manifest.
  const legacyProduct = manifest.product ?? manifest.id;
  if (!manifest.events && ['game.chain', 'prank.stage'].includes(legacyProduct ?? '')) {
    const chain = legacyProduct === 'game.chain';
    return [
      {
        id: chain ? 'lock' : 'reverse',
        label: chain ? '添加锁链' : '反转加码',
        description: chain ? '增加锁链并播放绑合特效' : '增加整蛊挑战进度',
        operation: 'add',
        amountLabel: chain ? '添加根数' : '增加进度',
        unit: chain ? '根' : '点',
        min: 1,
        max: 1_000_000,
        default: 1,
      },
      {
        id: chain ? 'unlock' : 'shake',
        label: chain ? '解开锁链' : '舞台震动',
        description: chain ? '移除锁链并播放断裂熔化特效' : '震动舞台并减少挑战进度',
        operation: 'subtract',
        amountLabel: chain ? '解开根数' : '减少进度',
        unit: chain ? '根' : '点',
        min: 1,
        max: 1_000_000,
        default: 1,
      },
    ];
  }
  return (
    manifest.events ?? [
      {
        id: 'increase',
        label: '增加数量',
        description: '增加玩法计数',
        operation: 'add',
        amountLabel: '增加数量',
        unit: '',
        min: 1,
        max: 1_000_000,
        default: 1,
      },
      {
        id: 'decrease',
        label: '减少数量',
        description: '减少玩法计数',
        operation: 'subtract',
        amountLabel: '减少数量',
        unit: '',
        min: 1,
        max: 1_000_000,
        default: 1,
      },
    ]
  );
}
export function validateGameRules(events: GameEventDefinition[], input: unknown): GameRule[] {
  return gameRules.parse(input).map((rule) => {
    const event = rule.eventId
      ? events.find((e) => e.id === rule.eventId)
      : events.find((e) => e.operation === (rule.delta < 0 ? 'subtract' : 'add'));
    const amount = rule.amount ?? (Math.abs(rule.delta) || event?.default || 1);
    if (
      !event ||
      amount < event.min ||
      amount > event.max ||
      rule.delta !==
        (event.operation === 'effect' ? 0 : event.operation === 'subtract' ? -amount : amount)
    )
      throw new Error('礼物功能或参数超出此游戏支持范围');
    return { ...rule, eventId: event.id, amount };
  });
}
export interface GameConfiguration {
  product: string;
  packageVersion: string;
  events: GameEventDefinition[];
  rules: GameRule[];
  themes: GameThemeDefinition[];
  theme: string;
}
export const giftCatalogItem = z
  .object({
    id: z.string().regex(/^[1-9][0-9]{0,19}$/),
    name: z.string().min(1).max(80),
    diamonds: z.number().int().nonnegative().max(1_000_000_000).nullable(),
    iconUrl: z.url().max(2000).optional(),
  })
  .strict();
export type GiftCatalogItem = z.infer<typeof giftCatalogItem>;
export interface GiftCatalogSnapshot {
  gifts: GiftCatalogItem[];
  updatedAt: string;
  status: 'ready' | 'syncing' | 'offline';
}
export interface CatalogItem {
  manifest: GameManifest;
  sha256: string;
  bytes: number;
  signature: SignedValue;
  downloadPath: string;
}
export interface GiftEvent {
  id: string;
  seq?: string;
  runId: string;
  source: 'live' | 'demo';
  webId: string;
  roomId: string;
  messageId: string;
  receivedAt: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  giftId: string;
  giftName: string;
  groupId: string;
  rawCounts: Record<string, string>;
  cumulative: string | null;
  delta: string | null;
  quality: 'inferred' | 'partial' | 'duplicate' | 'ambiguous' | 'parse_error';
  note: string;
  final: boolean | null;
}
export interface DecodedGift extends GiftEvent {
  countMode?: 'single' | 'cumulative';
  count?: string;
  comboKey?: string;
  startsCombo?: boolean;
}
export interface Round {
  id: string;
  product: string;
  packageVersion: string;
  mode: 'live' | 'demo';
  webId: string;
  initial: string;
  remaining: string;
  status: 'running' | 'won' | 'stopped';
  startedAt: string;
  startSeq: string;
  rules: GameRule[];
  events?: GameEventDefinition[];
  themes?: GameThemeDefinition[];
  theme?: string;
}
export interface GameAction {
  seq?: number;
  id: string;
  roundId: string;
  giftId: string;
  giftName: string;
  senderName: string;
  quantity: string;
  delta: string;
  eventId?: string;
  eventName?: string;
  value?: string;
  before: string;
  after: string;
  won: boolean;
  at: string;
}
export interface GameState {
  round: Round | null;
  recent: GameAction[];
  lastAction: GameAction | null;
  background: 'green' | 'transparent' | 'dark';
}
export interface CollectorStatus {
  state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopped';
  webId: string;
  loggedIn: boolean;
  messageCount: number;
  giftCount: number;
  parseErrors: number;
  lastMessageAt: string | null;
  lastGiftAt: string | null;
  partial: boolean;
  message: string;
}
export interface StreamMessage {
  id: string;
  receivedAt: string;
  webId: string;
  method: string;
  messageId: string;
  bytes: number;
}
export interface CollectorEvent {
  id: string;
  receivedAt: string;
  webId: string;
  state: CollectorStatus['state'];
  level: 'info' | 'warning' | 'error';
  message: string;
}
export interface StreamObservations {
  runId: string;
  messages: StreamMessage[];
  events: CollectorEvent[];
  errors: CollectorEvent[];
  errorCount: number;
}
export interface LibraryItem {
  manifest: GameManifest;
  installedVersion: string | null;
  configuration: GameConfiguration | null;
}
export interface StudioSnapshot {
  sequence?: number;
  appVersion: string;
  platform: string;
  deviceId: string;
  development: boolean;
  tutorialDismissed: boolean;
  plugins?: PluginSnapshot;
  scene?: SceneSnapshot;
  collector: CollectorStatus;
  observations: StreamObservations;
  giftCatalog: GiftCatalogSnapshot;
  library: LibraryItem[];
  gifts: GiftEvent[];
  round: Round | null;
  actions: GameAction[];
  outputOpen: boolean;
  background: GameState['background'];
  outputLayout: 'landscape' | 'portrait';
}
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tutorialPreference'), dismissed: z.boolean() }),
  z.object({ type: z.literal('login') }),
  z.object({ type: z.literal('monitor'), room: roomInput }),
  z.object({ type: z.literal('stopMonitor') }),
  z.object({ type: z.literal('install'), product: productId }),
  z.object({
    type: z.literal('startRound'),
    product: productId,
    mode: z.enum(['live', 'demo']),
    initial: z.string().regex(/^[1-9][0-9]{0,8}$/),
  }),
  z.object({ type: z.literal('stopRound') }),
  z.object({
    type: z.literal('selectTheme'),
    product: productId,
    packageVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    theme: themeId,
  }),
  z.object({
    type: z.literal('saveGiftRules'),
    product: productId,
    packageVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    rules: gameRules,
  }),
  z.object({
    type: z.literal('simulate'),
    giftId: z.string().regex(/^[1-9][0-9]{0,19}$/),
    quantity: z.string().regex(/^[1-9][0-9]{0,5}$/),
  }),
  z.object({
    type: z.literal('output'),
    background: z.enum(['green', 'transparent', 'dark']),
    layout: z.enum(['landscape', 'portrait']).optional(),
  }),
  z.object({ type: z.literal('closeOutput') }),
  z.object({ type: z.literal('showCollector') }),
  z.object({ type: z.literal('exportDiagnostics') }),
]);
export type StudioCommand = z.infer<typeof commandSchema>;
export interface StudioBridge {
  reportSourceError(id: string, message: string): Promise<void>;
  mobilePreview(
    action: 'start' | 'stop' | 'status',
  ): Promise<import('./scenes').MobilePreviewStatus>;
  setHotkeyCapture(active: boolean): Promise<void>;
  sceneCommand(command: SceneCommand): Promise<StudioSnapshot>;
  sceneSnapshot(): Promise<SceneSnapshot>;
  subscribeScene(callback: (snapshot: SceneSnapshot) => void): () => void;
  snapshot(): Promise<StudioSnapshot>;
  pluginCommand(command: PluginCommand): Promise<StudioSnapshot>;
  pluginRequest(id: string, request: PluginRequest): Promise<unknown>;
  command(command: StudioCommand): Promise<StudioSnapshot>;
  subscribe(callback: (snapshot: StudioSnapshot) => void): () => void;
}
export interface GameBridge {
  snapshot(): Promise<GameState>;
  subscribe(callback: (state: GameState) => void): () => void;
}

export * from './duel';
