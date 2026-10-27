import type {
  GameEventDefinition,
  SceneSource,
  PluginManifest,
} from "../../streamingClient/packages/contracts/src/index";
import { taskMetrics } from "./task-metrics";

function action(
  id: string,
  label: string,
  operation: GameEventDefinition["operation"],
  unit: string,
  amount = 1,
  mutation?: GameEventDefinition["mutation"],
): GameEventDefinition {
  return {
    id,
    label,
    description: label,
    operation,
    amountLabel: unit === "秒" ? "时间" : "数值",
    unit,
    min: 1,
    max: 1_000_000,
    default: amount,
    ...(mutation ? { mutation } : {}),
  };
}
const themes = [
  {
    id: "noir",
    name: "黑金典藏",
    description: "复古黑金机身、冷钢牢笼与金色缝线",
    accent: "#efc982",
  },
  {
    id: "chrome",
    name: "银蓝工业",
    description: "银蓝金属、冰蓝灯光与电光缝线",
    accent: "#80dcff",
  },
  {
    id: "rose",
    name: "奶油莓粉",
    description: "奶油粉机身、玫瑰金牢笼与闪光缝线",
    accent: "#ff9cc8",
  },
];
const shared = [
  {
    key: "title",
    label: "玩法标题",
    type: "text" as const,
    default: "缝纫机挑战",
    live: true,
  },
  {
    key: "color",
    label: "文字颜色",
    type: "color" as const,
    default: "#ffffff",
    live: true,
  },
  {
    key: "accent",
    label: "特效颜色",
    type: "color" as const,
    default: "#efc982",
    live: true,
  },
];
export const sewingSource: SceneSource = {
  id: "sewing",
  name: "缝纫机挑战",
  description: "追加订单送来新布料，加速缝制完成订单，收工打开牢门。",
  entry: "sewing.html",
  width: 1080,
  height: 1920,
  runtime: "interactive",
  completion: { text: "下班啦！", color: "#efc982" },
  parameters: [
    ...shared,
    {
      key: "duration",
      label: "本轮时长（秒，重新开始生效）",
      type: "number",
      default: 1800,
      min: 10,
      max: 86400,
    },
    { key: "bars", label: "显示监狱栅栏", type: "boolean", default: true },
    {
      key: "soundEnabled",
      label: "播放缝纫机音效",
      type: "boolean",
      default: true,
      live: true,
      group: "音效",
    },
    {
      key: "soundVolume",
      label: "音效音量",
      type: "number",
      default: 60,
      min: 0,
      max: 100,
      live: true,
      group: "音效",
    },
    {
      key: "intensity",
      label: "特效强度",
      type: "select",
      default: "full",
      options: [
        { value: "full", label: "完整特效" },
        { value: "soft", label: "柔和特效" },
      ],
    },
  ],
  counter: { initial: "1", label: "待缝布料" },
  variables: [
    {
      key: "seconds",
      label: "剩余时间",
      initial: 1800,
      parameter: "duration",
      clock: "countdown",
      finishAtZero: true,
    },
  ],
  events: [
    action("stitch-add", "追加订单", "add", "块"),
    action("stitch-remove", "加速缝制", "subtract", "块"),
    action("stitch-multiply", "订单翻倍", "effect", "倍", 2, {
      target: "remaining",
      operation: "multiply",
    }),
    action("release", "一键完工 · 开门", "effect", "次", 1, {
      target: "remaining",
      operation: "set",
      value: 0,
    }),
    action("time-add", "增加时间", "effect", "秒", 60, {
      target: "seconds",
      operation: "add",
    }),
    action("time-remove", "减少时间", "effect", "秒", 60, {
      target: "seconds",
      operation: "subtract",
    }),
    action("time-multiply", "时间翻倍", "effect", "倍", 2, {
      target: "seconds",
      operation: "multiply",
    }),
    action("overdrive", "缝纫机过载特效", "effect", "次", 1),
  ],
  rules: [
    {
      giftId: "1",
      giftName: "抖音",
      eventId: "stitch-remove",
      amount: 1,
      delta: -1,
    },
    {
      giftId: "2001",
      giftName: "玫瑰",
      eventId: "stitch-add",
      amount: 1,
      delta: 1,
    },
  ],
  themes,
  defaultTheme: "noir",
};
export const tasksSource: SceneSource = {
  id: "tasks",
  name: "直播任务单",
  description: "送礼人数、点赞、关注与自定义目标分，实时推进直播任务。",
  entry: "tasks.html",
  width: 1000,
  height: 680,
  runtime: "interactive",
  sizing: "scale",
  splitSources: [
    { sourceId: "task-score", x: 0, y: 504 },
    { sourceId: "task-gifts", x: 0, y: 0 },
    { sourceId: "task-likes", x: 0, y: 168 },
    { sourceId: "task-follows", x: 0, y: 336 },
  ],
  parameters: [
    {
      key: "title",
      label: "任务单标题",
      type: "text",
      default: "今日直播任务",
    },
    { key: "color", label: "文字颜色", type: "color", default: "#ffffff" },
    { key: "accent", label: "进度条颜色", type: "color", default: "#ff9cc8" },
    {
      key: "giftGoal",
      label: "送礼人数目标",
      type: "number",
      default: 30,
      min: 1,
      max: 1000000,
    },
    {
      key: "likeGoal",
      label: "点赞目标",
      type: "number",
      default: 10000,
      min: 1,
      max: 1000000000,
    },
    {
      key: "followGoal",
      label: "关注人数目标",
      type: "number",
      default: 10,
      min: 1,
      max: 1000000,
    },
    {
      key: "scoreGoal",
      label: "目标分",
      type: "number",
      default: 10000,
      min: 1,
      max: 1000000000,
    },
    {
      key: "scoreTitle",
      label: "目标分名称",
      type: "text",
      default: "心愿进度",
    },
    {
      key: "scoreVisible",
      label: "显示目标分",
      type: "boolean",
      default: true,
    },
    { key: "panel", label: "显示底板", type: "boolean", default: false },
  ],
  variables: [
    { key: "giftPeople", label: "送礼人数", initial: 0 },
    { key: "likes", label: "点赞数量", initial: 0 },
    { key: "follows", label: "关注人数", initial: 0 },
    { key: "score", label: "目标分", initial: 0 },
  ],
  observations: [
    { kind: "gift-sender", target: "giftPeople" },
    { kind: "like", target: "likes" },
    { kind: "follow", target: "follows" },
  ],
  events: [
    action("score-add", "增加目标分", "effect", "分", 100, {
      target: "score",
      operation: "add",
    }),
    action("score-remove", "减少目标分", "effect", "分", 50, {
      target: "score",
      operation: "subtract",
    }),
    action("score-multiply", "目标分翻倍", "effect", "倍", 2, {
      target: "score",
      operation: "multiply",
    }),
    action("score-reset", "目标分归零", "effect", "次", 1, {
      target: "score",
      operation: "set",
      value: 0,
    }),
    action("celebrate", "庆祝特效", "effect", "次", 1),
  ],
  rules: [
    {
      giftId: "1",
      giftName: "抖音",
      eventId: "score-add",
      amount: 100,
      delta: 0,
    },
    {
      giftId: "2001",
      giftName: "玫瑰",
      eventId: "score-remove",
      amount: 50,
      delta: 0,
    },
  ],
  themes: [
    {
      id: "rose",
      name: "莓粉心愿",
      description: "莓粉渐变进度条与柔光亮点",
      accent: "#ff9cc8",
    },
    {
      id: "chrome",
      name: "冰蓝星光",
      description: "冰蓝能量条与星光庆祝特效",
      accent: "#80dcff",
    },
    {
      id: "noir",
      name: "黑金里程碑",
      description: "香槟金进度条与金色流光",
      accent: "#efc982",
    },
  ],
  defaultTheme: "rose",
};

