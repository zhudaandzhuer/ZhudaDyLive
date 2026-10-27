import type { SceneParameter } from "../../streamingClient/packages/contracts/src/index";

/** The arena and scoreboard have independent skins; neither owns battle state. */
export const battlePresentation = {
  width: 1080,
  height: 1080,
  poster: "assets/skins/immortal-arena.png",
  mediaAspectRatio: "16 / 9",
  // The landscape composition must be approved before producing replacement films.
  filmsEnabled: false,
  teams: {
    hero: {
      name: "猪大",
      camp: "守护阵营",
      art: "assets/skins/hero-panel.png",
    },
    dragon: {
      name: "灭世黑龙",
      camp: "恶龙阵营",
      art: "assets/skins/dragon-panel.png",
    },
  },
} as const;

export const battleSkinParameters: SceneParameter[] = [
  {
    key: "arenaImage",
    label: "对战背景图",
    type: "image",
    default: "",
    group: "上方对战画面",
    live: true,
  },
  {
    key: "panelSkin",
    label: "面板皮肤",
    type: "select",
    default: "dark",
    group: "下方数值面板",
    live: true,
    options: [
      { value: "dark", label: "暗色立绘" },
      { value: "light", label: "浅色立绘" },
    ],
  },
  {
    key: "heroPanelImage",
    label: "猪大角色背景",
    type: "image",
    default: "",
    group: "下方数值面板",
    live: true,
  },
  {
    key: "dragonPanelImage",
    label: "恶龙角色背景",
    type: "image",
    default: "",
    group: "下方数值面板",
    live: true,
  },
];

export const battleSkinAssets = [
  battlePresentation.poster,
  battlePresentation.teams.hero.art,
  battlePresentation.teams.dragon.art,
];

/** Change image sources in place: skin changes never recreate the stat counters or media host. */
export function applyBattleSkin(
  root: HTMLElement,
  settings: Record<string, unknown>,
) {
  root.dataset.panelSkin = settings.panelSkin === "light" ? "light" : "dark";
  for (const [selector, key, fallback] of [
    [".poster", "arenaImage", battlePresentation.poster],
    [".hero .team-art", "heroPanelImage", battlePresentation.teams.hero.art],
    [
      ".dragon .team-art",
      "dragonPanelImage",
      battlePresentation.teams.dragon.art,
    ],
  ]) {
    const image = root.querySelector<HTMLImageElement>(selector!);
    const source =
      typeof settings[key!] === "string" && settings[key!]
        ? String(settings[key!])
        : fallback!;
    if (image && image.getAttribute("src") !== source) image.src = source;
  }
}
