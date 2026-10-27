# Game API v1

资源包只提供 HTML、CSS、JavaScript 与静态资产。游戏透过沙盒 preload 的 `window.zhudaGame` 读取状态，不能收集 Cookie、调用文件系统或连接网络。

```ts
import type { GameState } from '@zhuda/contracts';
function render(state: GameState) {
  // 数量是十进位字符串，显示／计算时使用 BigInt。
  console.log(state.round?.remaining, state.lastAction);
}
const stop = window.zhudaGame.subscribe(render);
window.zhudaGame.snapshot().then(render);
window.addEventListener('pagehide', stop, { once: true });
```

每个包的 manifest 包含 product ID（`game.xxx` 或 `prank.xxx`）、版本、`apiVersion: 1`、玩法规则、预设起始数字及完整资产哈希。v1 支持「礼物 × 数量 × 规则增减值」的精确整数计数器，以及不改计数的纯特效事件，计数降至零通关；可基于 action 制作视觉与音效。复杂战斗、多人同步、随机奖池等需要扩充宿主 API，不能宣称任意代码包都兼容。整蛊舞台只做窗口内效果，不干涉 OS 或其他应用程序。

目前创建方式：将 manifest 放到 `games/<name>/manifest.json`，由 `scripts/build.ts` 产生入口与共用 TypeScript、CSS（需要不同游戏程序时在此指派各自 entry）。修改内容必须递增版本，既有版本不可原地覆写。每个回合固定包版本；用户可调整该版本支持的礼物映射，仅套用后续礼物，历史动作与剩余数量不重算。手动下载更新需先结束该玩法回合。新版桌面附带的较新内置包会并存安装，供下一回合使用；旧回合重开时从原版本的签章 receipt 验证并加载，不能改用新版文件清单。正式发行时保存旧版本 ZIP，避免已安装客户端仍需要旧包。

签章描述包含 manifest、ZIP SHA-256 及 ZIP 长度，使用 Ed25519；下载 URL 必须与 ID／版本吻合。ZIP 最大 30 MiB、最多 500 档、展开总量 100 MiB、单档 10 MB；拒绝重复文件名、绝对路径、路径穿越及未列文件。完整验证后 staging 目录原子移动，加载前再次验证每档哈希。签章与 ZIP／资产哈希都必须相符。

游戏以 `zhuda-game://<product>/index.html` 加载，CSP 禁止网络、iframe、外部程序与 inline script。文件名仅支持英数、底线、连字号与子目录；支持 html/js/css/json/png/jpg/jpeg/webp/svg/woff2/mp3/wav。背景跟随 `state.background`：`green` 使用精确 `#00ff00`、`transparent` 使用透明、`dark` 使用深色。不要对绿幕本身加渐层或滤镜。顶部 28px 可用 `-webkit-app-region: drag`，Esc 关闭、F11 全屏幕由宿主处理。

状态订阅包含最近 30 个动作；重新开窗不可重播历史效果。参考游戏会忽略首次 snapshot 的效果，之后只显示新 action ID 且时间小于 6 秒的动作。遵循 `prefers-reduced-motion`。

解锁挑战 0.2.0 的钢链由 `scripts/chain-art.ts` 以圆管几何、交替垂直链环、深度排序及钢材光照产生 SVG。建置时加入签章资产清单，工作台预览共用同一份材质。链条以两环为一个周期无缝平铺，数量仍用 BigInt；不依剩余数创建 DOM。加锁：链环合拢、收紧、金属亮光与暖色火花；解锁：断口、两半链环、回弹及冷色火花；归零：四处断链后隐去。绿幕外围保持纯色，透明模式不另垫背景。

每批快照按新 action 顺序处理；密集交互按加锁／解锁合并，最多两个待播批量。数字立即更新，动画不阻塞计数。动画与粒子会回收，换回合／关窗清理，通关优先清空未播动画；减少动态模式只显示增减文字。`LIVE_SMOKE_ARTIFACTS=/绝对路径 npm run smoke` 可保存实际窗口的静态、双向特效、窄窗口与通关验收图，不会登录抖音。

现有礼物 ID／名称沿用旧项目规则，需以真实直播逐项核对平台现况；不能以本机试送代替核对。