export const taskBarSources: SceneSource[] = taskMetrics.map((metric) => ({
  id: metric.id,
  name: metric.key === "score" ? "心愿进度条" : `${metric.label}进度条`,
  description: metric.observation
    ? `自动接收直播${metric.label}，独立摆放与缩放。`
    : "由礼物或热键推进的独立目标进度条。",
  entry: `${metric.id}.html`,
  width: 1000,
  height: 144,
  runtime: "interactive",
  sizing: "scale",
  parameters: [
    {
      key: metric.title,
      label: "进度条名称",
      type: "text",
      default: metric.label,
      live: true,
    },
    {
      key: metric.goal,
      label: "目标数值",
      type: "number",
      default: metric.initialGoal,
      min: 1,
      max: metric.max,
      live: true,
    },
    {
      key: "color",
      label: "文字颜色",
      type: "color",
      default: "#ffffff",
      live: true,
    },
    {
      key: "accent",
      label: "进度条颜色",
      type: "color",
      default: "#ff9cc8",
      live: true,
    },
    {
      key: "showPercent",
      label: "显示百分比",
      type: "boolean",
      default: true,
      live: true,
    },
    {
      key: "celebration",
      label: "目标达成特效",
      type: "boolean",
      default: true,
      live: true,
    },
  ],
  variables: [{ key: metric.key, label: metric.label, initial: 0 }],
  observations: metric.observation
    ? [{ kind: metric.observation, target: metric.key }]
    : [],
  events:
    metric.key === "score"
      ? tasksSource.events
      : [
          action(
            `${metric.key.toLowerCase()}-add`,
            `增加${metric.label}`,
            "effect",
            "次",
            1,
            {
              target: metric.key,
              operation: "add",
            },
          ),
          action(
            `${metric.key.toLowerCase()}-remove`,
            `减少${metric.label}`,
            "effect",
            "次",
            1,
            {
              target: metric.key,
              operation: "subtract",
            },
          ),
          action(
            `${metric.key.toLowerCase()}-reset`,
            `${metric.label}归零`,
            "effect",
            "次",
            1,
            {
              target: metric.key,
              operation: "set",
              value: 0,
            },
          ),
          action("celebrate", "庆祝特效", "effect", "次", 1),
        ],
  rules: metric.key === "score" ? tasksSource.rules : [],
  themes: tasksSource.themes,
  defaultTheme: "rose",
}));

export const liveModePlugins: Omit<PluginManifest, "files">[] = [
  {
    kind: "plugin",
    apiVersion: 1,
    id: "plugin.sewing",
    version: "1.4.2",
    minAppVersion: "0.3.0",
    workspace: false,
    name: "缝纫机挑战",
    description: sewingSource.description,
    publisher: "猪大官方",
    category: "stream",
    entry: "index.html",
    permissions: ["scene-events"],
    sceneSources: [sewingSource],
  },
  {
    kind: "plugin",
    apiVersion: 1,
    id: "plugin.tasks",
    version: "1.1.2",
    minAppVersion: "0.3.0",
    workspace: false,
    name: "直播任务进度条",
    description: "送礼、点赞、关注与心愿四种独立进度条，自由搭建直播画面。",
    publisher: "猪大官方",
    category: "stream",
    entry: "index.html",
    permissions: ["scene-events"],
    sceneSources: [...taskBarSources, tasksSource],
  },
];
