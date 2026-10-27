import type { SceneSource } from "../../streamingClient/packages/contracts/src/index";
import { battlePresentation, battleSkinParameters } from "./presentation";
const attributes = [
  ["Health", "生命", 160],
  ["Attack", "攻击", 40],
  ["Defense", "防御", 40],
  ["Speed", "速度", 10],
] as const;
export const dragonSource: SceneSource = {
  id: "duel",
  name: "猪大 VS 恶龙",
  description:
    "双阵营送礼养成，备战倒计时后恶龙进攻，猪大凭属性抵挡、闪避或回击。",
  entry: "index.html",
  width: battlePresentation.width,
  height: battlePresentation.height,
  sizing: "scale",
  runtime: "interactive",
  instructionSourceId: "instructions",
  battle: {
    version: 1,
    prepSeconds: 20,
    clashSeconds: 8,
    retention: 0.4,
    prepParameter: "prepSeconds",
    retentionParameter: "retention",
  },
  parameters: [
    ...battleSkinParameters,
    {
      key: "prepSeconds",
      label: "备战时长（秒，重新开始生效）",
      type: "number",
      default: 20,
      min: 5,
      max: 120,
      group: "战斗规则",
    },
    {
      key: "retention",
      label: "攻防速度加成保留比例（重新开始生效）",
      type: "number",
      default: 0.4,
      min: 0,
      max: 1,
      group: "战斗规则",
    },
    ...(["hero", "dragon"] as const).flatMap((side) =>
      attributes.map(([stat, label]) => ({
        key: `${side}${stat}`,
        label: `${side === "hero" ? "猪大" : "恶龙"}基础${label}（重新开始生效）`,
        type: "number" as const,
        default: (
          {
            heroHealth: 2400,
            heroAttack: 320,
            heroDefense: 190,
            heroSpeed: 50,
            dragonHealth: 3600,
            dragonAttack: 360,
            dragonDefense: 150,
            dragonSpeed: 60,
          } as Record<string, number>
        )[`${side}${stat}`]!,
        min: 1,
        max: 1_000_000,
        group: "基础属性",
      })),
    ),
  ],
  variables: (["hero", "dragon"] as const).flatMap((side) =>
    attributes.map(([stat, label]) => ({
      key: `${side}${stat}`,
      label: `${side === "hero" ? "猪大" : "恶龙"}${label}`,
      parameter: `${side}${stat}`,
      initial: (
        {
          heroHealth: 2400,
          heroAttack: 320,
          heroDefense: 190,
          heroSpeed: 50,
          dragonHealth: 3600,
          dragonAttack: 360,
          dragonDefense: 150,
          dragonSpeed: 60,
        } as Record<string, number>
      )[`${side}${stat}`]!,
    })),
  ),
  events: (["hero", "dragon"] as const).flatMap((side) =>
    attributes.map(([stat, label, amount]) => ({
      id: `${side}-${stat.toLowerCase()}`,
      label: `${side === "hero" ? "猪大" : "恶龙"} · ${label}提升`,
      description:
        stat === "Health"
          ? "增加生命上限并恢复等量生命，战败后不会复活。"
          : `增加${label}，在下一次交战生效；结算后保留部分加成。`,
      operation: "effect" as const,
      amountLabel: `每件增加${label}`,
      unit: "点",
      min: 1,
      max: 1_000_000,
      default: amount,
      mutation: { target: `${side}${stat}`, operation: "add" as const },
    })),
  ),
  // The streamer chooses real gift IDs from the host's synced catalog; no invented IDs.
  rules: [],
  themes: [],
};
export const dragonPlugin = {
  kind: "plugin",
  apiVersion: 1,
  id: "plugin.dragon",
  version: "2.2.1",
  minAppVersion: "0.3.0",
  name: "猪大 VS 恶龙",
  description:
    "方形双阵营战斗组件：横式战斗画面与双方数值面板，支持礼物养成和定时交锋。",
  publisher: "猪大官方",
  category: "stream",
  workspace: false,
  entry: "index.html",
  permissions: ["scene-events"],
  sceneSources: [
    dragonSource,
    {
      id: "instructions",
      kind: "instructions",
      name: "对决礼物说明",
      description: "显示主播实际配置的双方礼物映射。",
      entry: "instructions.html",
      width: 1080,
      height: 760,
      runtime: "static",
      parameters: [],
      events: [],
      rules: [],
      themes: [],
    },
  ],
};