## 礼物事件与客户端设置

新游戏包应在 manifest 的 `events` 数组提供可配置功能。每个功能包含稳定的 `id`、显示名称 `label`、`description`、计数操作 `operation`（`add`／`subtract`／`effect`）、`amountLabel`、`unit`、`min`、`max` 与 `default`。`effect` 不修改计数。旧版未提供 events 的计数游戏仍有兼容界面，不会替旧游戏加入其程序不支持的纯特效。

```json
{
  "events": [
    {
      "id": "unlock",
      "label": "解开锁链",
      "description": "断裂并熔化锁链",
      "operation": "subtract",
      "amountLabel": "解开根数",
      "unit": "根",
      "min": 1,
      "max": 1000000,
      "default": 10
    }
  ],
  "rules": [
    {
      "giftId": "2001",
      "giftName": "玫瑰",
      "eventId": "unlock",
      "amount": 10,
      "delta": -10
    }
  ]
}
```

`rules` 是预设映射。同一礼物只对应一个功能，多种礼物可指向同一功能，最多 500 种映射，允许全部删除。`amount` 为每份礼物的参数，`delta` 必须符合功能的增减方向；纯特效为 0。宿主会验证事件 ID、范围、方向与重复礼物。客户端保存用户映射，不修改签章 manifest；生效中的试玩与正式回合同时更新后续规则，已完成回合不改动。版本更新会尝试沿用兼容映射；不兼容则使用新包预设。

游戏接收的 `GameAction` 保留 `delta`／`before`／`after`，另外提供 `eventId`、`eventName`、`value`（每份参数 × 添加礼物数量）。游戏应依 `eventId` 运行对应功能，不把 `delta === '0'` 当作无事件；同样使用 action ID 去重，首次开窗不重播。现有解锁挑战 0.6.0 与整蛊舞台 0.3.0 已提供功能描述；整蛊的 `shake`、`reverse`、`glitch` 分别播放震动、翻转及信号干扰。

礼物来源为 [抖音官方礼物目录](https://live.douyin.com/webcast/gift/list/?aid=6383&device_platform=web&live_id=1)，以字符串 ID 映射。随桌面附上整理后快照，启动及每小时重新同步，脱机沿用最后成功数据。目录包含活动等礼物，但送礼资格及直播间限制由官方处理；客户端配置与试送不会真的送出礼物。

## 游戏主题

每个游戏包可在 `themes` 提供 1–30 款主题，字段为 `id`、`name`、`description`、`accent`。ID 须稳定、唯一，使用小写英数与连字号。`defaultTheme` 可指定其中一款，省略时使用第一款。旧包未声明时兼容为单一 `default` 主题，不会套用新包才支持的外观。

```json
{
  "themes": [
    { "id": "classic", "name": "原版钢链", "description": "原版细钢链", "accent": "#d8f68b" },
    {
      "id": "monochrome",
      "name": "黑白粗链",
      "description": "亮银与黑铁混合",
      "accent": "#c9d3df"
    },
    { "id": "plush", "name": "粉色玩偶", "description": "布偶、小熊与蝴蝶结", "accent": "#f7a3cc" }
  ],
  "defaultTheme": "classic"
}
```

宿主依 manifest 显示选项，透过验证包版本与签章后的 `selectTheme` 命令保存设置，游戏从 `state.round.theme` 读取选择。**游戏包必须实作所声明的每款主题**，素材亦须加入签章清单，不能仅增加名称。回合固定自己的主题清单；新包选项不会出现在旧包回合。设置按玩法与包版本保存，兼容新版沿用，不兼容则回退预设。切换不重开截取窗口、不添加 action、不重算数量或历史；目前正式／试玩中相同包版本的回合一并换装。

解锁挑战三款共用独立锁链身分与随机路径，粗链与玩偶使用较粗的材质；任何主题 4,200 根都逐根绘制 4,200 根。黑白款交错亮银／黑铁，粉色款使用柔光布偶链环、纤维缝线、小熊与蝴蝶结；断裂闪光、熔解、粒子与底部 HUD 随主题配色，均支持直横版、三种背景及减少动态模式。
