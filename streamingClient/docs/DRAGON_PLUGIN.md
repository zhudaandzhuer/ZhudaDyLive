# 猪大 VS 恶龙插件

`plugin.dragon` **2.2.1** 随工作台 **0.3.1** 内附，最低工作台版本为 0.3.0。当前为 **1080 × 1080 方形静态版**；旧竖版影片未随源码发行，横版战斗影片尚未制作。多人 SVG 世界是独立实验，见 [混战设计](ARENA_DESIGN.md)。

## 画面与换皮

上方为无文字的 16:9 横式对峙原画，下方为双方数值面板。备战倒计时位于两张卡片之间的上方，其余标题、说明、预测和页脚不进入游戏画面。礼物说明仍可独立成层。缩小来源会整体缩放。

`arenaImage` 更换上方原画；`panelSkin` 切换暗色／浅色面板；`heroPanelImage` 和 `dragonPanelImage` 分别更换下方角色背景。均为实时参数，运行、暂停和锁定时可调，不重建 iframe 或重置数值。清除自定义图片可恢复内附素材，来源见 [素材说明](ASSETS.md)。

尺寸、美术和角色信息集中在 `../plugins/dragon/presentation.ts`。当前 `filmsEnabled: false`，构建只读取 `assets/skins/` 的三张 PNG。影片序列和播放器代码保留供后续开发，不代表素材已存在或已验收。

## 当前实际规则

以下描述宿主现行算法；[战斗规则草案](DRAGON_COMBAT_DESIGN.md) 是另一套候选设计，尚未替换此算法。

每场默认 20 秒备战和 8 秒交锋阶段。礼物可增加双方生命、攻击、防御、速度，生命增益提高上限并恢复等量生命。交锋时采样属性，展示期间的新礼物用于下一次交锋，不能改变已经确定的结果。

恶龙先攻击。速度优势最多使攻击提高到两倍，防御直接减伤。猪大速度达到恶龙的 1.5 倍且高于恶龙时闪避；存活且防御挡住整次攻击，或速度至少与恶龙相等时获得回击。回击同样计算速度加成和对方防御。计算确定性执行，无隐藏随机概率。

采样后双方攻击、防御和速度的本轮加成默认保留 40%，基础值和生命上限不衰减。备战时长、保留比例及八项基础属性可配置，重新开始时采样。结果确定后不接受复活，主播可重新开始下一场。

正式礼物映射默认留空，由主播从当前直播间礼物目录绑定八个增益事件。每件增量独立配置，使用宿主去重后的连击新增份数，不写死礼物名称或猜测编号。属性增益以短暂上浮数字和跑分展示，首次加载不重放历史。

## 宿主与源码

`battle: { version: 1 }` 声明宿主固定算法，八项变量为 heroHealth、heroAttack、heroDefense、heroSpeed、dragonHealth、dragonAttack、dragonDefense、dragonSpeed。规则包含 prepSeconds、clashSeconds、retention 及可选参数引用。

宿主保存生命、阶段、逻辑截止点、胜方和交锋记录。预览与输出只读同一结果，不依赖 iframe 开关或帧数。暂停及重启期间逻辑时钟冻结，恢复不补算离线时间。礼物和暂停操作先结算到期交锋，避免回头改变旧结果。

| 位置                                    | 内容                                         |
| --------------------------------------- | -------------------------------------------- |
| `../plugins/dragon/`                    | 来源声明、静态皮肤、渲染器及未来影片适配代码 |
| `packages/contracts/src/duel.ts`        | 版本合约与只读预测                           |
| `client/src/main/scenes/duel.ts`        | 权威战斗计算                                 |
| `scripts/dragon-preview.ts`             | 使用 SceneManager 的本机模拟宿主             |
| `scripts/export-dragon.ts`              | 导出独立试玩、源码和零依赖服务器             |
| `tests/electron/scenes/dragon-smoke.ts` | Electron 专项验收                            |

```sh
npm run build
npx tsx scripts/export-dragon.ts ./review-output
node review-output/tools/serve.mjs --root=review-output --port=18896
```

独立试玩导出包含必要源码和素材，不依赖线上商店上架。输出目录应放在仓库外或 `.local/` 下，避免将生成产物再次提交。正常发行和更新仍使用标准签章插件流程。
