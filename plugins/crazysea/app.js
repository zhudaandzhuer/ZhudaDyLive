/**
 * 《疯狂海世界》直播弹幕互动游戏 — 3D 核心渲染引擎与插件驱动 (能落地的高品质版本)
 * 完美对齐参考图 1 视觉风格：45度 Isometric 俯角、深邃波光海水、底层粗原木排、
 * 中层成排彩色生锈汽油桶 (蓝色水水/军绿化学/锈红汽油)、木纹厚甲板、黑色橡胶轮胎护栏、
 * 特色轮胎堆叠阶梯、木制起重吊臂与木框打捞篮、二楼原木小屋与紫发看书女助手、
 * 主播可自由移动与搭建的光头壮汉大叔、受用户送礼冲击波击退/眩晕星星/黑炭、
 * 木筏升级逐件弹簧堆叠动画 (Staggered Spring-Drop Building Animation)、
 * 原生 Web Audio API 与 ZhudaDyLive 插件协议。
 */

import * as THREE from './lib/three.module.js';
import { SoundEngine } from './sound.js';
import { GiftFX } from './gift-fx.js';
import { LayoutManager } from './layout.js';
import { createPluginBridge, pluginStorage } from './plugin-bridge.js';

// ==========================================
// 2. 游戏状态与数值逻辑系统 (Game State)
// ==========================================
// 预留船首钓鱼区与右前设备区；座标均相对于 raftGroup。
// 游轮主甲板比木筏高，角色和设备必须一起移到其外侧露天甲板。
const RAFT_DECK_LAYOUT = {
  worker: { x: 0, y: 2.10, z: 5.8 },
  movement: { minX: -1, maxX: 1, minZ: 5.4, maxZ: 6.6 },
  filter: { x: 6.5, y: 1.91, z: 6.4 },
};
const IRON_DECK_LAYOUT = {
  worker: { x: 0, y: 2.10, z: 8.2 },
  movement: { minX: -1, maxX: 1, minZ: 7.9, maxZ: 8.6 },
  filter: { x: 6.5, y: 1.91, z: 8.2 },
};
const CRUISE_DECK_LAYOUT = {
  worker: { x: 0, y: 5.79, z: 8.2 },
  movement: { minX: -1, maxX: 1, minZ: 7.9, maxZ: 8.6 },
  filter: { x: 6.5, y: 5.6, z: 8.2 },
};
const DEFAULT_STAGE_THRESHOLDS = Object.freeze([0, 100, 1000, 5000, 10000, 100000]);
const STAGE_SETTING_KEYS = ['woodBoatWood', 'cabinWood', 'ironShipWood', 'villaWood', 'cruiseWood'];
const FISHING_INPUT_GRACE_MS = 80;

class CrazySeaEngine {
  constructor() {
    this.wood = 0;
    this.targetWood = 100000;
    this.stageThresholds = [...DEFAULT_STAGE_THRESHOLDS];
    this.stoneDamage = 5;
    this.smallBombDamage = 20;
    this.bigBombDamage = 100;
    this.filterWoodLv1 = 4;
    this.filterAutoUpgrade = true;
    this.inkDuration = 8;
    this.weedDuration = 5;
    this.autoTapSpeed = 0; // 遵循使用者指示：不能自动建筑，完全关闭自动敲钉
    this.soundVolume = 80;
    this.soundEnabled = true;
    this.theme = 'default';

    this.filterLevel = 1;
    this.filterExp = 0;
    this.isRageMode = false;
    this.hasWon = false;
    this.bombsReceivedCount = 0;
    this.woodBuiltCount = 0;

    this.inkActive = false;
    this.inkTimer = null;
    this.weedActive = false;
    this.weedStruggle = 0;
    this.weedMaxStruggle = 5;
    this.weedTimer = null;
    this.nukeAlarmActive = false;

    // 角色站在房屋前方的露天钓鱼区。
    this.workerState = 'idle'; // idle | fishing | dizzy | charred | struggling | cheering
    this.workerTimer = 0;
    this.workerPos = { x: this.deckLayout.worker.x, z: this.deckLayout.worker.z };
    this.workerTargetPos = { ...this.workerPos };
    this.workerAngle = 0;
    this.workerDizzyTimer = 0;

    this.demolitionRanks = new Map();
    this.assistRanks = new Map();
    this.officialDemolitionRanks = null;
    this.officialAssistRanks = null;
    this.isHostAuthorized = false;
    this.giftWoodBalance = 0;

    this.sound = new SoundEngine();
    this.lastAutoTap = performance.now() + 2500;
    this.processedActionIds = new Set();

    // 钓鱼 QTE 绿色命中区动态参数 (无黄色区，每次命中随机切换位置)
    this.baseHitZoneWidth = 24;
    this.minHitZoneWidth = 0.1;
    this.hitZoneWidth = this.baseHitZoneWidth;
    this.hitZoneStart = 38; // 默认起点 38%
    this.onHitZoneChanged = null;

    // 烟雾干扰 (减慢指针光标速度)
    this.smokeActive = false;
    this.smokeDuration = 6;
    this.smokeTimer = 0;

    // 海带遮挡钓鱼面板
    this.kelpPanelActive = false;
    this.kelpPanelDuration = 7;
    this.kelpPanelTimer = 0;

    // 3D 渲染器回调委托 (由 ThreeWorldRenderer 绑定)
    this.onBuildWoodEffect = null;
    this.onMissEffect = null;
    this.onDismantleEffect = null;
    this.onSpawnStoneEffect = null;
    this.onSpawnBombEffect = null;
    this.onNukeEffect = null;
    this.onStageUpgrade = null;
    this.onGiftEffect = null;
  }

  get floor() {
    return Math.floor(this.wood / 10) + 1;
  }

  // 各阶段使用独立的累计木头门槛，升级与炸毁降级共用同一份设置。
  get stage() {
    for (let stage = this.stageThresholds.length - 1; stage > 0; stage--) {
      if (this.wood >= this.stageThresholds[stage]) return stage;
    }
    return 0;
  }

  setStageThresholds(thresholds) {
    if (!Array.isArray(thresholds) || thresholds.length !== 6 || thresholds[0] !== 0 ||
        thresholds.slice(1).some((value, index) => !Number.isInteger(value) || value < 1 || value > 1000000 || value <= thresholds[index])) {
      return false;
    }
    this.stageThresholds = [...thresholds];
    return true;
  }

  setHitZoneConfig(baseWidth, minWidth) {
    if (![baseWidth, minWidth].every((value) => Number.isFinite(value) && value >= 0.1 && value <= 50) || minWidth > baseWidth) {
      return false;
    }
    this.baseHitZoneWidth = Math.round(baseWidth * 10) / 10;
    this.minHitZoneWidth = Math.round(minWidth * 10) / 10;
    this.hitZoneWidth = this.baseHitZoneWidth;
    this.randomizeHitZone();
    return true;
  }

  get deckLayout() {
    if (this.stage >= 5) return CRUISE_DECK_LAYOUT;
    if (this.stage === 3) return IRON_DECK_LAYOUT;
    return RAFT_DECK_LAYOUT;
  }

  resetWorkerPosition() {
    const { x, z } = this.deckLayout.worker;
    Object.assign(this.workerPos, { x, z });
    Object.assign(this.workerTargetPos, { x, z });
  }

  get stageName() {
    const names = [
      '木筏',
      '木船',
      '大木船',
      '铁皮船',
      '多层铁皮屋',
      '大游轮',
    ];
    return names[this.stage] || names[5];
  }

  // 命中区随机更换位置 (每次命中调用)
  randomizeHitZone() {
    const minX = 4;
    const maxX = 96 - this.hitZoneWidth;
    let newStart = Math.floor(Math.random() * (maxX - minX + 1)) + minX;
    if (Math.abs(newStart - this.hitZoneStart) < 12 && (maxX - minX) > 24) {
      newStart = ((newStart + 28 - minX) % (maxX - minX)) + minX;
    }
    this.hitZoneStart = newStart;
    if (this.onHitZoneChanged) {
      this.onHitZoneChanged({ start: this.hitZoneStart, width: this.hitZoneWidth });
    }
  }

  // 猪大经典钓鱼收线 QTE 判定：
  // 绿色是命中区，其他则是没命中，命中堆叠木头，没命中是减少
  // 不需要黄色区域，每次命中命中区换位置
  pullFishingRod(pointerPos = 50, contactRange = null) {
    if (this.weedActive) {
      this.struggleWeed();
      return { success: false, reason: 'weed', message: '🌿 被海草缠住了！连击 Space 挣脱！' };
    }
    if (this.nukeAlarmActive || this.workerState === 'charred') {
      return { success: false, reason: 'disabled', message: '⚠️ 当前状态无法收线' };
    }
    this.sound.playReel();

    // 绿色为唯一命中区；画面输入可以传入针身及刚刚一帧扫过的范围。
    const hitStart = this.hitZoneStart;
    const hitEnd = this.hitZoneStart + this.hitZoneWidth;
    const contactMin = contactRange?.min ?? pointerPos;
    const contactMax = contactRange?.max ?? pointerPos;
    const isHit = Number.isFinite(contactMin) && Number.isFinite(contactMax) &&
      contactMin <= contactMax && contactMax >= hitStart && contactMin <= hitEnd;

    if (isHit) {
      const baseGain = 1;
      const rate = this.isRageMode ? baseGain * 5 : baseGain;
      const oldStage = this.stage;
      this.wood += rate;
      this.woodBuiltCount += rate;

      // 角色拉竿收线动作
      this.workerState = 'fishing';
      this.workerTimer = 26;
      this.sound.playCatch();

      const isUpgrade = this.stage > oldStage;
      if (isUpgrade) this.sound.playUpgrade(this.stage);

      // 命中：在船上堆叠木头物件
      if (this.onBuildWoodEffect) {
        this.onBuildWoodEffect({ fromFilter: false, count: rate, upgraded: isUpgrade, isCrit: false });
      }
      if (isUpgrade && this.onStageUpgrade) {
        this.onStageUpgrade(this.stage, oldStage);
      }

      // 每次命中，命中区要换位置！
      this.randomizeHitZone();

      this.checkVictory();
      this.updateUI();

      return {
        success: true,
        gain: rate,
        message: rate > 1 ? `🔥 狂暴命中！成功钓获 ${rate} 块原木！` : '🎯 命中绿色区！成功钓获 1 块原木，已堆叠到船上！'
      };
    } else {
      // 没命中：木头减少！(-1 块木头，保底不低于 0，并从船上堆垛移除 1 根原木)
      const loss = 1;
      const actualLoss = Math.min(this.wood, loss);
      this.wood = Math.max(0, this.wood - loss);

      this.workerState = 'fishing';
      this.workerTimer = 16;
      this.sound.playMiss();

      // 触发脱钩掉木头与水花特效
      if (this.onMissEffect) {
        this.onMissEffect(actualLoss);
      }

      this.updateUI();

      return {
        success: false,
        gain: -loss,
        message: actualLoss > 0
          ? '❌ 脱钩未中！失去 1 块木头，原木掉入海中！'
          : '❌ 脱钩未中！差一点点，瞄准绿色区域再按一次！'
      };
    }
  }

  // 1. 丢炸弹炸掉木头
  applyBomb(senderName = '炸弹狂', count = 1) {
    this.applySmallBomb(senderName, count);
  }

  // 2. 丢烟雾减慢光标速度
  applySmoke(senderName = '烟雾客', durationSec = 6) {
    this.onGiftEffect?.('smoke', senderName, `光标减速 50% · ${durationSec} 秒`);
    this.smokeActive = true;
    this.smokeDuration = durationSec;
    this.smokeTimer = durationSec;
    const overlay = document.getElementById('smoke-overlay');
    if (overlay) overlay.classList.add('active');
    this.sound.playSmoke();
    this.triggerToast(`💨 ${senderName} 丢出烟雾弹！指针光标减速 50%（持续 ${durationSec} 秒）！`, false);
    this.updateUI();
  }

  // 3. 丢海带遮住面板
  applyKelp(senderName = '淘气观众', durationSec = 7) {
    this.onGiftEffect?.('kelp', senderName, `海带遮挡 · ${durationSec} 秒`);
    this.kelpPanelActive = true;
    this.kelpPanelDuration = durationSec;
    this.kelpPanelTimer = durationSec;
    const overlay = document.getElementById('panel-kelp-overlay');
    if (overlay) overlay.classList.add('active');
    this.sound.playWeedSlap();
    this.triggerToast(`🌿 ${senderName} 丢来大片海带糊住钓鱼面板！（持续 ${durationSec} 秒）！`, false);
    this.updateUI();
  }

  // 4. 丢河豚减少命中区范围 (支持数学合并 count)
  applyShrinkZone(senderName = '刺刺河豚', count = 1) {
    const c = (Number.isInteger(count) && count > 0) ? count : 1;
    this.hitZoneWidth = Math.max(this.minHitZoneWidth, Math.round((this.hitZoneWidth - 6 * c) * 10) / 10);
    this.randomizeHitZone();
    this.onGiftEffect?.('puffer', senderName, `命中区缩小至 ${this.hitZoneWidth}%`);
    this.sound.playShrink();
    this.triggerToast(`🐡 ${senderName} 丢出刺刺河豚！绿色命中区缩小至 ${this.hitZoneWidth}%！（难度提升！）`, false);
    this.updateUI();
  }

  // 5. 丢海星增加命中区范围 (支持数学合并 count)
  applyExpandZone(senderName = '幸运海星', count = 1) {
    const c = (Number.isInteger(count) && count > 0) ? count : 1;
    this.hitZoneWidth = Math.min(50, Math.round((this.hitZoneWidth + 8 * c) * 10) / 10);
    this.randomizeHitZone();
    this.onGiftEffect?.('star', senderName, `命中区扩大至 ${this.hitZoneWidth}%`);
    this.sound.playExpand();
    this.triggerToast(`⭐ ${senderName} 丢出幸运海星！绿色命中区扩大至 ${this.hitZoneWidth}%！（命中更容易！）`, true);
    this.updateUI();
  }

  // 钉锤助攻总量增加木头 (不受 weed/charred 阻挡，不执行巨大循环)
  applyTapNail(senderName = '助攻观众', total = 1) {
    const amount = (Number.isSafeInteger(total) && total > 0) ? total : 1;
    const oldStage = this.stage;
    this.wood += amount;
    this.woodBuiltCount += amount;
    this.recordRank(this.assistRanks, senderName, amount);

    this.workerState = 'fishing';
    this.workerTimer = 24;
    this.sound.playHammer();

    const isUpgrade = this.stage > oldStage;
    if (isUpgrade) this.sound.playUpgrade(this.stage);

    if (this.onBuildWoodEffect) {
      this.onBuildWoodEffect({ fromFilter: false, count: Math.min(18, amount), upgraded: isUpgrade, isCrit: false });
    }
    if (isUpgrade && this.onStageUpgrade) {
      this.onStageUpgrade(this.stage, oldStage);
    }

    this.onGiftEffect?.('hammer', senderName, `钉锤助攻 +${amount} 木头`);
    this.triggerToast(`🔨 感谢 ${senderName} 强力助攻！帮盖木头 +${amount}！`, true);
    this.checkVictory();
    this.updateUI();
  }

  // 安全取消待定动作 (核弹倒数/墨汁/海草/烟雾/海带)
  cancelPendingActions() {
    if (this.weedTimer) {
      clearTimeout(this.weedTimer);
      this.weedTimer = null;
    }
    if (this.nukeTimer) {
      clearTimeout(this.nukeTimer);
      this.nukeTimer = null;
    }
    if (this.nukeAlarmActive) {
      this.nukeAlarmActive = false;
      const alarmOverlay = document.getElementById('nuke-alarm-overlay');
      if (alarmOverlay) alarmOverlay.classList.remove('active');
    }
    if (this.inkTimer) {
      clearTimeout(this.inkTimer);
      this.inkTimer = null;
    }
    if (this.inkActive) {
      this.clearInk();
    }
    if (this.weedActive) {
      this.clearWeed();
    }
    this.smokeActive = false;
    this.smokeTimer = 0;
    this.kelpPanelActive = false;
    this.kelpPanelTimer = 0;
    const sOverlay = document.getElementById('smoke-overlay');
    if (sOverlay) sOverlay.classList.remove('active');
    const kOverlay = document.getElementById('panel-kelp-overlay');
    if (kOverlay) kOverlay.classList.remove('active');
    this.updateUI();
  }

  // 清除所有干扰 (海带、烟雾、海草、墨汁，并重置命中区)
  clearAllInterference() {
    this.onGiftEffect?.('clear', '海洋守护者', '所有干扰解除');
    this.clearInk();
    this.clearWeed();
    this.smokeActive = false;
    this.smokeTimer = 0;
    this.kelpPanelActive = false;
    this.kelpPanelTimer = 0;
    const sOverlay = document.getElementById('smoke-overlay');
    if (sOverlay) sOverlay.classList.remove('active');
    const kOverlay = document.getElementById('panel-kelp-overlay');
    if (kOverlay) kOverlay.classList.remove('active');
    this.hitZoneWidth = this.baseHitZoneWidth;
    this.randomizeHitZone();
    this.sound.playClear();
    this.triggerToast('✨ 所有干扰已清除！钓鱼面板与指针速度恢复正常！', true);
    this.updateUI();
  }

  // 主播敲钉／收线基础行为 (同时满足自动化测试断言)
  hammerNail(senderName = '主播本人') {
    if (this.weedActive) {
      this.struggleWeed();
      return;
    }
    if (this.nukeAlarmActive || this.workerState === 'charred') {
      return;
    }

    const rate = this.isRageMode ? 5 : 1;
    const oldStage = this.stage;
    this.wood += rate;
    this.woodBuiltCount += rate;
    
    this.workerState = 'fishing';
    this.workerTimer = 24;
    this.sound.playHammer();

    const isUpgrade = this.stage > oldStage;
    if (isUpgrade) this.sound.playUpgrade(this.stage);

    // 触发 3D 堆叠建造特效
    if (this.onBuildWoodEffect) {
      this.onBuildWoodEffect({ fromFilter: false, count: rate, upgraded: isUpgrade, isCrit: false });
    }
    if (isUpgrade && this.onStageUpgrade) {
      this.onStageUpgrade(this.stage, oldStage);
    }

    this.checkVictory();
    this.updateUI();
  }

  struggleWeed() {
    this.weedStruggle += 1;
    this.sound.playWeedSlap();
    const meter = document.getElementById('struggle-fill');
    if (meter) {
      meter.style.width = `${(this.weedStruggle / this.weedMaxStruggle) * 100}%`;
    }
    if (this.weedStruggle >= this.weedMaxStruggle) {
      this.clearWeed();
    }
  }

  applyStone(senderName = '观众', count = 1, totalOverride = null) {
    const totalDmg = (totalOverride !== null && totalOverride !== undefined) ? totalOverride : (this.stoneDamage * count);
    this.onGiftEffect?.('stone', senderName, `摧毁 ${totalDmg.toLocaleString()} 木头`, count);
    const oldStage = this.stage;
    this.wood = Math.max(0, this.wood - totalDmg);
    this.bombsReceivedCount += count;
    this.recordRank(this.demolitionRanks, senderName, totalDmg);

    this.sound.playStone();
    if (this.onSpawnStoneEffect) this.onSpawnStoneEffect(count);
    if (this.stage < oldStage && this.onDismantleEffect) {
      this.onDismantleEffect({ count: 6, severe: false });
    }

    this.triggerToast(`🪨 ${senderName} 投掷了石头！扣除 ${totalDmg} 块木头！`, false);
    this.triggerWorkerImpact(false);
    this.updateUI();
  }

  applySmallBomb(senderName = '观众', count = 1, totalOverride = null) {
    const totalDmg = (totalOverride !== null && totalOverride !== undefined) ? totalOverride : (this.smallBombDamage * count);
    this.onGiftEffect?.('small', senderName, `摧毁 ${totalDmg.toLocaleString()} 木头`, count);
    const oldStage = this.stage;
    this.wood = Math.max(0, this.wood - totalDmg);
    this.bombsReceivedCount += count;
    this.recordRank(this.demolitionRanks, senderName, totalDmg);

    this.sound.playSmallBomb();
    if (this.onSpawnBombEffect) this.onSpawnBombEffect('small', count);
    if (this.onDismantleEffect) {
      this.onDismantleEffect({ count: this.stage < oldStage ? 12 : 5, severe: false });
    }

    this.triggerToast(`🧨 ${senderName} 送出小炸弹！炸毁 ${totalDmg} 块木头！`, false);
    this.triggerWorkerImpact(false);
    this.updateUI();
  }

  applyBigBomb(senderName = '观众', count = 1, totalOverride = null) {
    const totalDmg = (totalOverride !== null && totalOverride !== undefined) ? totalOverride : (this.bigBombDamage * count);
    this.onGiftEffect?.('big', senderName, `摧毁 ${totalDmg.toLocaleString()} 木头`, count);
    const oldStage = this.stage;
    this.wood = Math.max(0, this.wood - totalDmg);
    this.bombsReceivedCount += count;
    this.recordRank(this.demolitionRanks, senderName, totalDmg);

    this.sound.playBigBomb();
    if (this.onSpawnBombEffect) this.onSpawnBombEffect('big', count);
    if (this.onDismantleEffect) {
      this.onDismantleEffect({ count: this.stage < oldStage ? 20 : 10, severe: true });
    }

    this.triggerToast(`💣 ${senderName} 送出深水大炸弹！暴扣 ${totalDmg} 块木头！`, false);
    this.triggerWorkerImpact(true);
    this.updateUI();
  }

  triggerWorkerImpact(severe = false) {
    if (this.workerState === 'struggling' || this.workerState === 'charred') return;
    this.workerState = 'dizzy';
    this.workerDizzyTimer = severe ? 60 : 35;
    this.workerTimer = this.workerDizzyTimer;
    // 受击只能在露天钓鱼区内退步，连续炸弹也不能把人推进房屋或设备。
    const bounds = this.deckLayout.movement;
    const distance = severe ? 3.0 : 1.5;
    this.workerTargetPos.x = Math.max(bounds.minX, Math.min(bounds.maxX, this.workerPos.x + (Math.random() - 0.5) * distance));
    this.workerTargetPos.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, this.workerPos.z + (Math.random() - 0.5) * distance));
  }

  applyNuke(senderName = '大哥') {
    if (this.nukeAlarmActive) return;
    this.onGiftEffect?.('nuke', senderName, '倒数 2 秒 · 全岛清零');
    this.bombsReceivedCount += 1;
    this.recordRank(this.demolitionRanks, senderName, 9999);
    this.nukeAlarmActive = true;

    const alarmOverlay = document.getElementById('nuke-alarm-overlay');
    if (alarmOverlay) alarmOverlay.classList.add('active');
    this.sound.playSiren();

    this.triggerToast(`☢️ 全体注意！${senderName} 启动终极核弹！全岛夷为平地！`, false);

    if (this.nukeTimer) clearTimeout(this.nukeTimer);
    this.nukeTimer = setTimeout(() => {
      this.nukeTimer = null;
      this.nukeAlarmActive = false;
      if (alarmOverlay) alarmOverlay.classList.remove('active');
      this.sound.playNukeExplosion();

      this.wood = 0;
      this.filterLevel = 1;
      this.filterExp = 0;
      this.workerDizzyTimer = 0;
      this.workerState = 'charred';
      this.workerTimer = 90;
      this.resetWorkerPosition();

      // 先更新清零状态，渲染回调才不会依旧木头数恢复被拆掉的设施。
      if (this.onNukeEffect) this.onNukeEffect();
      if (this.onDismantleEffect) {
        this.onDismantleEffect({ count: 45, severe: true, nuke: true });
      }

      this.triggerToast(`💥 核弹引爆！木头已彻底清零！木屋重置回落水破木筏！`, false);
      this.updateUI();
    }, 2000);
  }

  applyFilter(senderName = '大哥', count = 1, totalOverride = null) {
    const multipliers = [1, 3, 10, 30];
    const mult = multipliers[this.filterLevel - 1] || 1;
    const base = (totalOverride !== null && totalOverride !== undefined) ? totalOverride : (this.filterWoodLv1 * count);
    let addWood = base * mult;
    if (this.isRageMode) addWood *= 2;
    this.onGiftEffect?.('filter', senderName, `暴风帮盖 +${addWood.toLocaleString()} 木头`, count);

    const oldStage = this.stage;
    this.wood += addWood;
    this.woodBuiltCount += addWood;
    this.recordRank(this.assistRanks, senderName, addWood);

    if (this.filterAutoUpgrade && this.filterLevel < 4) {
      this.filterExp += count;
      if (this.filterExp >= this.filterLevel * 2) {
        this.filterLevel++;
        this.filterExp = 0;
        this.triggerToast(`🚀 海水过滤器升级至 Lv.${this.filterLevel}！帮盖木头暴增！`, true);
      }
    }

    this.sound.playWood();
    const isUpgrade = this.stage > oldStage;
    if (isUpgrade) this.sound.playUpgrade(this.stage);

    if (this.onBuildWoodEffect) {
      this.onBuildWoodEffect({ fromFilter: true, count: Math.min(18, count * 3), upgraded: isUpgrade });
    }
    if (isUpgrade && this.onStageUpgrade) {
      this.onStageUpgrade(this.stage, oldStage);
    }

    this.triggerToast(`🚰 感谢 ${senderName} 送出海水过滤器！暴风帮盖 +${addWood} 块木头！`, true);
    this.checkVictory();
    this.updateUI();
  }

  applyInk(senderName = '观众') {
    this.onGiftEffect?.('ink', senderName, `墨汁突袭 · ${this.inkDuration} 秒`);
    this.sound.playInkSquirt();
    this.inkActive = true;
    const inkCanvas = document.getElementById('ink-canvas');
    const inkAlert = document.getElementById('ink-alert');
    if (inkCanvas) inkCanvas.classList.add('active');
    if (inkAlert) inkAlert.classList.add('active');

    this.drawInkObstruction();
    this.triggerToast(`🦑 乌贼袭击！${senderName} 喷射黑紫色墨汁遮挡了画面！`, false);

    clearTimeout(this.inkTimer);
    this.inkTimer = setTimeout(() => this.clearInk(), this.inkDuration * 1000);
    this.updateUI();
  }

  clearInk() {
    this.inkActive = false;
    const inkCanvas = document.getElementById('ink-canvas');
    const inkAlert = document.getElementById('ink-alert');
    if (inkCanvas) inkCanvas.classList.remove('active');
    if (inkAlert) inkAlert.classList.remove('active');
    this.updateUI();
  }

  applyWeed(senderName = '观众') {
    this.onGiftEffect?.('weed', senderName, '连点挣脱海草');
    this.sound.playWeedSlap();
    this.weedActive = true;
    this.weedStruggle = 0;
    this.workerState = 'struggling';

    const weedAlert = document.getElementById('seaweed-alert');
    const meter = document.getElementById('struggle-fill');
    if (weedAlert) weedAlert.classList.add('active');
    if (meter) meter.style.width = '0%';

    this.triggerToast(`🌿 糟糕！${senderName} 丢出大把海草缠住主播双腿无法行动！`, false);

    clearTimeout(this.weedTimer);
    this.weedTimer = setTimeout(() => this.clearWeed(), this.weedDuration * 1000);
    this.updateUI();
  }

  clearWeed() {
    this.weedActive = false;
    this.weedStruggle = 0;
    if (this.workerState === 'struggling') {
      this.workerState = 'idle';
    }
    const weedAlert = document.getElementById('seaweed-alert');
    if (weedAlert) weedAlert.classList.remove('active');
    this.updateUI();
  }

  drawInkObstruction() {
    const canvas = document.getElementById('ink-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // Glossy, irregular ink splats stay in the play area so rankings remain readable.
    for (let i = 0; i < 5; i++) {
      const cx = 180 + Math.random() * 720;
      const cy = 1090 + Math.random() * 370;
      const r = 130 + Math.random() * 100;
      const grad = ctx.createRadialGradient(cx - r * .3, cy - r * .4, 0, cx, cy, r * 1.3);
      grad.addColorStop(0, '#4f2b78'); grad.addColorStop(.4, '#25133f'); grad.addColorStop(1, '#100d23');
      ctx.fillStyle = grad; ctx.shadowColor = '#130c2d99'; ctx.shadowBlur = 22;
      ctx.beginPath();
      for (let j = 0; j <= 24; j++) {
        const a = j * Math.PI / 12, radius = r * (.88 + Math.sin(j * 2.1 + i) * .15);
        const x = cx + Math.cos(a) * radius, y = cy + Math.sin(a) * radius * .8;
        if (!j) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = '#a87be744'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#c19aff30'; ctx.beginPath();
      ctx.ellipse(cx - r * .28, cy - r * .33, r * .32, r * .08, -.4, 0, Math.PI * 2); ctx.fill();
      for (let j = 0; j < 7; j++) {
        const a = Math.random() * Math.PI * 2, dist = r * (1 + Math.random() * .65);
        ctx.fillStyle = '#25133fe8'; ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist * .85, 8 + Math.random() * 17, 10 + Math.random() * 28, a, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  checkVictory() {
    if (this.wood >= this.targetWood && !this.hasWon) {
      this.hasWon = true;
      this.workerState = 'cheering';
      this.sound.playVictory();

      const modal = document.getElementById('victory-modal');
      const vWood = document.getElementById('victory-wood');
      const vFloor = document.getElementById('victory-floor');
      const vBombs = document.getElementById('victory-bombs');

      if (vWood) vWood.textContent = this.wood.toLocaleString();
    if (vFloor) vFloor.textContent = this.stageName;
      if (vBombs) vBombs.textContent = `${this.bombsReceivedCount} 次`;
      if (modal) modal.classList.add('active');

      this.triggerToast('🎉 恭喜主播完成今日木头目标，成功下班！', true);
    }
  }

  recordRank(map, sender, amount) {
    if (!sender) return;
    const current = map.get(sender) || 0;
    map.set(sender, current + amount);
  }

  triggerToast(msg, isSuccess = true) {
    const banner = document.getElementById('announcement-banner');
    const textEl = document.getElementById('announcement-text');
    const iconEl = document.getElementById('announcement-icon');
    if (!banner || !textEl) return;

    textEl.textContent = msg;
    if (iconEl) iconEl.textContent = isSuccess ? '🌟' : '💥';
    banner.classList.add('show');

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      banner.classList.remove('show');
    }, 2800);
  }

  updateUI() {
    const currentWoodEl = document.getElementById('current-wood');
    const targetWoodEl = document.getElementById('target-wood-text');
    const stepperFillEl = document.getElementById('stepper-fill');
    const victoryOffDutyPill = document.getElementById('victory-off-duty-pill');

    if (currentWoodEl) currentWoodEl.textContent = this.wood.toLocaleString();
    if (targetWoodEl) targetWoodEl.textContent = this.targetWood.toLocaleString();

    const w = this.wood;
    const thresholds = this.stageThresholds;
    const stage = this.stage;
    const stageFraction = stage < 5
      ? Math.min(1, Math.max(0, (w - thresholds[stage]) / (thresholds[stage + 1] - thresholds[stage])))
      : 0;
    const stepperPct = stage >= 5 ? 100 : (stage + stageFraction) * 20;
    if (stepperFillEl) stepperFillEl.style.width = `${stepperPct}%`;

    // 节点门槛与解锁状态同步采用可调设置。
    const curStage = this.stage;
    for (let lv = 0; lv <= 5; lv++) {
      const nodeEl = document.getElementById(`node-stage-${lv}`);
      if (nodeEl) {
        nodeEl.dataset.threshold = String(thresholds[lv]);
        const requirement = nodeEl.querySelector('.node-req');
        if (requirement) requirement.textContent = thresholds[lv].toLocaleString();
        const isUnlocked = w >= thresholds[lv];
        const isActive = curStage === lv;
        if (isUnlocked) {
          nodeEl.classList.add('unlocked');
        } else {
          nodeEl.classList.remove('unlocked');
        }
        if (isActive) {
          nodeEl.classList.add('active');
        } else {
          nodeEl.classList.remove('active');
        }
      }
    }

    // 显示是否已达本场设置的下班目标。
    if (victoryOffDutyPill) {
      if (w >= this.targetWood) {
        victoryOffDutyPill.classList.remove('hidden');
      } else {
        victoryOffDutyPill.classList.add('hidden');
      }
    }

    this.renderRankLists();
  }

  renderRankLists() {
    const renderOfficial = (elId, list, isDemolition) => {
      const el = document.getElementById(elId);
      if (!el) return;
      if (!Array.isArray(list) || list.length === 0) {
        el.innerHTML = `<div class="rank-item empty"><span>等待${isDemolition ? '拆家挑战者' : '护航守护者'}...</span></div>`;
        return;
      }
      el.innerHTML = list.slice(0, 3).map((item, idx) => `
        <div class="rank-item rank-${idx + 1}">
          <div class="rank-badge">${idx + 1}</div>
          <span class="rank-name">${escapeHtml(item.name)}</span>
          <span class="rank-val">${isDemolition ? '-' : '+'}${item.wood.toLocaleString()}</span>
        </div>
      `).join('');
    };

    const renderList = (elId, rankMap, isDemolition) => {
      const el = document.getElementById(elId);
      if (!el) return;
      const sorted = Array.from(rankMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      if (sorted.length === 0) {
        el.innerHTML = `<div class="rank-item empty"><span>等待${isDemolition ? '拆家挑战者' : '护航守护者'}...</span></div>`;
        return;
      }

      el.innerHTML = sorted
        .map(([name, val], idx) => {
          return `
            <div class="rank-item rank-${idx + 1}">
              <div class="rank-badge">${idx + 1}</div>
              <span class="rank-name">${escapeHtml(name)}</span>
              <span class="rank-val">${isDemolition ? '-' : '+'}${val.toLocaleString()}</span>
            </div>
          `;
        })
        .join('');
    };

    if (this.isHostAuthorized && this.officialDemolitionRanks && this.officialAssistRanks) {
      renderOfficial('demolition-rank-list', this.officialDemolitionRanks, true);
      renderOfficial('assist-rank-list', this.officialAssistRanks, false);
    } else {
      renderList('demolition-rank-list', this.demolitionRanks, true);
      renderList('assist-rank-list', this.assistRanks, false);
    }
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

// ==========================================
// 3. 3D WebGL / Three.js 渲染引擎与特效系统 (对齐图 1 高品质末日海洋风)
// ==========================================
class ThreeWorldRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;

    // 核心场景与 45度 Isometric 俯角相机 (立体层次丰富，完全还原木筏正面侧面与纵深)
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, canvas.width / canvas.height, 0.1, 2000);
    // 保留模型与透视比例，将整个场景下移 240px，让手机上方留给大字榜单。
    this.camera.setViewOffset(canvas.width, canvas.height, 0, -240, canvas.width, canvas.height);
    this.baseCamPos = new THREE.Vector3(34, 52, 42);
    const initialCamera = this.getTargetCameraConfig();
    this.currentCamPos = initialCamera.pos.clone();
    this.currentLookAt = initialCamera.lookAt.clone();
    this.camera.position.copy(this.currentCamPos);
    this.camera.lookAt(this.currentLookAt);

    // 规则木筏搭建插槽清单 (吊起的物品有规则地搭建到木筏上，而非单纯堆在角落)
    this.constructionSlots = [];

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 宣告给测试案例的标记
    this.canvas.setAttribute('data-engine', 'three.js r186');

    this.initProceduralTextures();
    this.initLights();
    this.initOcean();
    this.initRaftBase();
    this.initWoodStackZone();
    this.initWorkerCharacter();
    this.initFishingLineAndBobber();
    this.initBuildingStages();
    // 保存完整部件的设计位置与比例；动画不改动部件内部的螺丝、支柱或角色骨架。
    this.stageLayouts = this.stages.map((stage) => stage.children.map((mesh) => ({
      mesh,
      position: mesh.position.clone(),
      scale: mesh.scale.clone(),
    })));
    for (const slot of this.constructionSlots) {
      slot.stage = 0;
      for (let node = slot.mesh; node; node = node.parent) {
        const stage = this.stages.indexOf(node);
        if (stage >= 0) {
          slot.stage = stage;
          break;
        }
      }
    }
    this.lastBuildingStage = this.engine.stage;
    this.initSeawaterFilter();
    this.initConstructionTargets();
    this.initFxPools();
    this.giftFx = new GiftFX(this);
    this.bindEngineCallbacks();

    // 初始化规则搭建结构显隐状态
    this.updateConstructionState();

    // 扩建逐件动画队列 (Staggered Animation Queue)
    this.expansionQueue = [];

    this.screenShake = 0;
    this.time = 0;
    this.updateDeckLayout();
    this.setTheme(this.engine.theme);
  }

  // 注册规则木筏搭建插槽 (每钓起一根木头即有专属结构件飞入实体化搭建)
  registerConstructionSlot(mesh, name = '木筏结构件') {
    if (!mesh) return null;
    const slotIndex = this.constructionSlots.length;
    const slot = {
      index: slotIndex,
      minWood: slotIndex + 1,
      name,
      mesh,
      origScale: mesh.scale.clone(),
    };
    this.constructionSlots.push(slot);
    return slot;
  }

  // 根据当前木头数即时更新规则木筏结构件的显隐与弹跳
  updateConstructionState(animatedSlotIndex = -1) {
    const curWood = this.engine ? this.engine.wood : 0;
    for (let i = 0; i < this.constructionSlots.length; i++) {
      const slot = this.constructionSlots[i];
      // 低门槛也必须盖出完整船型；基础木筏在第一次升级前仍逐件搭建。
      const shouldBeVisible = slot.stage > 0
        ? this.engine.stage >= slot.stage
        : this.engine.stage > 0 || curWood >= slot.minWood;
      if (shouldBeVisible) {
        if (!slot.mesh.visible) {
          slot.mesh.visible = true;
          if (i === animatedSlotIndex) {
            slot.mesh.scale.set(
              slot.origScale.x * 1.25,
              slot.origScale.y * 0.72,
              slot.origScale.z * 1.25
            );
          }
        }
      } else {
        if (slot.mesh.visible) {
          slot.mesh.visible = false;
        }
      }
    }
  }

  // 镜头动态后拉目标计算 (随木筏扩展与 6 阶段升级，沿经典 45度 Isometric 方向平滑后拉抬升视野)
  getTargetCameraConfig() {
    const curStage = this.engine ? this.engine.stage : 0;
    const stageProgress = Math.min(1.0, curStage / 5);
    // 下方构图须同时容纳最初的大木筏与最宽的游轮船头。
    const framingMargin = [0.40, 0.36, 0.33, 0.33, 0.29, 0.25][curStage] ?? 0;
    const factor = 1.0 + stageProgress * 0.45 + framingMargin;
    const posX = 34 * factor;
    const posY = 52 * factor;
    const posZ = 42 * factor;
    const lookY = 6.0 + stageProgress * 4.0;
    const lookZ = -2.0 - stageProgress * 1.5;

    return {
      pos: new THREE.Vector3(posX, posY, posZ),
      lookAt: new THREE.Vector3(0, lookY, lookZ),
    };
  }

  // 0. 生成顶级次世代程序化 PBR 纹理 (树皮、真实年轮切面、甲板、粗麻绳、水下焦散与浪花泡沫)
  initProceduralTextures() {
    // (1) 原木树皮纹理 (Bark Texture)
    const barkCanvas = document.createElement('canvas');
    barkCanvas.width = 512;
    barkCanvas.height = 512;
    const bCtx = barkCanvas.getContext('2d');
    bCtx.fillStyle = '#442813';
    bCtx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 600; i++) {
      const bx = Math.random() * 512;
      const by = Math.random() * 512;
      const bw = 1.5 + Math.random() * 5;
      const bh = 30 + Math.random() * 100;
      bCtx.fillStyle = Math.random() > 0.45 ? 'rgba(24, 12, 6, 0.4)' : 'rgba(102, 64, 34, 0.35)';
      bCtx.fillRect(bx, by, bw, bh);
    }
    this.texLogBark = new THREE.CanvasTexture(barkCanvas);
    this.texLogBark.wrapS = THREE.RepeatWrapping;
    this.texLogBark.wrapT = THREE.RepeatWrapping;
    this.texLogBark.repeat.set(1, 3);

    // (2) 原木年轮横截面纹理 (End-Grain Tree Rings) — 100% 还原参考图 5 根原木切面细节
    const ringCanvas = document.createElement('canvas');
    ringCanvas.width = 512;
    ringCanvas.height = 512;
    const rCtx = ringCanvas.getContext('2d');
    const rcx = 256;
    const rcy = 256;
    // 金棕木质底色
    rCtx.fillStyle = '#c79258';
    rCtx.beginPath();
    rCtx.arc(rcx, rcy, 248, 0, Math.PI * 2);
    rCtx.fill();
    // 24 圈微扰同心年轮
    rCtx.lineWidth = 2.4;
    for (let r = 10; r < 235; r += 6.5 + Math.sin(r * 0.15) * 2.2) {
      const alpha = 0.22 + (r / 235) * 0.45;
      rCtx.strokeStyle = `rgba(82, 45, 18, ${alpha})`;
      rCtx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.08) {
        const wobble = Math.sin(a * 5 + r) * 2.2 + Math.cos(a * 8) * 1.4;
        const px = rcx + Math.cos(a) * (r + wobble);
        const py = rcy + Math.sin(a) * (r + wobble);
        if (a === 0) rCtx.moveTo(px, py);
        else rCtx.lineTo(px, py);
      }
      rCtx.stroke();
    }
    // 中心髓心
    const pithGrad = rCtx.createRadialGradient(rcx, rcy, 2, rcx, rcy, 16);
    pithGrad.addColorStop(0, '#4e240a');
    pithGrad.addColorStop(1, 'rgba(199, 146, 88, 0)');
    rCtx.fillStyle = pithGrad;
    rCtx.beginPath();
    rCtx.arc(rcx, rcy, 16, 0, Math.PI * 2);
    rCtx.fill();
    // 放射状天然干裂裂缝 (Radial Cracks)
    const cracks = [0.35, 1.6, 2.9, 4.3, 5.4];
    cracks.forEach((ang0) => {
      let ang = ang0;
      rCtx.strokeStyle = '#271105';
      rCtx.lineWidth = 3.6;
      rCtx.beginPath();
      rCtx.moveTo(rcx, rcy);
      let cx = rcx;
      let cy = rcy;
      for (let d = 12; d < 185; d += 14) {
        ang += (Math.random() - 0.5) * 0.18;
        cx = rcx + Math.cos(ang) * d;
        cy = rcy + Math.sin(ang) * d;
        rCtx.lineTo(cx, cy);
      }
      rCtx.stroke();
    });
    // 外圈深黑棕树皮包裹厚边
    rCtx.lineWidth = 16;
    rCtx.strokeStyle = '#2d1607';
    rCtx.beginPath();
    rCtx.arc(rcx, rcy, 246, 0, Math.PI * 2);
    rCtx.stroke();
    this.texLogEndRings = new THREE.CanvasTexture(ringCanvas);

    // (3) 实木甲板木板纹理 (Weathered Deck Plank: 温暖风化天然橡木色)
    const plankCanvas = document.createElement('canvas');
    plankCanvas.width = 512;
    plankCanvas.height = 512;
    const pCtx = plankCanvas.getContext('2d');
    pCtx.fillStyle = '#b6895b';
    pCtx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 450; i++) {
      const py = Math.random() * 512;
      const ph = 1 + Math.random() * 2.5;
      const pAlpha = 0.08 + Math.random() * 0.18;
      pCtx.fillStyle = Math.random() > 0.5 ? `rgba(92, 58, 28, ${pAlpha})` : `rgba(235, 195, 150, ${pAlpha})`;
      pCtx.fillRect(0, py, 512, ph);
    }
    pCtx.fillStyle = 'rgba(45, 25, 12, 0.4)';
    pCtx.fillRect(0, 0, 512, 3);
    pCtx.fillRect(0, 509, 512, 3);
    this.texDeckPlank = new THREE.CanvasTexture(plankCanvas);
    this.texDeckPlank.wrapS = THREE.RepeatWrapping;
    this.texDeckPlank.wrapT = THREE.RepeatWrapping;
    this.texDeckPlank.repeat.set(1, 1);

    // (4) 粗麻绳纹理 (Rough Hemp Rope)
    const ropeCanvas = document.createElement('canvas');
    ropeCanvas.width = 256;
    ropeCanvas.height = 256;
    const roCtx = ropeCanvas.getContext('2d');
    roCtx.fillStyle = '#c8a674';
    roCtx.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 12) {
      roCtx.fillStyle = 'rgba(92, 65, 32, 0.35)';
      roCtx.fillRect(x, 0, 4, 256);
      roCtx.fillStyle = 'rgba(245, 225, 185, 0.3)';
      roCtx.fillRect(x + 4, 0, 3, 256);
    }
    this.texRope = new THREE.CanvasTexture(ropeCanvas);
    this.texRope.wrapS = THREE.RepeatWrapping;
    this.texRope.wrapT = THREE.RepeatWrapping;
    this.texRope.repeat.set(4, 1);

    // (5) 水下波光焦散纹理 (Underwater Sun Caustics) — 蜂巢晶格无缝太阳焦散
    const causticCanvas = document.createElement('canvas');
    causticCanvas.width = 256;
    causticCanvas.height = 256;
    const cCtx = causticCanvas.getContext('2d');
    const cImg = cCtx.createImageData(256, 256);
    const cData = cImg.data;

    // 建立 8x8 环形无缝 Voronoi 焦散种子点
    const gridSize = 8;
    const cellSize = 256 / gridSize;
    const points = [];
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const seed = (gx * 31 + gy * 79) % 1000 / 1000;
        const seed2 = (gx * 53 + gy * 17) % 1000 / 1000;
        points.push({
          x: (gx + 0.2 + seed * 0.6) * cellSize,
          y: (gy + 0.2 + seed2 * 0.6) * cellSize,
        });
      }
    }

    for (let py = 0; py < 256; py++) {
      for (let px = 0; px < 256; px++) {
        let d1 = 9999;
        let d2 = 9999;
        const gX = Math.floor(px / cellSize);
        const gY = Math.floor(py / cellSize);

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ngx = (gX + dx + gridSize) % gridSize;
            const ngy = (gY + dy + gridSize) % gridSize;
            const pt = points[ngy * gridSize + ngx];
            let ox = pt.x;
            let oy = pt.y;
            if (dx === -1 && gX === 0) ox -= 256;
            if (dx === 1 && gX === gridSize - 1) ox += 256;
            if (dy === -1 && gY === 0) oy -= 256;
            if (dy === 1 && gY === gridSize - 1) oy += 256;

            const dist = Math.hypot(px - ox, py - oy);
            if (dist < d1) {
              d2 = d1;
              d1 = dist;
            } else if (dist < d2) {
              d2 = dist;
            }
          }
        }

        const borderDist = d2 - d1;
        let intensity = Math.max(0, 1.0 - borderDist * 0.22);
        intensity = Math.pow(intensity, 3.2);

        const idx = (py * 256 + px) * 4;
        cData[idx] = Math.min(255, Math.floor(120 * intensity + 20));     // R
        cData[idx + 1] = Math.min(255, Math.floor(240 * intensity + 40)); // G
        cData[idx + 2] = Math.min(255, Math.floor(255 * intensity + 50)); // B
        cData[idx + 3] = Math.min(255, Math.floor(245 * intensity));      // A (边缘透明无缝)
      }
    }
    cCtx.putImageData(cImg, 0, 0);
    this.texCaustics = new THREE.CanvasTexture(causticCanvas);
    this.texCaustics.wrapS = THREE.RepeatWrapping;
    this.texCaustics.wrapT = THREE.RepeatWrapping;
    this.texCaustics.repeat.set(4, 4);

    // (6) 木筏边缘接触白色浪花泡沫 (Contact Foam Lace)
    const foamCanvas = document.createElement('canvas');
    foamCanvas.width = 512;
    foamCanvas.height = 512;
    const fCtx = foamCanvas.getContext('2d');
    fCtx.clearRect(0, 0, 512, 512);
    // 生成环绕木筏的有机气泡碎浪
    for (let i = 0; i < 4500; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 165 + Math.random() * 65 + Math.sin(ang * 7) * 12;
      const fx = 256 + Math.cos(ang) * dist;
      const fy = 256 + Math.sin(ang) * dist * 0.76;
      const r = 1.0 + Math.random() * 3.8;
      const alpha = (0.25 + Math.random() * 0.65) * Math.max(0, 1.0 - (dist - 170) / 60);
      fCtx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      fCtx.beginPath();
      fCtx.arc(fx, fy, r, 0, Math.PI * 2);
      fCtx.fill();
    }
    this.texContactFoam = new THREE.CanvasTexture(foamCanvas);

    // (7) 水面多频无缝微波法线贴图 (Multi-Octave Seamless Water Normal Map)
    const normCanvas = document.createElement('canvas');
    normCanvas.width = 256;
    normCanvas.height = 256;
    const nCtx = normCanvas.getContext('2d');
    const nImg = nCtx.createImageData(256, 256);
    const nData = nImg.data;
    const PI2 = Math.PI * 2;
    for (let py = 0; py < 256; py++) {
      const v = (py / 256) * PI2;
      for (let px = 0; px < 256; px++) {
        const u = (px / 256) * PI2;
        // 3 组不同整数频率周期保证 100% 无缝平铺
        const nx = Math.sin(u * 3 + v * 2) * 0.35 + Math.sin(u * 6 - v * 4) * 0.22 + Math.cos(u * 12 + v * 8) * 0.12;
        const ny = Math.cos(v * 3 + u * 2) * 0.35 + Math.cos(v * 6 + u * 4) * 0.22 + Math.sin(v * 12 - u * 8) * 0.12;
        const idx = (py * 256 + px) * 4;
        nData[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
        nData[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
        nData[idx + 2] = 255;
        nData[idx + 3] = 255;
      }
    }
    nCtx.putImageData(nImg, 0, 0);
    this.texWaterNormal = new THREE.CanvasTexture(normCanvas);
    this.texWaterNormal.wrapS = THREE.RepeatWrapping;
    this.texWaterNormal.wrapT = THREE.RepeatWrapping;
    this.texWaterNormal.repeat.set(8, 8);

    // (8) 珊瑚红瓦坡屋顶纹理 (Coral-Red Roof Tile Shingles)
    const roofCanvas = document.createElement('canvas');
    roofCanvas.width = 256;
    roofCanvas.height = 256;
    const rTileCtx = roofCanvas.getContext('2d');
    rTileCtx.fillStyle = '#c84832';
    rTileCtx.fillRect(0, 0, 256, 256);
    // 瓦片行与阴影线
    for (let y = 0; y < 256; y += 32) {
      rTileCtx.fillStyle = 'rgba(74, 20, 10, 0.45)';
      rTileCtx.fillRect(0, y, 256, 4);
      rTileCtx.fillStyle = 'rgba(255, 140, 110, 0.25)';
      rTileCtx.fillRect(0, y + 4, 256, 2);
      // 错位纵向板缝
      const offsetX = (y % 64 === 0) ? 0 : 24;
      for (let x = offsetX; x < 256; x += 48) {
        rTileCtx.fillStyle = 'rgba(50, 12, 6, 0.35)';
        rTileCtx.fillRect(x, y, 2, 32);
      }
    }
    this.texRoofTiles = new THREE.CanvasTexture(roofCanvas);
    this.texRoofTiles.wrapS = THREE.RepeatWrapping;
    this.texRoofTiles.wrapT = THREE.RepeatWrapping;
    this.texRoofTiles.repeat.set(2, 2);

    // (9) 奶油白木板外墙纹理 (Cream-White Clapboard Siding)
    const sidingCanvas = document.createElement('canvas');
    sidingCanvas.width = 256;
    sidingCanvas.height = 256;
    const sCtx = sidingCanvas.getContext('2d');
    sCtx.fillStyle = '#fff9ee';
    sCtx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 24) {
      sCtx.fillStyle = 'rgba(195, 178, 155, 0.35)';
      sCtx.fillRect(0, y, 256, 3);
      sCtx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      sCtx.fillRect(0, y + 3, 256, 1.5);
    }
    this.texWhiteSiding = new THREE.CanvasTexture(sidingCanvas);
    this.texWhiteSiding.wrapS = THREE.RepeatWrapping;
    this.texWhiteSiding.wrapT = THREE.RepeatWrapping;
    this.texWhiteSiding.repeat.set(1, 1);

    // (10) 暖色雪松木板纹理 (Warm Cedar Clapboard Siding)
    const cedarCanvas = document.createElement('canvas');
    cedarCanvas.width = 256;
    cedarCanvas.height = 256;
    const cdCtx = cedarCanvas.getContext('2d');
    cdCtx.fillStyle = '#a6683c';
    cdCtx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 20) {
      cdCtx.fillStyle = 'rgba(75, 40, 18, 0.4)';
      cdCtx.fillRect(0, y, 256, 3);
      cdCtx.fillStyle = 'rgba(225, 170, 120, 0.25)';
      cdCtx.fillRect(0, y + 3, 256, 1.5);
    }
    this.texCedarSiding = new THREE.CanvasTexture(cedarCanvas);
    this.texCedarSiding.wrapS = THREE.RepeatWrapping;
    this.texCedarSiding.wrapT = THREE.RepeatWrapping;
    this.texCedarSiding.repeat.set(1, 1);

    // (11) 度假风蓝白条纹帆布遮阳篷纹理 (Resort Striped Fabric Awning)
    const awningCanvas = document.createElement('canvas');
    awningCanvas.width = 128;
    awningCanvas.height = 128;
    const aCtx = awningCanvas.getContext('2d');
    aCtx.fillStyle = '#ffffff';
    aCtx.fillRect(0, 0, 128, 128);
    aCtx.fillStyle = '#0284c7';
    aCtx.fillRect(0, 0, 32, 128);
    aCtx.fillRect(64, 0, 32, 128);
    this.texAwningStripe = new THREE.CanvasTexture(awningCanvas);
    this.texAwningStripe.wrapS = THREE.RepeatWrapping;
    this.texAwningStripe.wrapT = THREE.RepeatWrapping;
    this.texAwningStripe.repeat.set(2, 1);
  }

  // 1. 光照系统 (晴空暖日高光、微缩模型柔和软阴影与清澈海洋天光)
  initLights() {
    this.ambientLight = new THREE.AmbientLight(0xfff6ea, 0.95);
    this.scene.add(this.ambientLight);

    // 主太阳光 (温暖日光 3800K, 自左上方直射，投下微缩模型立体软阴影)
    this.sunLight = new THREE.DirectionalLight(0xfff5e6, 1.55);
    this.sunLight.position.set(38, 75, 45);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 250;
    this.sunLight.shadow.camera.left = -40;
    this.sunLight.shadow.camera.right = 40;
    this.sunLight.shadow.camera.top = 40;
    this.sunLight.shadow.camera.bottom = -40;
    this.sunLight.shadow.bias = -0.0004;
    this.scene.add(this.sunLight);

    // 天空浅天蓝与海面青绿半球反弹天光
    this.bounceLight = new THREE.HemisphereLight(0xbae6fd, 0x0284c7, 0.85);
    this.scene.add(this.bounceLight);

    // 爆炸/火光点光源
    this.flashLight = new THREE.PointLight(0xff5500, 0, 100);
    this.flashLight.position.set(0, 20, 0);
    this.scene.add(this.flashLight);

    // 远景大气天海一色
    this.scene.fog = new THREE.FogExp2(0x38bdf8, 0.0016);
    this.scene.background = new THREE.Color(0x38bdf8);
  }

  // 2. 3D 次世代写实海洋水体 (物理波浪位移、动态浪尖白沫顶点色、水面微波法线与水底焦散)
  initOcean() {
    const geom = new THREE.PlaneGeometry(600, 600, 64, 64);
    geom.rotateX(-Math.PI / 2);

    // 建立顶点颜色缓冲区 (波峰白色浪沫、波谷群青深海、中层蒂芙尼青碧)
    const vCount = geom.attributes.position.count;
    const colors = new Float32Array(vCount * 3);
    for (let i = 0; i < vCount; i++) {
      colors[i * 3] = 0.04;     // R
      colors[i * 3 + 1] = 0.72; // G
      colors[i * 3 + 2] = 0.84; // B
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.oceanMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.06,
      metalness: 0.12,
      normalMap: this.texWaterNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      transparent: true,
      opacity: 0.94,
      flatShading: false,
    });

    this.oceanMesh = new THREE.Mesh(geom, this.oceanMaterial);
    this.oceanMesh.position.y = 0;
    this.oceanMesh.receiveShadow = true;
    this.scene.add(this.oceanMesh);

    // 供测试验证的顶点备份
    this.oceanVertices = geom.attributes.position.array.slice();

    // 水下金色焦散海底网格 (Underwater Sun Caustics — 广阔无缝太阳焦散)
    const causticsGeom = new THREE.PlaneGeometry(360, 360);
    causticsGeom.rotateX(-Math.PI / 2);
    this.causticsPlane = new THREE.Mesh(
      causticsGeom,
      new THREE.MeshBasicMaterial({
        map: this.texCaustics,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.causticsPlane.position.y = -3.8;
    this.scene.add(this.causticsPlane);

    // 深海透亮蔚蓝海底底层
    const seabedGeom = new THREE.PlaneGeometry(600, 600);
    seabedGeom.rotateX(-Math.PI / 2);
    this.seabed = new THREE.Mesh(
      seabedGeom,
      new THREE.MeshStandardMaterial({ color: 0x065d78, roughness: 0.85 })
    );
    this.seabed.position.y = -7.5;
    this.scene.add(this.seabed);

    // 木筏四周贴身接触自然羽化水沫边缘 (有机浪花取代生硬几何圆环)
    const contactFoamGeom = new THREE.PlaneGeometry(42, 42);
    contactFoamGeom.rotateX(-Math.PI / 2);
    this.contactFoamMesh = new THREE.Mesh(
      contactFoamGeom,
      new THREE.MeshBasicMaterial({
        map: this.texContactFoam,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      })
    );
    this.contactFoamMesh.position.y = 0.15;
    this.scene.add(this.contactFoamMesh);

    // 彻底移除卡通雷达圆环，保留阵列结构相容性
    this.initFoamRings();

    // 漂浮在海面上的物资木箱
    this.initDriftingCrates();
  }

  initFoamRings() {
    this.foamRings = []; // 彻底移除假圆环，海面呈现极致真实海流
  }

  initDriftingCrates() {
    this.driftingCrates = [];
  }

  // 复合 Gerstner 大洋波浪叠加算法 (涌浪、风浪、微波起伏)
  getWaveHeight(x, z, t) {
    const w1 = Math.sin(x * 0.042 + z * 0.024 + t * 1.5) * 0.62; // 主涌浪
    const w2 = Math.cos(x * 0.072 - z * 0.048 + t * 1.8) * 0.42; // 风向次浪
    const w3 = Math.sin((x - z) * 0.11 + t * 2.3) * 0.26;        // 交错浪峰
    const w4 = Math.cos((x + z) * 0.19 + t * 3.1) * 0.15;        // 微风涟漪
    return w1 + w2 + w3 + w4;
  }

  // 3. 3D 浮体木筏与基座模型 (支持规则循序渐进实体搭建：初始求生小平台 -> 浮木扩展 -> 甲板铺设 -> 护栏与生活设施)
  initRaftBase() {
    this.raftGroup = new THREE.Group();
    this.raftBaseRotationY = -0.62; // 3/4 等轴视角倾角，圆木端面正对左前方
    this.raftGroup.rotation.y = this.raftBaseRotationY;
    this.scene.add(this.raftGroup);

    // 高级 PBR 材质库
    this.matLogBark = new THREE.MeshStandardMaterial({
      map: this.texLogBark,
      roughness: 0.85,
      metalness: 0.02,
    }); // 天然原木树皮
    this.matLogCap = new THREE.MeshStandardMaterial({
      map: this.texLogEndRings,
      roughness: 0.78,
      metalness: 0.02,
    }); // 原木横切面高精年轮
    this.matRope = new THREE.MeshStandardMaterial({
      map: this.texRope,
      roughness: 0.92,
      metalness: 0.0,
    }); // 粗糙耐磨粗麻绳
    this.matPlankDeck = new THREE.MeshStandardMaterial({
      map: this.texDeckPlank,
      roughness: 0.72,
      metalness: 0.02,
    }); // 温暖自然风化厚实木板
    this.matPlankDark = new THREE.MeshStandardMaterial({
      color: 0x6e4a28,
      roughness: 0.8,
      metalness: 0.02,
    }); // 深色压条
    this.matPlankWet = new THREE.MeshStandardMaterial({
      color: 0x482d16,
      roughness: 0.48,
      metalness: 0.06,
    }); // 浸水木板
    this.matRustyMetal = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      metalness: 0.85,
      roughness: 0.3,
    }); // 沉头紧固金属柳钉

    // (A) 底层原木浮体排 (中央 3 根为核心基座，左右 2 根随木头获得搭建)
    this.bottomLogsGroup = new THREE.Group();
    this.raftGroup.add(this.bottomLogsGroup);

    const logRadius = 2.45;
    const logLength = 26.0;
    const logSpacing = 4.8;
    const logCount = 5;

    const logGeom = new THREE.CylinderGeometry(logRadius, logRadius, logLength, 24);
    logGeom.rotateX(Math.PI / 2);

    this.logMeshes = [];
    for (let i = 0; i < logCount; i++) {
      const xPos = (i - 2) * logSpacing; // -9.6, -4.8, 0, 4.8, 9.6
      const singleLogGroup = new THREE.Group();
      singleLogGroup.position.set(xPos, -1.2, 0);

      const log = new THREE.Mesh(logGeom, this.matLogBark);
      log.castShadow = true;
      log.receiveShadow = true;
      singleLogGroup.add(log);

      // 原木前端横截面年轮
      const capGeom = new THREE.CircleGeometry(logRadius * 0.98, 20);
      const capFront = new THREE.Mesh(capGeom, this.matLogCap);
      capFront.position.set(0, 0, logLength / 2 + 0.02);
      singleLogGroup.add(capFront);

      // 原木后端年轮
      const capBack = new THREE.Mesh(capGeom, this.matLogCap);
      capBack.position.set(0, 0, -logLength / 2 - 0.02);
      capBack.rotation.y = Math.PI;
      singleLogGroup.add(capBack);

      this.bottomLogsGroup.add(singleLogGroup);
      this.logMeshes.push(singleLogGroup);
    }

    // (B) 顶层平整厚实木甲板 (Weathered Hardwood Plank Deck)
    this.deckGroup = new THREE.Group();
    this.raftGroup.add(this.deckGroup);

    const deckPlankCount = 11;
    const deckWidth = 20.0;
    const plankDepth = 1.9;

    this.deckPlanks = [];
    for (let p = 0; p < deckPlankCount; p++) {
      const pz = -10.0 + p * 2.0;
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(deckWidth, 0.72, plankDepth),
        this.matPlankDeck
      );
      plank.position.set(0, 1.55, pz);
      plank.castShadow = true;
      plank.receiveShadow = true;
      this.deckGroup.add(plank);
      this.deckPlanks.push(plank);
    }

    // 甲板前后固定边框压条木条与防脱落柳钉
    const trimGeom = new THREE.BoxGeometry(deckWidth + 0.4, 0.55, 0.95);
    this.trimFrontGroup = new THREE.Group();
    const trimFront = new THREE.Mesh(trimGeom, this.matPlankDark);
    trimFront.position.set(0, 2.0, 10.6);
    trimFront.castShadow = true;
    this.trimFrontGroup.add(trimFront);

    for (let rx = -9.2; rx <= 9.2; rx += 1.85) {
      const pinF = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.65, 8), this.matRustyMetal);
      pinF.position.set(rx, 2.1, 10.6);
      this.trimFrontGroup.add(pinF);
    }
    this.deckGroup.add(this.trimFrontGroup);

    this.trimBackGroup = new THREE.Group();
    const trimBack = new THREE.Mesh(trimGeom, this.matPlankDark);
    trimBack.position.set(0, 2.0, -10.6);
    trimBack.castShadow = true;
    this.trimBackGroup.add(trimBack);

    for (let rx = -9.2; rx <= 9.2; rx += 1.85) {
      const pinB = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.65, 8), this.matRustyMetal);
      pinB.position.set(rx, 2.1, -10.6);
      this.trimBackGroup.add(pinB);
    }
    this.deckGroup.add(this.trimBackGroup);

    // (C) 标志性粗麻绳捆扎 (Hemp Rope Bindings)
    this.ropesGroup = new THREE.Group();
    this.raftGroup.add(this.ropesGroup);

    this.leftRopesGroup = new THREE.Group();
    this.rightRopesGroup = new THREE.Group();
    this.ropesGroup.add(this.leftRopesGroup, this.rightRopesGroup);

    [-9.6, 9.6].forEach((rx) => {
      const targetGroup = rx < 0 ? this.leftRopesGroup : this.rightRopesGroup;
      for (let r = 0; r < 4; r++) {
        const ropeRing = new THREE.Mesh(
          new THREE.TorusGeometry(logRadius + 0.12, 0.28, 8, 24),
          this.matRope
        );
        ropeRing.position.set(rx, -1.2, 9.2 + r * 0.7);
        ropeRing.castShadow = true;
        targetGroup.add(ropeRing);
      }
      for (let r = 0; r < 4; r++) {
        const ropeRing = new THREE.Mesh(
          new THREE.TorusGeometry(logRadius + 0.12, 0.28, 8, 24),
          this.matRope
        );
        ropeRing.position.set(rx, -1.2, -9.2 - r * 0.7);
        ropeRing.castShadow = true;
        targetGroup.add(ropeRing);
      }
      const diagonalRope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, 21.0, 8),
        this.matRope
      );
      diagonalRope.rotation.x = Math.PI / 2;
      diagonalRope.position.set(rx > 0 ? rx - 0.2 : rx + 0.2, 1.85, 0);
      diagonalRope.castShadow = true;
      targetGroup.add(diagonalRope);
    });

    // (D) 求生防浪角桩、工作台、储水桶、营灯
    this.survivalPropsGroup = new THREE.Group();
    this.raftGroup.add(this.survivalPropsGroup);

    this.cornerPosts = [];
    [
      { x: -9.2, z: 9.5, name: '左前角防浪木桩' },
      { x: 9.2, z: 9.5, name: '右前角防浪木桩' },
      { x: -9.2, z: -9.5, name: '左后角防浪木桩' },
      { x: 9.2, z: -9.5, name: '右后角防浪木桩' },
    ].forEach((p) => {
      const postMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.35, 3.2, 8), this.matLogBark);
      postMesh.position.set(p.x, 3.2, p.z);
      postMesh.castShadow = true;
      this.survivalPropsGroup.add(postMesh);
      this.cornerPosts.push({ mesh: postMesh, name: p.name });
    });

    // 求生木工工作台
    this.workbenchGroup = new THREE.Group();
    this.workbenchGroup.position.set(-6.5, 2.0, -1.5);
    const benchLegGeom = new THREE.BoxGeometry(0.4, 1.8, 0.4);
    [-1.2, 1.2].forEach((bx) => {
      [-0.6, 0.6].forEach((bz) => {
        const bleg = new THREE.Mesh(benchLegGeom, this.matPlankDark);
        bleg.position.set(bx, 0.9, bz);
        this.workbenchGroup.add(bleg);
      });
    });
    const benchTop = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.35, 1.8), this.matPlankDeck);
    benchTop.position.set(0, 1.95, 0);
    this.workbenchGroup.add(benchTop);
    this.survivalPropsGroup.add(this.workbenchGroup);

    // 海水淡化储水木桶
    this.waterBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 1.9, 12), this.matPlankDark);
    this.waterBarrel.position.set(-6.5, 2.9, 2.2);
    this.waterBarrel.castShadow = true;
    this.survivalPropsGroup.add(this.waterBarrel);

    // 营地防风吊灯木柱与营灯
    this.lanternPostGroup = new THREE.Group();
    this.lanternPostGroup.position.set(6.8, 2.0, 3.5);
    const lPole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 5.2, 8), this.matLogBark);
    lPole.position.y = 2.6;
    const lArm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.5, 8), this.matLogBark);
    lArm.rotation.z = Math.PI / 2;
    lArm.position.set(-0.6, 5.0, 0);
    const lanternMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.5), new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.2, emissive: 0xf59e0b, emissiveIntensity: 0.8 }));
    lanternMesh.position.set(-1.2, 4.4, 0);
    this.lanternPostGroup.add(lPole, lArm, lanternMesh);
    this.survivalPropsGroup.add(this.lanternPostGroup);

    // 保留主甲板引用供外部相容
    this.deckMesh = this.deckGroup;

    // 将木筏上的结构设施按规则注册进 this.constructionSlots (Slot 1 ~ 7)
    // 基础木筏基座（5 根粗大圆木 + 11 块厚实木甲板 + 粗麻绳捆扎）常驻完整显示！
    // 钓起获得的每一根木头，依序有规则实体搭建木筏上层设施！
    this.registerConstructionSlot(this.cornerPosts[0].mesh, '左前防浪加固木桩 (Slot 1)');
    this.registerConstructionSlot(this.cornerPosts[1].mesh, '右前防浪加固木桩 (Slot 2)');
    this.registerConstructionSlot(this.cornerPosts[2].mesh, '左后防浪加固木桩 (Slot 3)');
    this.registerConstructionSlot(this.cornerPosts[3].mesh, '右后防浪加固木桩 (Slot 4)');
    this.registerConstructionSlot(this.workbenchGroup, '求生木工制作台 (Slot 5)');
    this.registerConstructionSlot(this.waterBarrel, '海水淡化集水木桶 (Slot 6)');
    this.registerConstructionSlot(this.lanternPostGroup, '防风高挂营灯柱 (Slot 7)');
  }

  // 3.5 船上木材堆垛系统 (Wood Stacking System) — 备用储木区
  initWoodStackZone() {
    this.woodStackGroup = new THREE.Group();
    // 摆放在木筏右侧甲板 (x: 5.6, y: 1.85, z: -2.0)
    this.woodStackGroup.position.set(5.6, 1.85, -2.0);
    this.woodStackGroup.visible = false; // 依规则直接搭建于木筏结构，不预留突兀枕木架
    this.raftGroup.add(this.woodStackGroup);

    // 底部木料固定枕木架
    [-1.8, 1.8].forEach((offsetZ) => {
      const runner = new THREE.Mesh(
        new THREE.BoxGeometry(4.8, 0.45, 0.55),
        this.matPlankDark
      );
      runner.position.set(0, 0.22, offsetZ);
      runner.castShadow = true;
      runner.receiveShadow = true;
      this.woodStackGroup.add(runner);
    });

    // 堆叠原木几何体与材质 (直径 0.72m，长度 4.4m，天然树皮与年轮切面)
    const logRad = 0.36;
    const logLen = 4.4;
    this.stackedLogGeom = new THREE.CylinderGeometry(logRad, logRad, logLen, 16);
    this.stackedLogGeom.rotateX(Math.PI / 2); // 默认沿 Z 轴摆放

    // 堆叠的原木阵列
    this.stackedLogs = [];
    this.maxVisibleStackedLogs = 48; // 最大视觉堆垛数量
  }

  // 往船上木材堆垛码放一根木头
  addLogToStack(isCrit = false) {
    const index = this.stackedLogs.length;
    if (index >= this.maxVisibleStackedLogs) return null;

    const layer = Math.floor(index / 3);
    const slotInLayer = index % 3;
    const isEvenLayer = layer % 2 === 0;

    const logMesh = new THREE.Mesh(this.stackedLogGeom, isCrit ? this.matPlankDeck : this.matLogBark);
    logMesh.castShadow = true;
    logMesh.receiveShadow = true;

    // 前后年轮端面
    const capFront = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12), this.matLogCap);
    capFront.position.set(0, 0, 2.21);
    const capBack = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12), this.matLogCap);
    capBack.position.set(0, 0, -2.21);
    capBack.rotation.y = Math.PI;
    logMesh.add(capFront, capBack);

    const slotOffset = (slotInLayer - 1) * 1.15;
    const targetY = 0.58 + layer * 0.68;

    let targetX = 0;
    let targetZ = 0;
    let rotY = 0;

    if (isEvenLayer) {
      targetX = slotOffset;
      targetZ = 0;
      rotY = 0;
    } else {
      targetX = 0;
      targetZ = slotOffset;
      rotY = Math.PI / 2;
    }

    logMesh.position.set(targetX, targetY, targetZ);
    logMesh.rotation.y = rotY;

    this.woodStackGroup.add(logMesh);
    this.stackedLogs.push(logMesh);

    return { mesh: logMesh, targetX, targetY, targetZ, rotY };
  }

  removeLogsFromStack(count = 1) {
    const removeCount = Math.min(count, this.stackedLogs.length);
    for (let i = 0; i < removeCount; i++) {
      const log = this.stackedLogs.pop();
      if (log) {
        this.woodStackGroup.remove(log);
        this.spawnDismantleDebris(2, false, false);
      }
    }
  }

  clearWoodStack() {
    while (this.stackedLogs.length > 0) {
      const log = this.stackedLogs.pop();
      this.woodStackGroup.remove(log);
    }
  }

  // 4. 3D 主角英勇冒险家 (站在露天甲板，双手正手紧握海钓竿面向大海)
  initWorkerCharacter() {
    this.workerGroup = new THREE.Group();
    const { x, y, z } = this.engine.deckLayout.worker;
    this.workerGroup.position.set(x, y, z);
    this.workerGroup.rotation.y = 0; // 正对世界海面浮标 (0, 0.2, 13.5) 与大海方向
    this.workerGroup.scale.setScalar(1.22); // 英雄比例
    this.raftGroup.add(this.workerGroup);

    // 高级写实求生冒险角色 PBR 材质库
    this.matSkin = new THREE.MeshStandardMaterial({
      color: 0xc88e60, // 自然阳光健康小麦肤色
      roughness: 0.58,
      metalness: 0.04,
    });
    this.matHair = new THREE.MeshStandardMaterial({
      color: 0x3d2716, // 深栗棕寸头发色
      roughness: 0.88,
      metalness: 0.02,
    });
    this.matBeard = new THREE.MeshStandardMaterial({
      color: 0x382212, // 型男短胡须
      roughness: 0.92,
      metalness: 0.02,
    });
    this.matTShirt = new THREE.MeshStandardMaterial({
      color: 0x8a877c, // 浅灰卡其圆领短袖 T 恤
      roughness: 0.76,
      metalness: 0.02,
    });
    this.matVest = new THREE.MeshStandardMaterial({
      color: 0x585d46, // 军绿战术工装背心
      roughness: 0.82,
      metalness: 0.04,
    });
    this.matShorts = new THREE.MeshStandardMaterial({
      color: 0x5a5f48, // 军绿工装短裤
      roughness: 0.82,
      metalness: 0.04,
    });
    this.matBelt = new THREE.MeshStandardMaterial({
      color: 0x222225, // 黑色战术皮带
      roughness: 0.65,
      metalness: 0.2,
    });
    this.matBuckle = new THREE.MeshStandardMaterial({
      color: 0xd4d4d8, // 金属合金皮带扣
      metalness: 0.88,
      roughness: 0.2,
    });
    this.matGloves = new THREE.MeshStandardMaterial({
      color: 0x423225, // 深棕战术半截手套
      roughness: 0.72,
      metalness: 0.05,
    });
    this.matBoots = new THREE.MeshStandardMaterial({
      color: 0x5c422d, // 泥棕色战术登山靴皮革
      roughness: 0.68,
      metalness: 0.05,
    });
    this.matSole = new THREE.MeshStandardMaterial({
      color: 0x18181b, // 黑色厚实橡胶防滑大底
      roughness: 0.95,
      metalness: 0.05,
    });
    this.matSteel = new THREE.MeshStandardMaterial({
      color: 0xa1a1aa, // 精钢羊角锤金属
      metalness: 0.88,
      roughness: 0.22,
    });
    this.matCharred = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.95 }); // 核弹黑炭材质

    // (A) 健硕型男躯干 (Torso: 圆领T恤 + 战术多口袋工装背心)
    this.workerTorso = new THREE.Group();
    this.workerTorso.position.y = 3.6; // 骨盆腰部基准高度
    this.workerGroup.add(this.workerTorso);

    // 1. 内搭 T 恤与胸膛健美身躯
    const bodyGeom = new THREE.BoxGeometry(1.65, 2.2, 1.15);
    const bodyMesh = new THREE.Mesh(bodyGeom, this.matTShirt);
    bodyMesh.position.y = 1.1;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    this.workerTorso.add(bodyMesh);

    // 2. 军绿多口袋战术工装背心 (Tactical Vest)
    const vestGeom = new THREE.BoxGeometry(1.76, 2.25, 1.25);
    const vestMesh = new THREE.Mesh(vestGeom, this.matVest);
    vestMesh.position.y = 1.1;
    vestMesh.castShadow = true;
    this.workerTorso.add(vestMesh);

    // 背心胸前深色拉链线条
    const zipper = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.8, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x27272a, metalness: 0.8 })
    );
    zipper.position.set(0, 0.95, 0.64);
    this.workerTorso.add(zipper);

    // 背心胸口左右两个立体方形翻盖小口袋
    [-0.46, 0.46].forEach((px) => {
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.46, 0.14), this.matVest);
      pocket.position.set(px, 1.5, 0.66);
      pocket.castShadow = true;
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.16), this.matVest);
      flap.position.set(px, 1.76, 0.67);
      this.workerTorso.add(pocket, flap);
    });

    // 背心腰腹左右两个加大立体工装大口袋
    [-0.48, 0.48].forEach((px) => {
      const pocketBig = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.58, 0.16), this.matVest);
      pocketBig.position.set(px, 0.72, 0.66);
      pocketBig.castShadow = true;
      const flapBig = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.18), this.matVest);
      flapBig.position.set(px, 1.04, 0.67);
      this.workerTorso.add(pocketBig, flapBig);
    });

    // 3. 战术腰带与金属带扣
    const beltMesh = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.28, 1.26), this.matBelt);
    beltMesh.position.y = -0.05;
    const buckleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.1), this.matBuckle);
    buckleMesh.position.set(0, -0.05, 0.65);
    this.workerTorso.add(beltMesh, buckleMesh);

    // 4. 工装短裤腰臀主体
    const shortsBase = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.7, 1.2), this.matShorts);
    shortsBase.position.y = -0.4;
    shortsBase.castShadow = true;
    this.workerTorso.add(shortsBase);

    // (B) 帅气型男面孔与头部 (Head, Crew Cut, Neat Beard)
    // 结实脖颈
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.55, 12), this.matSkin);
    neck.position.y = 2.4;
    neck.castShadow = true;
    this.workerTorso.add(neck);

    // 头部群组
    this.workerHead = new THREE.Group();
    this.workerHead.position.set(0, 3.1, 0);
    this.workerTorso.add(this.workerHead);

    // 雕塑感型男面部 (刚毅下颚轮廓)
    const faceMesh = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.05, 0.98), this.matSkin);
    faceMesh.castShadow = true;
    this.workerHead.add(faceMesh);

    // 俐落短平头寸头 (Crew cut / buzz cut)
    const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.3, 1.02), this.matHair);
    hairTop.position.set(0, 0.52, 0);
    const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.25), this.matHair);
    hairBack.position.set(0, 0.15, -0.42);
    this.workerHead.add(hairTop, hairBack);

    // 精修短胡须 (Neat Stubble Beard: 下颚与上唇)
    const beardJaw = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.42, 0.35), this.matBeard);
    beardJaw.position.set(0, -0.38, 0.36);
    const beardStache = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.12, 0.12), this.matBeard);
    beardStache.position.set(0, -0.12, 0.52);
    this.workerHead.add(beardJaw, beardStache);

    // 立体刚毅鼻梁
    const noseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, 0.18), this.matSkin);
    noseMesh.position.set(0, 0.05, 0.54);
    this.workerHead.add(noseMesh);

    // 浓密剑眉
    [-0.22, 0.22].forEach((bx) => {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.08), this.matHair);
      brow.position.set(bx, 0.22, 0.51);
      this.workerHead.add(brow);
    });

    // 深邃大眼睛 (眼白 + 黑眼球)
    [-0.22, 0.22].forEach((ex) => {
      const eyeWhite = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.06), new THREE.MeshBasicMaterial({ color: 0xf8fafc }));
      eyeWhite.position.set(ex, 0.12, 0.5);
      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.07), new THREE.MeshBasicMaterial({ color: 0x1e1b18 }));
      pupil.position.set(0, 0, 0.01);
      eyeWhite.add(pupil);
      this.workerHead.add(eyeWhite);
    });

    // 双耳
    [-0.49, 0.49].forEach((ex) => {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.18), this.matSkin);
      ear.position.set(ex, 0.05, 0);
      this.workerHead.add(ear);
    });

    // (C) 双腿稳健扎马步 (Legs, Cargo Shorts, Hiking Boots)
    // 左腿微前屈
    this.legL = new THREE.Group();
    this.legL.position.set(-0.52, -0.65, 0.1);
    this.legL.rotation.set(-0.06, 0.08, -0.04);
    this.workerTorso.add(this.legL);

    // 右腿在后支撑
    this.legR = new THREE.Group();
    this.legR.position.set(0.52, -0.65, -0.1);
    this.legR.rotation.set(0.06, -0.06, 0.04);
    this.workerTorso.add(this.legR);

    [this.legL, this.legR].forEach((leg, idx) => {
      const isL = idx === 0;

      // 工装短裤裤腿 (长度及膝上方)
      const pantsLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.4, 1.15, 12), this.matShorts);
      pantsLeg.position.y = -0.55;
      pantsLeg.castShadow = true;
      leg.add(pantsLeg);

      // 短裤外侧立体翻盖工装大口袋
      const legPocket = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.42), this.matShorts);
      legPocket.position.set(isL ? -0.42 : 0.42, -0.55, 0);
      legPocket.castShadow = true;
      leg.add(legPocket);

      // 健硕小腿 (自然小麦肤色)
      const calf = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 1.25, 12), this.matSkin);
      calf.position.y = -1.65;
      calf.castShadow = true;
      leg.add(calf);

      // 高筒战术登山靴靴筒
      const bootAnkle = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.35, 0.85, 12), this.matBoots);
      bootAnkle.position.y = -2.45;
      bootAnkle.castShadow = true;
      leg.add(bootAnkle);

      // 登山靴鞋身
      const bootFoot = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.58, 1.35), this.matBoots);
      bootFoot.position.set(0, -2.75, 0.2);
      bootFoot.castShadow = true;
      leg.add(bootFoot);

      // 登山靴厚实黑色橡胶防滑大底
      const bootSole = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 1.42), this.matSole);
      bootSole.position.set(0, -2.95, 0.2);
      bootSole.receiveShadow = true;
      leg.add(bootSole);
    });

    // (D) 双臂与海钓竿 (双手正手握竿 Forehand Two-Handed Fishing Grip)
    // 左臂 (肩部旋转节点：左手前伸托握前把)
    this.armL = new THREE.Group();
    this.armL.position.set(-1.05, 1.95, 0);
    this.workerTorso.add(this.armL);

    // 右臂 (肩部旋转节点：右手包握下把与卷线器)
    this.armR = new THREE.Group();
    this.armR.position.set(1.05, 1.95, 0);
    this.workerTorso.add(this.armR);

    // 建立双臂肌肉与短袖袖口
    [this.armL, this.armR].forEach((arm, idx) => {
      const isL = idx === 0;

      // 短袖袖口立体边缘
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.36, 0.55, 12), this.matTShirt);
      sleeve.position.y = -0.25;
      arm.add(sleeve);

      // 上臂二头肌与前臂
      const armMuscle = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 1.45, 12), this.matSkin);
      armMuscle.position.y = -1.05;
      armMuscle.castShadow = true;
      arm.add(armMuscle);

      // 深棕半截战术手套
      const glove = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.26, 0.65, 12), this.matGloves);
      glove.position.y = -1.85;
      glove.castShadow = true;
      arm.add(glove);

      // 露出的手指 (握拳握竿造型)
      const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.32, 0.35), this.matSkin);
      fingers.position.y = -2.25;
      arm.add(fingers);
    });

    // 双臂初始正手持竿角度 (双手向前屈握持长海钓竿：右手握下把与卷线器、左手托前把)
    this.armR.rotation.set(-0.78, 0.15, -0.42);
    this.armL.rotation.set(-0.85, -0.15, 0.42);

    // 专业长海钓竿挂在躯干腰腹正前方 (贯穿双手，正手向前上方约40度昂首伸向大海)
    this.fishingRodGroup = new THREE.Group();
    this.fishingRodGroup.position.set(0.02, 0.65, 1.58); // 双手正手握持处
    this.fishingRodGroup.rotation.set(0.873, 0, 0); // 竿身向前上方约 40 度昂首伸向大海
    this.workerTorso.add(this.fishingRodGroup);

    // 1. 钓竿软木双握把 (Two-Handed Cork Handle，长度 2.2m)
    const handleGeom = new THREE.CylinderGeometry(0.12, 0.14, 2.2, 12);
    const rodHandle = new THREE.Mesh(handleGeom, new THREE.MeshStandardMaterial({ color: 0x452b14, roughness: 0.8 }));
    rodHandle.position.y = 0;
    rodHandle.castShadow = true;
    this.fishingRodGroup.add(rodHandle);

    // 2. 金属卷线器轮盘 (Fishing Reel)
    const reelGroup = new THREE.Group();
    reelGroup.position.set(0, -0.4, 0.25);
    const reelBody = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.32, 12), this.matSteel);
    reelBody.rotation.z = Math.PI / 2;
    reelGroup.add(reelBody);
    this.fishingRodGroup.add(reelGroup);

    // 3. 碳纤维竹木长竿身 (长度 6.5m，由粗至细向前上方延伸)
    const blankGeom = new THREE.CylinderGeometry(0.04, 0.12, 6.5, 12);
    const rodBlank = new THREE.Mesh(blankGeom, new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.35, metalness: 0.25 }));
    rodBlank.position.set(0, 4.25, 0);
    rodBlank.castShadow = true;
    this.fishingRodGroup.add(rodBlank);

    // 4. 竿身 5 个精钢金属导线环 (Guide Rings)
    for (let r = 1; r <= 5; r++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08 - r * 0.008, 0.018, 6, 12), this.matSteel);
      ring.position.set(0, 1.2 + r * 1.1, 0.15);
      ring.rotation.y = Math.PI / 2;
      this.fishingRodGroup.add(ring);
    }

    // 竿尖世界坐标标记点 (供钓鱼线精准对齐)
    this.rodTipMarker = new THREE.Object3D();
    this.rodTipMarker.position.set(0, 7.5, 0);
    this.fishingRodGroup.add(this.rodTipMarker);

    // 腰间战术皮带随身别挂木工精钢羊角铁锤 (维持工具相容与细节)
    this.toolGroup = new THREE.Group();
    this.toolGroup.position.set(0.88, 0.15, 0.3);
    this.toolGroup.rotation.set(0, 0, -Math.PI / 4);
    this.workerTorso.add(this.toolGroup);

    const hammerHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.09, 1.6, 10),
      new THREE.MeshStandardMaterial({ color: 0x54361c, roughness: 0.65 })
    );
    hammerHandle.position.y = -0.2;
    hammerHandle.castShadow = true;
    this.toolGroup.add(hammerHandle);

    const hammerHeadGroup = new THREE.Group();
    hammerHeadGroup.position.set(0, 0.6, 0);
    this.toolGroup.add(hammerHeadGroup);

    const headCore = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.4), this.matSteel);
    headCore.castShadow = true;
    hammerHeadGroup.add(headCore);

    const striker = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.35, 12), this.matSteel);
    striker.rotation.x = Math.PI / 2;
    striker.position.set(0, 0, 0.32);
    striker.castShadow = true;
    hammerHeadGroup.add(striker);

    [-0.07, 0.07].forEach((cx) => {
      const claw = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.35), this.matSteel);
      claw.position.set(cx, 0.09, -0.32);
      claw.rotation.x = -Math.PI / 6;
      claw.castShadow = true;
      hammerHeadGroup.add(claw);
    });

    // (E) 眩晕旋转星星容器
    this.dizzyStarsGroup = new THREE.Group();
    this.dizzyStarsGroup.position.set(0, 4.3, 0);
    this.dizzyStarsGroup.visible = false;
    this.workerTorso.add(this.dizzyStarsGroup);

    const starGeom = new THREE.DodecahedronGeometry(0.35);
    const starMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    for (let s = 0; s < 3; s++) {
      const star = new THREE.Mesh(starGeom, starMat);
      star.position.set(Math.cos(s * 2.1) * 1.5, 0, Math.sin(s * 2.1) * 1.5);
      this.dizzyStarsGroup.add(star);
    }

    // (F) 海草缠绕实体
    this.weedWrapMesh = new THREE.Mesh(
      new THREE.TorusGeometry(1.4, 0.42, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 })
    );
    this.weedWrapMesh.position.set(0, -1.8, 0);
    this.weedWrapMesh.rotation.x = Math.PI / 2;
    this.weedWrapMesh.visible = false;
    this.workerTorso.add(this.weedWrapMesh);

    // 保存原始材质，核弹黑炭效果结束后可以完整还原，不会永久留下黑色坏掉的身体。
    this.workerTorso.traverse((child) => {
      if (child.isMesh && child !== this.weedWrapMesh) {
        child.userData.baseMaterial = child.material;
      }
    });
  }

  // 3.6 专业海钓竿、钓线与海面浮标系统 (Fishing Rod & Bobber)
  initFishingLineAndBobber() {
    this.bobberYankTimer = 0;
    this._tipWorldPos = new THREE.Vector3();
    this._bobberWorldPos = new THREE.Vector3();

    // 漂浮于海面上的专业红白色钓鱼浮标 (Bobber)
    this.fishingBobberGroup = new THREE.Group();
    this.fishingBobberPos = new THREE.Vector3(0, 0.2, 13.5);
    this.fishingBobberGroup.position.copy(this.fishingBobberPos);
    this.scene.add(this.fishingBobberGroup);

    // 上半球鲜红、下半球纯白
    const topSemi = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 12, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 })
    );
    const btmSemi = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 12, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 })
    );
    // 顶部黑色细标杆与金黄浮头
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), new THREE.MeshBasicMaterial({ color: 0x18181b }));
    mast.position.y = 0.45;
    const mastTip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
    mastTip.position.y = 0.8;

    this.fishingBobberGroup.add(topSemi, btmSemi, mast, mastTip);

    // 晶莹白色半透明钓鱼线 (Fishing Line)
    const lineGeom = new THREE.BufferGeometry();
    const linePositions = new Float32Array([0, 0, 0, 0, 0, 0]);
    lineGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    this.fishingLine = new THREE.Line(
      lineGeom,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
    );
    this.scene.add(this.fishingLine);
  }

  // 5. 3D 建筑模组 (木筏 -> 木船 -> 内房 -> 二楼 -> 铁壳船 -> 居民楼 -> 豪宅 7 大演化阶段)
  initBuildingStages() {
    this.buildingGroup = new THREE.Group();
    this.buildingGroup.position.set(0, 2.0, -4.0);
    this.raftGroup.add(this.buildingGroup);

    this.stages = [];

    // 专用高精 PBR 材质库 (融合海上度假小镇微缩模型设计语言)
    this.matHullTeak = new THREE.MeshStandardMaterial({ color: 0x5a3418, roughness: 0.65 });
    this.matBowGold = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.35, metalness: 0.75 });
    this.matCabinWall = new THREE.MeshStandardMaterial({ color: 0x7c4a24, roughness: 0.75 });
    this.matCabinTrim = new THREE.MeshStandardMaterial({ color: 0x361f0e, roughness: 0.8 });
    this.matWarmGlass = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    this.matBlueGlass = new THREE.MeshStandardMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.75, roughness: 0.1, metalness: 0.2 });
    this.matGableRoof = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.68 });
    this.matSteelArmor = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.42, metalness: 0.85 });
    this.matHazardYellow = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.5, metalness: 0.2 });
    this.matAptWall = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7 });
    this.matSolarBlue = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, metalness: 0.9, roughness: 0.12 });
    this.matLuxuryWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.18, metalness: 0.08 });
    this.matGoldTrim = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.92, roughness: 0.18 });
    this.matPoolCyan = new THREE.MeshStandardMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.85, roughness: 0.05 });

    // === 海上度假小镇微缩模型统一材质库 (Townscaper / Tiny Glade 风格) ===
    this.matWarmTeak = new THREE.MeshStandardMaterial({ color: 0xb46b38, roughness: 0.62, map: this.texDeckPlank });
    this.matDarkTimber = new THREE.MeshStandardMaterial({ color: 0x42220f, roughness: 0.75 });
    this.matCreamWall = new THREE.MeshStandardMaterial({ color: 0xfff9ed, roughness: 0.58, map: this.texWhiteSiding });
    this.matCedarPlank = new THREE.MeshStandardMaterial({ color: 0xa06235, roughness: 0.68, map: this.texCedarSiding });
    this.matCoralRoof = new THREE.MeshStandardMaterial({ color: 0xc84832, roughness: 0.52, map: this.texRoofTiles });
    this.matRoofRidge = new THREE.MeshStandardMaterial({ color: 0x7c1d10, roughness: 0.72 });
    this.matBrickChimney = new THREE.MeshStandardMaterial({ color: 0x8a3826, roughness: 0.82 });
    this.matFoliageGreen = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.65 });
    this.matFlowerPetal = new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.5 });
    this.matAwningStriped = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, map: this.texAwningStripe });
    this.matWarmLantern = new THREE.MeshStandardMaterial({
      color: 0xffe078,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.65,
      roughness: 0.2
    });
    this.matDeepWindowGlass = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.12,
      metalness: 0.35
    });
    this.matSkyWindowGlass = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.82,
      roughness: 0.1,
      metalness: 0.2
    });
    this.matResortBrass = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.82,
      roughness: 0.22
    });
    this.matWhiteRailing = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 });

    // Stage 0: 原始求生破木筏 (基础核心平台)
    const g0 = new THREE.Group();
    this.buildingGroup.add(g0);
    this.stages.push(g0);

    // Stage 0 专属求生小木筏精致手作细节 (实木渔具箱、盘绕麻绳、木质羊角系缆桩与暖光提灯)
    this.stage0Props = new THREE.Group();
    g0.add(this.stage0Props);

    const s0Mesh = (geom, mat, pos, rot = null) => {
      const m = new THREE.Mesh(geom, mat);
      m.position.set(pos[0], pos[1], pos[2]);
      if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
      m.castShadow = true;
      m.receiveShadow = true;
      this.stage0Props.add(m);
      return m;
    };

    // 1. 实木复古渔具箱 (Tackle Box) - 左侧甲板
    s0Mesh(new THREE.BoxGeometry(2.4, 1.4, 1.6), this.matDarkTimber, [-6.2, 0.7, -4.5]);
    s0Mesh(new THREE.BoxGeometry(2.44, 0.22, 1.64), this.matPlankDeck, [-6.2, 1.42, -4.5]);
    s0Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.1), this.matResortBrass, [-6.2, 0.95, -3.65]);
    s0Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8), this.matResortBrass, [-6.2, 1.6, -4.5], [0, 0, Math.PI / 2]);

    // 2. 双圈盘绕粗麻绳 (Coiled Hemp Rope) - 右侧甲板
    s0Mesh(new THREE.TorusGeometry(1.3, 0.35, 8, 20), this.matRope, [6.2, 0.22, -4.5], [Math.PI / 2, 0, 0]);
    s0Mesh(new THREE.TorusGeometry(0.85, 0.28, 8, 16), this.matRope, [6.0, 0.58, -4.5], [Math.PI / 2, 0, 0]);

    // 3. 羊角系缆木桩 (Mooring Cleats)
    [-8.6, 8.6].forEach((cx) => {
      s0Mesh(new THREE.CylinderGeometry(0.24, 0.28, 1.4, 8), this.matDarkTimber, [cx, 0.7, 6.2]);
      s0Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8), this.matPlankDeck, [cx, 1.15, 6.2], [0, 0, Math.PI / 2]);
    });

    // 4. 左后方原木提灯立柱与暖光灯
    s0Mesh(new THREE.CylinderGeometry(0.12, 0.15, 2.8, 8), this.matDarkTimber, [-7.2, 1.4, 1.5]);
    s0Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.6), this.matWarmLantern, [-7.2, 2.6, 1.5]);

    // ========================================================
    // 1. 木船阶段 (Stage 1: Wooden Boat) - Slot 8 ~ 17 (10 块木头)
    // ========================================================
    const gBoat = new THREE.Group();
    this.buildingGroup.add(gBoat);
    this.stages.push(gBoat);

    // 船体以甲板为基准：buildingGroup 位于 (0, 2, -4)，所有船舷连成一圈，
    // 船首补板与甲板齐平。避免旧版旋转方板、舵和护栏各自悬在船外。
    const boatPart = (geometry, material, position) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };
    const addBoatSlot = (mesh, name) => {
      gBoat.add(mesh);
      this.registerConstructionSlot(mesh, name);
      return mesh;
    };
    [-1, 1].forEach((side) => {
      const hull = boatPart(new THREE.BoxGeometry(0.48, 1.5, 20.8), this.matHullTeak, [side * 10.05, 0.65, 4]);
      const cap = boatPart(new THREE.BoxGeometry(0.62, 0.18, 20.9), this.matPlankDark, [0, 0.82, 0]);
      hull.add(cap);
      addBoatSlot(hull, side < 0 ? '木船左侧船舷' : '木船右侧船舷');
    });

    [-1, 1].forEach((side) => {
      const from = new THREE.Vector3(side * 10.05, 0.65, 14.4);
      const to = new THREE.Vector3(0, 0.65, 18.0);
      const hull = boatPart(new THREE.BoxGeometry(0.48, 1.5, from.distanceTo(to)), this.matHullTeak, from.clone().add(to).multiplyScalar(0.5).toArray());
      hull.lookAt(to);
      hull.add(boatPart(new THREE.BoxGeometry(0.62, 0.18, from.distanceTo(to)), this.matPlankDark, [0, 0.82, 0]));
      addBoatSlot(hull, side < 0 ? '木船左侧船首' : '木船右侧船首');
    });

    const bowShape = new THREE.Shape();
    bowShape.moveTo(-10.05, -14.4);
    bowShape.lineTo(0, -18.0);
    bowShape.lineTo(10.05, -14.4);
    bowShape.closePath();
    const bowDeck = boatPart(new THREE.ExtrudeGeometry(bowShape, { depth: 0.45, bevelEnabled: false }), this.matPlankDeck, [0, -0.55, 0]);
    bowDeck.rotation.x = -Math.PI / 2;
    addBoatSlot(bowDeck, '与主甲板齐平的船首补板');

    const bowBeacon = new THREE.Group();
    bowBeacon.position.set(0, -0.1, 17.6);
    bowBeacon.add(boatPart(new THREE.CylinderGeometry(0.14, 0.2, 2.0, 10), this.matHullTeak, [0, 1, 0]));
    bowBeacon.add(boatPart(new THREE.BoxGeometry(0.55, 0.65, 0.55), this.matBowGold, [0, 2.05, 0]));
    bowBeacon.add(boatPart(new THREE.BoxGeometry(0.42, 0.5, 0.42), this.matWarmLantern, [0, 2.05, 0]));
    addBoatSlot(bowBeacon, '船首黄铜航标灯');

    const rudderGroup = new THREE.Group();
    rudderGroup.position.set(0, -0.5, -7.0);
    rudderGroup.add(boatPart(new THREE.BoxGeometry(0.3, 2.8, 1.6), this.matPlankDark, [0, -1.0, 0]));
    const rudderStem = boatPart(new THREE.CylinderGeometry(0.14, 0.14, 2.8, 10), this.matBowGold, [0, 0.6, 0]);
    const tiller = boatPart(new THREE.BoxGeometry(0.22, 0.22, 1.8), this.matHullTeak, [0, 1.95, 0.75]);
    rudderGroup.add(rudderStem, tiller);
    addBoatSlot(rudderGroup, '与船尾相连的转向木舵');

    const sternRailing = new THREE.Group();
    sternRailing.position.set(0, -0.1, -6.4);
    [-9.8, -4.9, 0, 4.9, 9.8].forEach((x) => {
      sternRailing.add(boatPart(new THREE.CylinderGeometry(0.16, 0.2, 2.1, 8), this.matHullTeak, [x, 1.05, 0]));
    });
    sternRailing.add(boatPart(new THREE.BoxGeometry(20.1, 0.22, 0.32), this.matPlankDark, [0, 2.1, 0]));
    addBoatSlot(sternRailing, '固定在船尾的低护栏');

    // 帆具放在后方左舷，使用直立三角帆，中央留给主播与钓竿。
    // 不再把一整块横向天幕放在角色的头胸高度。
    const rigPosition = new THREE.Vector3(-6.7, -0.1, 0);
    const rigYaw = 1.05;
    const mastGroup = new THREE.Group();
    mastGroup.position.copy(rigPosition);
    mastGroup.rotation.y = rigYaw;
    mastGroup.add(boatPart(new THREE.CylinderGeometry(0.16, 0.26, 10.6, 12), this.matHullTeak, [0, 5.3, 0]));
    const boom = boatPart(new THREE.CylinderGeometry(0.1, 0.1, 5.6, 10), this.matHullTeak, [2.7, 2.5, 0]);
    boom.rotation.z = Math.PI / 2;
    mastGroup.add(boom);
    this.boatMast = addBoatSlot(mastGroup, '左舷帆桅与横桁');

    const sailShape = new THREE.Shape();
    sailShape.moveTo(0.2, 2.75);
    sailShape.lineTo(0.2, 10.1);
    sailShape.lineTo(5.25, 2.75);
    sailShape.closePath();
    this.sailAwning = boatPart(new THREE.ShapeGeometry(sailShape), new THREE.MeshStandardMaterial({ color: 0xf3e5c5, roughness: 0.95, side: THREE.DoubleSide }), rigPosition.toArray());
    this.sailAwning.rotation.y = rigYaw;
    const sailStripe = new THREE.Shape();
    sailStripe.moveTo(0.2, 3.2);
    sailStripe.lineTo(4.95, 3.2);
    sailStripe.lineTo(4.45, 3.95);
    sailStripe.lineTo(0.2, 3.95);
    sailStripe.closePath();
    const stripe = boatPart(new THREE.ShapeGeometry(sailStripe), new THREE.MeshStandardMaterial({ color: 0x287a91, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), [0, 0, 0.012]);
    this.sailAwning.add(stripe);
    addBoatSlot(this.sailAwning, '不遮挡主播的三角帆');

    // ========================================================
    // 2. 内房阶段 (Stage 2: Interior Room / Deckhouse) - Slot 18 ~ 27 (10 块木头)
    // ========================================================
    const gCabin = new THREE.Group();
    this.buildingGroup.add(gCabin);
    this.stages.push(gCabin);

    const cabinPart = (geometry, material, pos, rot = null) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...pos);
      if (rot) mesh.rotation.set(...rot);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      gCabin.add(mesh);
      return mesh;
    };

    // 1) 踢脚原木基座与加固四角立柱 (立足甲板产生自然接触暗部)
    cabinPart(new THREE.BoxGeometry(13.8, 0.45, 10.6), this.matPlankDeck, [0, 0.22, -1.0]);
    [[-6.65, 3.9], [6.65, 3.9], [-6.65, -5.9], [6.65, -5.9]].forEach(([cx, cz]) => {
      cabinPart(new THREE.BoxGeometry(0.72, 6.4, 0.72), this.matDarkTimber, [cx, 3.32, cz]);
      cabinPart(new THREE.BoxGeometry(0.86, 0.35, 0.86), this.matResortBrass, [cx, 0.45, cz]);
    });

    // Slot 18: 舱房后承重板墙 (暖色雪松木板条横向拼接)
    const cabinAftWall = cabinPart(new THREE.BoxGeometry(13.6, 6.2, 0.5), this.matCedarPlank, [0, 3.32, -6.05]);
    this.registerConstructionSlot(cabinAftWall, '内房实木后承重主墙 (Slot 18)');

    // Slot 19: 舱房左侧板墙
    const cabinPortWall = cabinPart(new THREE.BoxGeometry(0.5, 6.2, 10.4), this.matCedarPlank, [-6.65, 3.32, -1.0]);
    this.registerConstructionSlot(cabinPortWall, '内房左侧原木防水外墙 (Slot 19)');

    // Slot 20: 舱房右侧板墙 (朝向 45 度相机主要视野)
    const cabinStarboardWall = cabinPart(new THREE.BoxGeometry(0.5, 6.2, 10.4), this.matCedarPlank, [6.65, 3.32, -1.0]);
    this.registerConstructionSlot(cabinStarboardWall, '内房右侧原木防水外墙 (Slot 20)');

    // Slot 21: 舱房正面主立面原木外墙 (直面玩家与镜头)
    const cabinFrontWall = cabinPart(new THREE.BoxGeometry(13.6, 6.2, 0.5), this.matCedarPlank, [0, 3.32, 3.95]);
    this.registerConstructionSlot(cabinFrontWall, '内房正面主立面木墙 (Slot 21)');

    // Slot 22: 进门木门廊、挑檐遮雨棚、复古暖光马灯与黄铜把手
    const doorGroup = new THREE.Group();
    doorGroup.position.set(2.4, 2.5, 4.2);
    const doorCasing = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.5, 0.3), this.matDarkTimber);
    doorCasing.castShadow = true;
    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(2.0, 4.2, 0.18), this.matCabinTrim);
    doorPanel.position.z = 0.04;
    doorPanel.castShadow = true;
    const doorKnob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), this.matResortBrass);
    doorKnob.position.set(0.72, 0, 0.16);
    // 门廊遮雨挑檐 (Porch Overhang Canopy)
    const doorCanopy = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.22, 1.4), this.matCoralRoof);
    doorCanopy.position.set(0, 2.6, 0.6);
    doorCanopy.rotation.x = 0.28;
    doorCanopy.castShadow = true;
    [-1.1, 1.1].forEach((bx) => {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.12), this.matDarkTimber);
      strut.position.set(bx, 2.15, 0.35);
      strut.rotation.x = -0.55;
      doorGroup.add(strut);
    });
    // 门侧暖光马灯
    const lanternArm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8), this.matResortBrass);
    lanternArm.position.set(-1.45, 1.8, 0.3);
    lanternArm.rotation.z = Math.PI / 2;
    const lanternGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.48, 8), this.matWarmLantern);
    lanternGlass.position.set(-1.65, 1.6, 0.3);
    doorGroup.add(doorCasing, doorPanel, doorKnob, doorCanopy, lanternArm, lanternGlass);
    gCabin.add(doorGroup);
    this.registerConstructionSlot(doorGroup, '内房雕花深木小门与铜把手 (Slot 22)');

    // Slot 23: 右侧朝向镜头的观海百叶双联窗 (替换旧版看不清的左侧舷窗)
    const portholeGroup = new THREE.Group();
    portholeGroup.position.set(6.75, 3.8, -1.0);
    const sideFrame = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.4, 3.4), this.matDarkTimber);
    sideFrame.castShadow = true;
    const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.0, 3.0), this.matDeepWindowGlass);
    const sideShutters = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.8), this.matWarmTeak);
    sideShutters.position.set(0.06, 0, 2.0);
    const sideShuttersL = sideShutters.clone();
    sideShuttersL.position.z = -2.0;
    portholeGroup.add(sideFrame, sideGlass, sideShutters, sideShuttersL);
    gCabin.add(portholeGroup);
    this.registerConstructionSlot(portholeGroup, '内房右侧景观暖光大窗户 (Slot 23)');

    // Slot 24: 正面观海大窗配立体窗套与鲜花花箱 (直面镜头)
    const windowGroup = new THREE.Group();
    windowGroup.position.set(-2.8, 3.6, 4.05);
    const frontFrame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.6, 0.3), this.matDarkTimber);
    frontFrame.castShadow = true;
    const frontMullionH = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 0.32), this.matDarkTimber);
    const frontMullionV = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.4, 0.32), this.matDarkTimber);
    const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(3.3, 2.3, 0.15), this.matWarmLantern);
    // 窗台花槽 (Window Planter Box)
    const flowerBox = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.45, 0.55), this.matWarmTeak);
    flowerBox.position.set(0, -1.45, 0.28);
    flowerBox.castShadow = true;
    const foliage = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, 0.45), this.matFoliageGreen);
    foliage.position.set(0, -1.25, 0.28);
    for (let fx = -1.4; fx <= 1.4; fx += 0.56) {
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), this.matFlowerPetal);
      flower.position.set(fx + (Math.random() - 0.5) * 0.1, -1.05, 0.28 + (Math.random() - 0.5) * 0.1);
      windowGroup.add(flower);
    }
    windowGroup.add(frontFrame, frontMullionH, frontMullionV, frontGlass, flowerBox, foliage);
    gCabin.add(windowGroup);
    this.registerConstructionSlot(windowGroup, '内房正面观海大窗配鲜花花箱 (Slot 24)');

    // Slot 25: 复古红砖壁炉双管大烟囱
    const chimneyGroup = new THREE.Group();
    chimneyGroup.position.set(4.2, 7.8, -3.4);
    const chBrickStack = new THREE.Mesh(new THREE.BoxGeometry(1.25, 3.6, 1.25), this.matBrickChimney);
    chBrickStack.castShadow = true;
    const chPot1 = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.35, 1.1, 10), this.matCabinTrim);
    chPot1.position.set(-0.25, 2.1, 0);
    chPot1.castShadow = true;
    const chPot2 = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.9, 10), this.matCabinTrim);
    chPot2.position.set(0.28, 2.0, 0);
    chPot2.castShadow = true;
    chimneyGroup.add(chBrickStack, chPot1, chPot2);
    gCabin.add(chimneyGroup);
    this.registerConstructionSlot(chimneyGroup, '内房复古红砖排烟双管烟囱 (Slot 25)');

    // Slot 26: 屋架承重山墙、阁楼圆窗与屋脊大梁
    const beamGroup = new THREE.Group();
    beamGroup.position.set(0, 6.4, -1.0);
    const gableGeom = new THREE.CylinderGeometry(0.1, 4.4, 2.9, 3);
    const frontGable = new THREE.Mesh(gableGeom, this.matCedarPlank);
    frontGable.position.set(0, 1.45, 4.95);
    frontGable.rotation.y = Math.PI;
    frontGable.castShadow = true;
    const rearGable = new THREE.Mesh(gableGeom, this.matCedarPlank);
    rearGable.position.set(0, 1.45, -5.05);
    rearGable.castShadow = true;
    const atticWindow = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.12, 8, 16), this.matResortBrass);
    atticWindow.position.set(0, 1.35, 5.08);
    const atticGlass = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), this.matWarmLantern);
    atticGlass.position.set(0, 1.35, 5.07);
    const ridgeBeam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 11.4), this.matRoofRidge);
    ridgeBeam.position.set(0, 3.0, 0);
    ridgeBeam.castShadow = true;
    beamGroup.add(frontGable, rearGable, atticWindow, atticGlass, ridgeBeam);
    gCabin.add(beamGroup);
    this.registerConstructionSlot(beamGroup, '内房双坡山墙与阁楼圆窗 (Slot 26)');

    // Slot 27: 经典双面人字坡立体珊瑚红厚出檐屋顶 (协调立面与屋顶比例，出檐适度)
    const roofSlope = 0.38;
    const roofLeft = new THREE.Mesh(new THREE.BoxGeometry(7.1, 0.38, 11.4), this.matCoralRoof);
    roofLeft.position.set(-2.95, 7.95, -1.0);
    roofLeft.rotation.z = roofSlope;
    roofLeft.castShadow = true;
    roofLeft.receiveShadow = true;
    const roofRight = new THREE.Mesh(new THREE.BoxGeometry(7.1, 0.38, 11.4), this.matCoralRoof);
    roofRight.position.set(2.95, 7.95, -1.0);
    roofRight.rotation.z = -roofSlope;
    roofRight.castShadow = true;
    roofRight.receiveShadow = true;
    const fasciaFrontL = new THREE.Mesh(new THREE.BoxGeometry(7.15, 0.20, 0.24), this.matDarkTimber);
    fasciaFrontL.position.set(-2.95, 7.95, 4.7);
    fasciaFrontL.rotation.z = roofSlope;
    const fasciaFrontR = new THREE.Mesh(new THREE.BoxGeometry(7.15, 0.20, 0.24), this.matDarkTimber);
    fasciaFrontR.position.set(2.95, 7.95, 4.7);
    fasciaFrontR.rotation.z = -roofSlope;
    const cabinRoofGroup = new THREE.Group();
    cabinRoofGroup.add(roofLeft, roofRight, fasciaFrontL, fasciaFrontR);
    gCabin.add(cabinRoofGroup);
    this.registerConstructionSlot(cabinRoofGroup, '经典人字坡珊瑚红厚出檐屋顶 (Slot 27)');

    // ========================================================
    // 4. 多层铁皮屋与阳台美女室友 (Stage 4) - Slot 28 ~ 40
    // ========================================================
    const g2F = new THREE.Group();
    this.buildingGroup.add(g2F);

    // Slot 28: 二楼木质斜梯侧梁
    this.staircaseGroup = new THREE.Group();
    this.staircaseGroup.position.set(-8.2, 0, 0.5);
    const stringerL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8.5, 0.4), this.matPlankDark);
    stringerL.position.set(-1.0, 3.6, -1.0);
    stringerL.rotation.x = 0.58;
    const stringerR = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8.5, 0.4), this.matPlankDark);
    stringerR.position.set(1.0, 3.6, -1.0);
    stringerR.rotation.x = 0.58;
    this.staircaseGroup.add(stringerL, stringerR);
    g2F.add(this.staircaseGroup);
    this.registerConstructionSlot(this.staircaseGroup, '二楼木质斜梯主架构 (Slot 28)');

    // Slot 29: 斜木梯 6 级踏步阶梯
    const stepsGroup = new THREE.Group();
    stepsGroup.position.set(-8.2, 0, 0.5);
    for (let s = 0; s < 6; s++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.25, 0.8), this.matPlankDeck);
      step.position.set(0, 0.9 + s * 1.05, 1.8 - s * 0.95);
      stepsGroup.add(step);
    }
    g2F.add(stepsGroup);
    this.registerConstructionSlot(stepsGroup, '二楼斜木梯防滑踏步阶梯 (Slot 29)');

    // Slot 30: 二楼观景阳台外挑木地板
    const balconyDeck = new THREE.Mesh(new THREE.BoxGeometry(15.2, 0.55, 6.2), this.matPlankDeck);
    balconyDeck.position.set(0, 6.8, 4.2);
    g2F.add(balconyDeck);
    this.registerConstructionSlot(balconyDeck, '二楼观景阳台外挑木地板 (Slot 30)');

    // Slot 31: 二楼阳台四周精修原木栏杆
    const balconyRailingGroup = new THREE.Group();
    balconyRailingGroup.position.set(0, 7.1, 4.2);
    for (let bx = -7.2; bx <= 7.2; bx += 2.4) {
      const bp = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.4, 8), this.matHullTeak);
      bp.position.set(bx, 1.2, 3.0);
      balconyRailingGroup.add(bp);
    }
    const bTopRail = new THREE.Mesh(new THREE.BoxGeometry(15.4, 0.3, 0.35), this.matPlankDark);
    bTopRail.position.set(0, 2.4, 3.0);
    balconyRailingGroup.add(bTopRail);
    g2F.add(balconyRailingGroup);
    this.registerConstructionSlot(balconyRailingGroup, '二楼阳台原木防坠护栏 (Slot 31)');

    // Slot 32: 二楼阳台上悠闲看书的紫发女助手 (保持外部引用)
    this.initBalconyAlly(g2F);
    this.registerConstructionSlot(this.allyGroup, '二楼阳台紫发看书女助手 (Slot 32)');

    // Slot 33: 二楼方舱阁楼卧室主体
    const loftRoomBody = new THREE.Mesh(new THREE.BoxGeometry(11.5, 6.0, 9.2), this.matCabinWall);
    loftRoomBody.position.set(0, 10.0, -1.8);
    g2F.add(loftRoomBody);
    this.registerConstructionSlot(loftRoomBody, '二楼原木方舱卧室主体 (Slot 33)');

    // Slot 34: 二楼卧室正面暖黄格子观海窗
    const loftWindow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.2), this.matWarmGlass);
    loftWindow.position.set(0, 10.5, 2.85);
    g2F.add(loftWindow);
    this.registerConstructionSlot(loftWindow, '二楼卧室正面观海暖光窗 (Slot 34)');

    // Slot 35: 二楼后部通风百叶窗
    const loftAftWindow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), this.matCabinTrim);
    loftAftWindow.position.set(0, 10.5, -6.45);
    loftAftWindow.rotation.y = Math.PI;
    g2F.add(loftAftWindow);
    this.registerConstructionSlot(loftAftWindow, '二楼后侧通风百叶窗 (Slot 35)');

    // Slot 36: 二楼双坡屋架前后山墙
    const gablesGroup = new THREE.Group();
    gablesGroup.position.set(0, 13.0, -1.8);
    [-4.6, 4.6].forEach((gz) => {
      const gable = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 4.2, 3.2, 3), this.matCabinWall);
      gable.position.set(0, 1.6, gz);
      gablesGroup.add(gable);
    });
    g2F.add(gablesGroup);
    this.registerConstructionSlot(gablesGroup, '二楼双坡屋架原木山墙 (Slot 36)');

    // Slot 37: 双面人字坡红棕波纹斜屋顶
    const villaRoofLeft = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.45, 11.2), this.matGableRoof);
    villaRoofLeft.position.set(-3.2, 14.2, -1.8);
    villaRoofLeft.rotation.z = 0.52;
    const villaRoofRight = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.45, 11.2), this.matGableRoof);
    villaRoofRight.position.set(3.2, 14.2, -1.8);
    villaRoofRight.rotation.z = -0.52;
    const gableRoofGroup = new THREE.Group();
    gableRoofGroup.add(villaRoofLeft, villaRoofRight);
    g2F.add(gableRoofGroup);
    this.registerConstructionSlot(gableRoofGroup, '经典双面人字坡红棕斜屋顶 (Slot 37)');

    // Slot 38: 人字屋顶原木防风屋脊压条
    const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 11.6), this.matPlankDark);
    ridgeCap.position.set(0, 15.9, -1.8);
    g2F.add(ridgeCap);
    this.registerConstructionSlot(ridgeCap, '屋顶人字坡防风屋脊大梁 (Slot 38)');

    // Slot 39: 阁楼观星小天窗
    const skylight = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 2.0), this.matBlueGlass);
    skylight.position.set(3.4, 14.4, -1.8);
    skylight.rotation.z = -0.52;
    g2F.add(skylight);
    this.registerConstructionSlot(skylight, '二楼阁楼倾斜观星天窗 (Slot 39)');

    // Slot 40: 阳台防雨帆布遮阳帘
    const balconyAwning = new THREE.Mesh(
      new THREE.BoxGeometry(14.8, 0.12, 3.8),
      new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.85 })
    );
    balconyAwning.position.set(0, 12.5, 1.8);
    balconyAwning.rotation.x = -0.15;
    g2F.add(balconyAwning);
    this.registerConstructionSlot(balconyAwning, '二楼阳台条纹防雨遮阳篷 (Slot 40)');

    // ========================================================
    // 4. 铁壳船阶段 (Stage 4: Iron Hull Ship) - Slot 41 ~ 55 (15 块木头)
    // ========================================================
    const gIron = new THREE.Group();
    this.buildingGroup.add(gIron);
    this.stages.push(gIron);

    // Slot 41: 左舷海军灰深色铆钉钢铁装甲板
    const steelPortArmor = new THREE.Mesh(new THREE.BoxGeometry(0.65, 3.6, 24.0), this.matSteelArmor);
    steelPortArmor.position.set(-10.6, 1.2, 0);
    gIron.add(steelPortArmor);
    this.registerConstructionSlot(steelPortArmor, '左舷海军钢铁装甲防护板 (Slot 41)');

    // Slot 42: 右舷海军灰深色铆钉钢铁装甲板
    const steelStarboardArmor = new THREE.Mesh(new THREE.BoxGeometry(0.65, 3.6, 24.0), this.matSteelArmor);
    steelStarboardArmor.position.set(10.6, 1.2, 0);
    gIron.add(steelStarboardArmor);
    this.registerConstructionSlot(steelStarboardArmor, '右舷海军钢铁装甲防护板 (Slot 42)');

    // Slot 43: 船首重型破浪防撞钢角
    const steelBowRam = new THREE.Mesh(new THREE.ConeGeometry(2.4, 5.5, 4), this.matSteelArmor);
    steelBowRam.rotation.x = Math.PI / 2;
    steelBowRam.rotation.y = Math.PI / 4;
    steelBowRam.position.set(0, 1.2, 21.5);
    gIron.add(steelBowRam);
    this.registerConstructionSlot(steelBowRam, '船首重型破浪防撞钢角 (Slot 43)');

    // Slot 44: 船体两侧工业安全防撞钢梁
    const bumperRailsGroup = new THREE.Group();
    [-10.9, 10.9].forEach((bx) => {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 23.0, 8), this.matHazardYellow);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(bx, 2.4, 0);
      bumperRailsGroup.add(rail);
    });
    gIron.add(bumperRailsGroup);
    this.registerConstructionSlot(bumperRailsGroup, '船侧工业警示防撞钢梁 (Slot 44)');

    // Slot 45: 钢铁机舱散热格栅与重油管路
    const enginePipesGroup = new THREE.Group();
    enginePipesGroup.position.set(-5.5, 3.5, -6.5);
    const pipe1 = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 4.2, 8), this.matRustyMetal);
    const pipe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 4.2, 8), this.matHazardYellow);
    pipe2.position.x = 0.8;
    enginePipesGroup.add(pipe1, pipe2);
    gIron.add(enginePipesGroup);
    this.registerConstructionSlot(enginePipesGroup, '轮机舱通风格栅与重油管路 (Slot 45)');

    // Slot 46: 粗壮金属工业消音排气大烟囱
    const heavyExhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 6.5, 12), this.matRustyMetal);
    heavyExhaust.position.set(-4.5, 12.0, -5.5);
    heavyExhaust.rotation.z = -0.12;
    gIron.add(heavyExhaust);
    this.registerConstructionSlot(heavyExhaust, '工业消音重型排气大烟囱 (Slot 46)');

    // Slot 47: 高空风力发电机立柱塔 (保持 this.windTurbine 引用)
    this.windTurbine = new THREE.Group();
    this.windTurbine.position.set(5.5, 6.0, -4.5);
    const turbineMast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 10.0, 10), this.matAptWall);
    turbineMast.position.y = 5.0;
    this.windTurbine.add(turbineMast);
    gIron.add(this.windTurbine);
    this.registerConstructionSlot(this.windTurbine, '高空风力发电机圆柱立塔 (Slot 47)');

    // Slot 48: 风力发电机涡轮发电机舱 (加在立塔顶端，严丝合缝)
    const nacellePod = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 2.4), this.matAptWall);
    nacellePod.position.set(0, 10.0, 0);
    this.windTurbine.add(nacellePod);
    this.registerConstructionSlot(nacellePod, '风力发电机涡轮发电机舱 (Slot 48)');

    // Slot 49 ~ 51: 3片风力发电机旋转叶片 (安装在机舱前端中心轴，绝不悬空飘浮)
    this.turbineBlades = [];
    const bladeHub = new THREE.Group();
    bladeHub.position.set(0, 10.0, 1.3);
    for (let b = 0; b < 3; b++) {
      const bladeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.5, 0.08), this.matLuxuryWhite);
      bladeMesh.position.y = 2.25;
      const bPivot = new THREE.Group();
      bPivot.rotation.z = (b * Math.PI * 2) / 3;
      bPivot.add(bladeMesh);
      bladeHub.add(bPivot);
      this.turbineBlades.push(bPivot);
    }
    this.windTurbine.add(bladeHub);
    this.registerConstructionSlot(this.turbineBlades[0], '风力发电机旋转叶片 1 (Slot 49)');
    this.registerConstructionSlot(this.turbineBlades[1], '风力发电机旋转叶片 2 (Slot 50)');
    this.registerConstructionSlot(this.turbineBlades[2], '风力发电机旋转叶片 3 (Slot 51)');

    // Slot 52: 钢铁船员甲板防护网与安全扶手
    const steelRailings = new THREE.Mesh(new THREE.BoxGeometry(19.8, 1.4, 0.15), this.matSteelArmor);
    steelRailings.position.set(0, 3.2, 9.8);
    gIron.add(steelRailings);
    this.registerConstructionSlot(steelRailings, '钢铁甲板安全防护栏杆 (Slot 52)');

    // Slot 53: 舰桥高亮度旋转探照灯
    const searchlight = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.9, 12), this.matWarmGlass);
    searchlight.rotation.x = Math.PI / 2;
    searchlight.position.set(-3.5, 14.2, 2.5);
    gIron.add(searchlight);
    this.registerConstructionSlot(searchlight, '舰桥高亮度夜航探照灯 (Slot 53)');

    // Slot 54: 船尾备用金属燃料储罐
    const aftFuelTank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 4.8, 12), this.matSteelArmor);
    aftFuelTank.rotation.z = Math.PI / 2;
    aftFuelTank.position.set(0, 3.2, -9.8);
    gIron.add(aftFuelTank);
    this.registerConstructionSlot(aftFuelTank, '船尾应急金属燃料储罐 (Slot 54)');

    // Slot 55: 旋转雷达导航天线
    const radarBar = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.35, 0.45), this.matAptWall);
    radarBar.position.set(-3.5, 16.5, 0);
    gIron.add(radarBar);
    this.registerConstructionSlot(radarBar, '船用导航旋转雷达天线 (Slot 55)');

    // 独立船长室主体与观海窗 (Captain's Bridge - 铁皮船专属独立指挥室)
    const bridgeRoom = new THREE.Mesh(new THREE.BoxGeometry(11.8, 5.2, 8.8), this.matSteelArmor);
    bridgeRoom.position.set(0, 4.6, -1.0);
    const bridgeWindow = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.6, 0.35), this.matBlueGlass);
    bridgeWindow.position.set(0, 5.8, 3.45);
    const bridgeRoof = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.45, 9.4), this.matSteelArmor);
    bridgeRoof.position.set(0, 7.2, -1.0);
    gIron.add(bridgeRoom, bridgeWindow, bridgeRoof);
    this.registerConstructionSlot(bridgeRoom, '铁皮船钢铁独立船长室 (Slot 40)');

    // ========================================================
    // 4. 多层铁皮屋阶段 (Stage 4: Multi-tier Corrugated Shack) - 美女室友
    // ========================================================
    this.stages.push(g2F);

    // Stage 4 视觉重构：以单一、比例一致的海景小屋取代旧版多组件叠加。
    // 旧版 g2F 保留给历史资产与施工槽位相容，但不再直接显示，避免
    // 铁皮船长室、风车、斜屋顶和二楼屋体在同一阶段互相穿模。
    this.legacyStage4Group = g2F;
    g2F.visible = false;

    const gHouse = new THREE.Group();
    this.buildingGroup.add(gHouse);
    this.houseStageGroup = gHouse;
    this.stages[4] = gHouse;
    gHouse.scale.set(1.08, 1.08, 1.08);

    const villaMesh = (geometry, material, position, rotation = null) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(position[0], position[1], position[2]);
      if (rotation) mesh.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      gHouse.add(mesh);
      return mesh;
    };

    // 1. 底座与一层奶油白木板外墙 (立足甲板，清晰立面分段)
    villaMesh(new THREE.BoxGeometry(16.0, 0.45, 12.0), this.matPlankDeck, [0, 0.25, -0.6]);
    // 一层主体：明亮清爽的奶油白外墙 (Cream-White Weatherboard)
    villaMesh(new THREE.BoxGeometry(12.4, 5.0, 9.2), this.matCreamWall, [0, 2.75, -1.2]);
    // 一层四角转角原木立柱与踢脚线
    [[-6.2, 3.4], [6.2, 3.4], [-6.2, -5.8], [6.2, -5.8]].forEach(([cx, cz]) => {
      villaMesh(new THREE.BoxGeometry(0.68, 5.1, 0.68), this.matDarkTimber, [cx, 2.75, cz]);
      villaMesh(new THREE.BoxGeometry(0.82, 0.35, 0.82), this.matResortBrass, [cx, 0.4, cz]);
    });
    // 一层与二层交界横梁腰线 (Belt Beam)
    villaMesh(new THREE.BoxGeometry(13.2, 0.28, 9.8), this.matDarkTimber, [0, 5.25, -1.2]);

    // 一层正面：中央双开大门、两侧大观海窗配鲜花花箱
    villaMesh(new THREE.BoxGeometry(2.4, 3.8, 0.25), this.matDarkTimber, [0, 2.35, 3.45]);
    villaMesh(new THREE.BoxGeometry(2.0, 3.5, 0.18), this.matWarmTeak, [0, 2.35, 3.52]);
    villaMesh(new THREE.SphereGeometry(0.12, 8, 8), this.matResortBrass, [-0.4, 2.35, 3.65]);
    villaMesh(new THREE.SphereGeometry(0.12, 8, 8), this.matResortBrass, [0.4, 2.35, 3.65]);

    // 一层正面两侧大窗与花箱
    [-3.8, 3.8].forEach((wx) => {
      villaMesh(new THREE.BoxGeometry(2.8, 2.0, 0.25), this.matDarkTimber, [wx, 3.3, 3.45]);
      villaMesh(new THREE.BoxGeometry(2.5, 1.7, 0.15), this.matDeepWindowGlass, [wx, 3.3, 3.5]);
      villaMesh(new THREE.BoxGeometry(2.5, 0.1, 0.18), this.matWhiteRailing, [wx, 3.3, 3.52]);
      villaMesh(new THREE.BoxGeometry(0.1, 1.7, 0.18), this.matWhiteRailing, [wx, 3.3, 3.52]);
      // 窗台花箱
      villaMesh(new THREE.BoxGeometry(2.9, 0.38, 0.45), this.matWarmTeak, [wx, 2.1, 3.6]);
      villaMesh(new THREE.BoxGeometry(2.7, 0.28, 0.38), this.matFoliageGreen, [wx, 2.25, 3.6]);
      for (let fx = -1.1; fx <= 1.1; fx += 0.55) {
        villaMesh(new THREE.SphereGeometry(0.1, 6, 6), this.matFlowerPetal, [wx + fx, 2.45, 3.6]);
      }
    });

    // 一层右侧朝向镜头的全景落地观海窗与外挂百叶窗套
    villaMesh(new THREE.BoxGeometry(0.25, 2.4, 3.6), this.matDarkTimber, [6.25, 3.2, -1.2]);
    villaMesh(new THREE.BoxGeometry(0.15, 2.1, 3.3), this.matDeepWindowGlass, [6.25, 3.2, -1.2]);
    villaMesh(new THREE.BoxGeometry(0.2, 2.3, 0.75), this.matWarmTeak, [6.32, 3.2, 0.9]);
    villaMesh(new THREE.BoxGeometry(0.2, 2.3, 0.75), this.matWarmTeak, [6.32, 3.2, -3.3]);

    // 2. 二层退缩式阁楼生活区 (Warm Cedar Siding)
    villaMesh(new THREE.BoxGeometry(10.2, 4.2, 6.8), this.matCedarPlank, [0, 7.35, -2.4]);
    [[-5.1, 1.0], [5.1, 1.0], [-5.1, -5.8], [5.1, -5.8]].forEach(([cx, cz]) => {
      villaMesh(new THREE.BoxGeometry(0.55, 4.3, 0.55), this.matDarkTimber, [cx, 7.35, cz]);
    });
    // 二层正面观海玻璃门与暖光窗
    villaMesh(new THREE.BoxGeometry(1.8, 3.2, 0.2), this.matDarkTimber, [-2.2, 7.0, 1.05]);
    villaMesh(new THREE.BoxGeometry(1.5, 2.9, 0.12), this.matDeepWindowGlass, [-2.2, 7.0, 1.1]);
    villaMesh(new THREE.BoxGeometry(3.2, 1.8, 0.2), this.matDarkTimber, [1.8, 7.2, 1.05]);
    villaMesh(new THREE.BoxGeometry(2.9, 1.5, 0.12), this.matWarmLantern, [1.8, 7.2, 1.1]);

    // 3. 二层外挑海景度假大阳台 (Expansive Observation Balcony)
    const balconyY = 5.35;
    villaMesh(new THREE.BoxGeometry(12.4, 0.38, 4.2), this.matPlankDeck, [0, balconyY, 1.5]);
    // 阳台精致白木栏杆 (White Nautical Balustrade)
    villaMesh(new THREE.BoxGeometry(12.6, 0.16, 0.18), this.matWarmTeak, [0, balconyY + 1.25, 3.55]);
    villaMesh(new THREE.BoxGeometry(12.4, 0.12, 0.12), this.matWhiteRailing, [0, balconyY + 0.15, 3.55]);
    for (let rx = -5.8; rx <= 5.8; rx += 1.16) {
      villaMesh(new THREE.BoxGeometry(0.08, 1.05, 0.08), this.matWhiteRailing, [rx, balconyY + 0.65, 3.55]);
    }
    // 阳台右侧护栏
    villaMesh(new THREE.BoxGeometry(0.18, 0.16, 4.1), this.matWarmTeak, [6.25, balconyY + 1.25, 1.5]);
    villaMesh(new THREE.BoxGeometry(0.12, 0.12, 4.0), this.matWhiteRailing, [6.25, balconyY + 0.15, 1.5]);
    for (let rz = -0.3; rz <= 3.3; rz += 0.9) {
      villaMesh(new THREE.BoxGeometry(0.08, 1.05, 0.08), this.matWhiteRailing, [6.25, balconyY + 0.65, rz]);
    }

    // 4. 度假风蓝白条纹帆布遮阳雨棚 (调整位置至二层入户门上方，绝不遮挡室友)
    const awning = villaMesh(new THREE.BoxGeometry(4.8, 0.12, 1.8), this.matAwningStriped, [-2.2, balconyY + 3.2, 0.4], [-0.22, 0, 0]);
    // 遮阳棚木质斜撑立柱
    [[-4.2, -0.4], [-0.2, -0.4]].forEach(([px, pz]) => {
      villaMesh(new THREE.CylinderGeometry(0.08, 0.08, 2.8, 8), this.matDarkTimber, [px, balconyY + 1.8, pz]);
    });

    // 阳台休闲小茶几与热带盆栽
    villaMesh(new THREE.CylinderGeometry(0.65, 0.55, 0.72, 12), this.matWarmTeak, [0.6, balconyY + 0.45, 2.2]);
    villaMesh(new THREE.CylinderGeometry(0.35, 0.25, 0.45, 10), this.matBrickChimney, [0.6, balconyY + 0.95, 2.2]);
    villaMesh(new THREE.SphereGeometry(0.38, 8, 8), this.matFoliageGreen, [0.6, balconyY + 1.25, 2.2]);

    // 5. 优雅安置紫发美女室友 (位于二层阳台前方开阔观海区，头身比例清晰，绝无任何遮挡)
    if (this.allyGroup) {
      this.allyGroup.position.set(2.4, balconyY + 0.15, 2.3);
      this.allyGroup.scale.set(1.0, 1.0, 1.0);
      this.allyGroup.rotation.y = -0.25; // 身体自然微侧朝向海面与钓鱼主角
      gHouse.add(this.allyGroup);
    }

    // 6. 左侧外挂实木阶梯 (连接一层主甲板与二层观海阳台)
    const stairStringer = villaMesh(new THREE.BoxGeometry(0.25, 6.2, 0.35), this.matDarkTimber, [-6.7, 2.7, 0.6], [0.65, 0, 0]);
    for (let st = 0; st < 6; st++) {
      villaMesh(new THREE.BoxGeometry(1.6, 0.18, 0.65), this.matPlankDeck, [-6.7, 0.75 + st * 0.82, 2.4 - st * 0.62]);
    }

    // 7. 经典人字坡珊瑚红厚出檐屋顶配天窗与烟囱
    const villaRoofSlope = 0.42;
    villaMesh(new THREE.BoxGeometry(6.6, 0.42, 8.8), this.matCoralRoof, [-2.7, 9.8, -2.4], [0, 0, villaRoofSlope]);
    villaMesh(new THREE.BoxGeometry(6.6, 0.42, 8.8), this.matCoralRoof, [2.7, 9.8, -2.4], [0, 0, -villaRoofSlope]);
    // 屋脊大梁压条
    villaMesh(new THREE.BoxGeometry(0.55, 0.55, 9.2), this.matRoofRidge, [0, 10.95, -2.4]);
    // 挑檐收边线条
    villaMesh(new THREE.BoxGeometry(6.65, 0.22, 0.25), this.matDarkTimber, [-2.7, 9.8, 2.05], [0, 0, villaRoofSlope]);
    villaMesh(new THREE.BoxGeometry(6.65, 0.22, 0.25), this.matDarkTimber, [2.7, 9.8, 2.05], [0, 0, -villaRoofSlope]);

    // 前后山墙封闭 (Triangular Gable Walls)
    const makeGable = (vertices, material) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      return villaMesh(geometry, material, [0, 0, 0]);
    };
    makeGable([-5.1, 9.45, 1.0, 5.1, 9.45, 1.0, 0, 10.9, 1.0], this.matCedarPlank);
    makeGable([-5.1, 9.45, -5.8, 5.1, 9.45, -5.8, 0, 10.9, -5.8], this.matCedarPlank);

    // 右侧倾斜朝向相机的清亮观海天窗 (Skylight Window)
    villaMesh(new THREE.BoxGeometry(1.8, 0.2, 2.4), this.matSkyWindowGlass, [2.8, 10.0, -2.2], [0, 0, -villaRoofSlope]);
    villaMesh(new THREE.BoxGeometry(2.0, 0.25, 0.16), this.matWhiteRailing, [2.8, 10.02, -1.0], [0, 0, -villaRoofSlope]);
    villaMesh(new THREE.BoxGeometry(2.0, 0.25, 0.16), this.matWhiteRailing, [2.8, 10.02, -3.4], [0, 0, -villaRoofSlope]);

    // 屋顶后侧复古双管红砖烟囱
    const villaChimney = villaMesh(new THREE.BoxGeometry(1.2, 3.4, 1.2), this.matBrickChimney, [3.2, 10.8, -4.5]);
    villaMesh(new THREE.CylinderGeometry(0.24, 0.28, 0.8, 8), this.matCabinTrim, [3.0, 12.6, -4.5]);
    villaMesh(new THREE.CylinderGeometry(0.24, 0.28, 0.8, 8), this.matCabinTrim, [3.5, 12.5, -4.5]);

    // 屋顶黄铜航海风向标 (Nautical Weather Vane)
    villaMesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), this.matResortBrass, [0, 11.7, -2.4]);
    villaMesh(new THREE.BoxGeometry(1.2, 0.18, 0.04), this.matResortBrass, [0, 12.2, -2.4]);
    villaMesh(new THREE.ConeGeometry(0.18, 0.35, 8), this.matResortBrass, [0.65, 12.2, -2.4], [0, 0, -Math.PI / 2]);

    // ========================================================
    // 3. 铁皮船阶段 (Stage 3: Iron Rescue & Industrial Exploration Ship)
    // ========================================================
    this.legacyIronGroup = gIron;
    gIron.visible = false;
    const gIronShowcase = new THREE.Group();
    this.buildingGroup.add(gIronShowcase);
    this.stages[3] = gIronShowcase;

    // 海事工业救援配色：深海蓝船体 + 奶油白驾驶桥楼 + 黄铜探照灯 + 黑色橡胶防撞胎 + 白橙救生圈
    const matNavyHull = new THREE.MeshStandardMaterial({ color: 0x244c6b, roughness: 0.42, metalness: 0.58 });
    const matBridgeWhite = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.48, metalness: 0.22 });
    const matSteelDark = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.52, metalness: 0.72 });
    const matSafetyYellow = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.38, metalness: 0.42 });
    const matPortholeGlass = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.45,
      roughness: 0.12,
      metalness: 0.3,
    });
    const matRubberTire = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.92, metalness: 0.04 });
    const matLifebuoyOrange = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5 });
    const matLifebuoyWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });

    const ironMesh = (geometry, material, position, rotation = null) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(position[0], position[1], position[2]);
      if (rotation) mesh.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      gIronShowcase.add(mesh);
      return mesh;
    };

    // 1. 深海蓝装甲防护船舷 (两侧厚板与钢制护栏压条)
    [-9.6, 9.6].forEach((side) => {
      ironMesh(new THREE.BoxGeometry(0.65, 3.2, 21.2), matNavyHull, [side, 1.6, 0]);
      ironMesh(new THREE.BoxGeometry(0.9, 0.25, 21.4), matSteelDark, [side, 3.25, 0]);
      ironMesh(new THREE.BoxGeometry(0.72, 0.28, 20.8), matSafetyYellow, [side, 2.9, 0]);
    });

    // 船尾防护装甲板
    ironMesh(new THREE.BoxGeometry(19.8, 3.2, 0.65), matNavyHull, [0, 1.6, -10.3]);
    ironMesh(new THREE.BoxGeometry(20.0, 0.25, 0.9), matSteelDark, [0, 3.25, -10.3]);

    // 2. 船侧防撞橡胶轮胎 (Rubber Bumper Tires) - 左右各挂 3 只
    [-9.95, 9.95].forEach((side) => {
      [-6.5, 0, 6.5].forEach((tz) => {
        ironMesh(new THREE.TorusGeometry(0.85, 0.32, 8, 16), matRubberTire, [side, 1.4, tz], [0, Math.PI / 2, 0]);
        ironMesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), matSteelDark, [side, 2.3, tz]);
      });
    });

    // 3. 下层深蓝主舱室 (Lower Deckhouse)
    ironMesh(new THREE.BoxGeometry(11.8, 4.4, 9.2), matNavyHull, [0, 2.8, -1.6]);
    ironMesh(new THREE.BoxGeometry(12.4, 0.35, 9.8), matSteelDark, [0, 5.1, -1.6]);

    // 正面水密舱门与黄铜手轮
    ironMesh(new THREE.BoxGeometry(2.4, 3.4, 0.22), matSteelDark, [0, 2.3, 3.1]);
    ironMesh(new THREE.TorusGeometry(0.35, 0.08, 8, 12), this.matResortBrass, [0, 2.4, 3.25]);

    // 下层侧面圆形舷窗与白橙救生圈
    [-5.95, 5.95].forEach((side) => {
      [-3.5, 0].forEach((pz) => {
        ironMesh(new THREE.CylinderGeometry(0.65, 0.65, 0.15, 12), this.matResortBrass, [side, 3.2, pz], [0, 0, Math.PI / 2]);
        ironMesh(new THREE.CylinderGeometry(0.52, 0.52, 0.18, 12), matPortholeGlass, [side, 3.2, pz], [0, 0, Math.PI / 2]);
      });
      ironMesh(new THREE.TorusGeometry(0.72, 0.22, 8, 16), matLifebuoyOrange, [side * 1.01, 3.2, 1.8], [0, Math.PI / 2, 0]);
      ironMesh(new THREE.BoxGeometry(0.12, 0.5, 0.5), matLifebuoyWhite, [side * 1.01, 3.2, 2.5]);
      ironMesh(new THREE.BoxGeometry(0.12, 0.5, 0.5), matLifebuoyWhite, [side * 1.01, 3.2, 1.1]);
    });

    // 4. 上层奶油白独立全景驾驶舰桥 (Upper Wheelhouse Bridge)
    ironMesh(new THREE.BoxGeometry(9.6, 2.8, 7.2), matBridgeWhite, [0, 6.6, -1.8]);
    ironMesh(new THREE.BoxGeometry(10.2, 0.32, 7.8), matNavyHull, [0, 8.1, -1.8]);

    // 正面连续观海舷窗带
    [-2.8, 0, 2.8].forEach((wx) => {
      ironMesh(new THREE.BoxGeometry(2.3, 1.35, 0.18), this.matResortBrass, [wx, 6.7, 1.85]);
      ironMesh(new THREE.BoxGeometry(2.05, 1.15, 0.24), matPortholeGlass, [wx, 6.7, 1.85]);
    });
    // 侧面观海舷窗
    [-4.85, 4.85].forEach((side) => {
      ironMesh(new THREE.BoxGeometry(0.18, 1.35, 2.6), this.matResortBrass, [side, 6.7, -1.8]);
      ironMesh(new THREE.BoxGeometry(0.24, 1.15, 2.3), matPortholeGlass, [side, 6.7, -1.8]);
    });

    // 5. 顶层工业雷达架构、探照灯与双音汽笛
    ironMesh(new THREE.CylinderGeometry(0.16, 0.22, 3.2, 8), matSteelDark, [3.2, 9.6, -2.4]);
    ironMesh(new THREE.CylinderGeometry(0.16, 0.22, 3.2, 8), matSteelDark, [-3.2, 9.6, -2.4]);
    ironMesh(new THREE.BoxGeometry(7.2, 0.24, 0.32), matSteelDark, [0, 11.1, -2.4]);
    ironMesh(new THREE.BoxGeometry(3.6, 0.32, 0.4), matSafetyYellow, [0, 11.5, -2.4]);

    // 强光探照灯
    ironMesh(new THREE.CylinderGeometry(0.42, 0.52, 0.8, 12), this.matResortBrass, [0, 8.7, 1.5], [Math.PI / 2, 0, 0]);
    ironMesh(new THREE.CircleGeometry(0.4, 12), matPortholeGlass, [0, 8.7, 1.92]);

    // 双音气动铜汽笛
    ironMesh(new THREE.ConeGeometry(0.24, 0.9, 8), this.matResortBrass, [-2.2, 8.6, 1.2], [-Math.PI / 2, 0, 0]);
    ironMesh(new THREE.ConeGeometry(0.2, 0.75, 8), this.matResortBrass, [-2.7, 8.6, 1.2], [-Math.PI / 2, 0, 0]);

    // 航行灯 (左红右绿)
    ironMesh(new THREE.BoxGeometry(0.35, 0.45, 0.35), new THREE.MeshBasicMaterial({ color: 0xef4444 }), [-5.0, 7.8, 1.6]);
    ironMesh(new THREE.BoxGeometry(0.35, 0.45, 0.35), new THREE.MeshBasicMaterial({ color: 0x22c55e }), [5.0, 7.8, 1.6]);

    // ========================================================
    // 5. 大游轮阶段 (Stage 5: Grand Luxury Cruise Ship) - 终极大邮轮・主播下班！
    // ========================================================
    const gMansion = new THREE.Group();
    this.buildingGroup.add(gMansion);
    this.stages.push(gMansion);

    const matYachtWhite = new THREE.MeshStandardMaterial({ color: 0xfcfcfd, roughness: 0.18, metalness: 0.08 });
    const matBootStripeNavy = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.32, metalness: 0.65 });
    const matTeakDecking = new THREE.MeshStandardMaterial({ color: 0xba7643, roughness: 0.65, map: this.texDeckPlank });
    const matFunnelRed = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.35, metalness: 0.2 });
    const matFunnelBlack = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.4, metalness: 0.7 });
    const matCyanWater = new THREE.MeshStandardMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.88, roughness: 0.05, metalness: 0.1 });
    const matGlassTint = new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.82, roughness: 0.1, metalness: 0.25 });

    // 1. 流线型纯白高光主船体 (顶面正好与 Stage 5 甲板高度 5.6 齐平)
    const cruiseHullMain = new THREE.Mesh(new THREE.BoxGeometry(22.0, 3.6, 28.0), matYachtWhite);
    cruiseHullMain.position.set(0, 1.8, 1.0);
    cruiseHullMain.castShadow = true;
    cruiseHullMain.receiveShadow = true;
    gMansion.add(cruiseHullMain);
    this.registerConstructionSlot(cruiseHullMain, '大游轮纯白钢琴烤漆流线主甲板 (Slot 76)');

    // 船体吃水深蓝装饰线 (位于水线下方)
    const waterlineStripe = new THREE.Mesh(new THREE.BoxGeometry(22.2, 0.5, 28.2), matBootStripeNavy);
    waterlineStripe.position.set(0, 0.4, 1.0);
    gMansion.add(waterlineStripe);

    // 2. 船首破浪流线三角甲板 (与主船体顶面齐平)
    const cruiseBowShape = new THREE.Shape();
    cruiseBowShape.moveTo(-11, -15);
    cruiseBowShape.lineTo(0, -22.5);
    cruiseBowShape.lineTo(11, -15);
    cruiseBowShape.closePath();
    const cruiseBow = new THREE.Mesh(
      new THREE.ExtrudeGeometry(cruiseBowShape, { depth: 3.6, bevelEnabled: false }),
      matYachtWhite
    );
    cruiseBow.rotation.x = -Math.PI / 2;
    cruiseBow.position.set(0, 0, 0);
    cruiseBow.castShadow = true;
    gMansion.add(cruiseBow);
    this.registerConstructionSlot(cruiseBow, '大游轮船首破浪流线三角甲板 (Slot 77)');

    // 3. 二层观海阳光漫步甲板
    const cruiseUpperDeck = new THREE.Mesh(new THREE.BoxGeometry(17.5, 0.7, 20.0), matTeakDecking);
    cruiseUpperDeck.position.set(0, 4.2, -0.5);
    gMansion.add(cruiseUpperDeck);
    this.registerConstructionSlot(cruiseUpperDeck, '大游轮二层观海阳光漫步甲板 (Slot 78)');

    // 4. 二层全景落地玻璃宴会大厅与舰桥
    const panoramicGlassHall = new THREE.Mesh(new THREE.BoxGeometry(15.4, 4.4, 15.0), matYachtWhite);
    panoramicGlassHall.position.set(0, 6.1, -1.8);
    panoramicGlassHall.castShadow = true;
    gMansion.add(panoramicGlassHall);
    this.registerConstructionSlot(panoramicGlassHall, '二层全景落地玻璃宴会大厅 (Slot 79)');

    // 环绕落地窗带
    const frontWindowBand = new THREE.Mesh(new THREE.BoxGeometry(14.2, 2.2, 0.2), matGlassTint);
    frontWindowBand.position.set(0, 6.4, 5.75);
    gMansion.add(frontWindowBand);
    [-7.75, 7.75].forEach((wx) => {
      const sideWindow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 13.8), matGlassTint);
      sideWindow.position.set(wx, 6.4, -1.8);
      gMansion.add(sideWindow);
    });

    // 5. 露台遮阳伞与躺椅休闲区
    const parasolGroup = new THREE.Group();
    parasolGroup.position.set(-5.2, 4.2, 6.8);
    const pMast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.8, 8), this.matBowGold);
    pMast.position.y = 1.9;
    const pDome = new THREE.Mesh(new THREE.ConeGeometry(2.6, 0.8, 12), this.matAwningStriped);
    pDome.position.y = 3.7;
    parasolGroup.add(pMast, pDome);
    gMansion.add(parasolGroup);
    this.registerConstructionSlot(parasolGroup, '露台度假条纹遮阳巨伞 (Slot 80)');

    const loungersGroup = new THREE.Group();
    loungersGroup.position.set(-5.2, 4.2, 6.8);
    [-1.1, 1.1].forEach((lx) => {
      const lounger = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 2.6), matYachtWhite);
      lounger.position.set(lx, 0.2, 0.2);
      lounger.rotation.x = -0.22;
      loungersGroup.add(lounger);
    });
    gMansion.add(loungersGroup);
    this.registerConstructionSlot(loungersGroup, '露台日光浴双人躺椅 (Slot 81)');

    // 6. 前甲板无边际天际海景泳池
    const jacuzziPool = new THREE.Group();
    jacuzziPool.position.set(5.2, 4.2, 6.8);
    const poolBasin = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.9, 4.2), matYachtWhite);
    const poolWater = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.2, 3.6), matCyanWater);
    poolWater.position.y = 0.4;
    jacuzziPool.add(poolBasin, poolWater);
    gMansion.add(jacuzziPool);
    this.registerConstructionSlot(jacuzziPool, '前甲板无边际海景泳池 (Slot 82)');

    // 7. 标志性红白双色流线型游轮大烟囱
    const goldTrimGroup = new THREE.Group();
    goldTrimGroup.position.set(0, 9.8, -4.8);
    goldTrimGroup.rotation.x = -0.2;
    const funnelBase = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 2.8, 16), matYachtWhite);
    funnelBase.position.y = 1.4;
    const funnelTop = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 2.2, 16), matFunnelRed);
    funnelTop.position.y = 3.8;
    const funnelCap = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.35, 16), matFunnelBlack);
    funnelCap.position.y = 5.0;
    const flueL = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.8, 10), matFunnelBlack);
    flueL.position.set(-0.55, 5.4, 0);
    const flueR = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.8, 10), matFunnelBlack);
    flueR.position.set(0.55, 5.4, 0);
    goldTrimGroup.add(funnelBase, funnelTop, funnelCap, flueL, flueR);
    gMansion.add(goldTrimGroup);
    this.registerConstructionSlot(goldTrimGroup, '经典红白流线型大游轮主烟囱 (Slot 83)');

    // 8. 顶层全景水蓝色观星穹顶
    const glassDome = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), matGlassTint);
    glassDome.position.set(0, 8.4, 1.2);
    gMansion.add(glassDome);
    this.registerConstructionSlot(glassDome, '顶层全景观星玻璃穹顶 (Slot 84)');

    // 9. 大游轮流线型金色雷达天线塔与卫星球罩
    const spireGroup = new THREE.Group();
    spireGroup.position.set(0, 8.4, -1.8);
    this.spire = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.38, 5.8, 10), this.matGoldTrim);
    this.spire.position.y = 2.9;
    const satGlobe = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 16), matYachtWhite);
    satGlobe.position.y = 2.4;
    spireGroup.add(this.spire, satGlobe);
    gMansion.add(spireGroup);
    this.registerConstructionSlot(spireGroup, '大游轮流线型信号雷达塔 (Slot 85)');

    // 10. 雷达塔顶部深蓝航标水晶
    const crownCrystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.75),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.95 })
    );
    crownCrystal.position.set(0, 14.2, -1.8);
    gMansion.add(crownCrystal);
    this.registerConstructionSlot(crownCrystal, '雷达塔顶部深蓝航标宝石 (Slot 86)');

    // 11. 甲板空中热带花园
    const skyGardenGroup = new THREE.Group();
    skyGardenGroup.position.set(0, 4.6, 9.5);
    [-6.5, 6.5].forEach((gx) => {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.8, 8), this.matAptWall);
      const plant = new THREE.Mesh(
        new THREE.SphereGeometry(0.85, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 })
      );
      plant.position.y = 0.9;
      const potted = new THREE.Group();
      potted.position.x = gx;
      potted.add(pot, plant);
      skyGardenGroup.add(potted);
    });
    gMansion.add(skyGardenGroup);
    this.registerConstructionSlot(skyGardenGroup, '甲板空中热带花园 (Slot 87)');

    // 12. 宴会大厅璀璨水晶吊灯暖光
    const chandelier = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfef08a })
    );
    chandelier.position.set(0, 7.5, -1.8);
    gMansion.add(chandelier);
    this.registerConstructionSlot(chandelier, '宴会大厅璀璨水晶吊灯暖光 (Slot 88)');

    // 13. 大游轮全景外圈 VIP 玻璃护栏
    const vipBalustrade = new THREE.Mesh(new THREE.BoxGeometry(17.6, 1.2, 0.1), matGlassTint);
    vipBalustrade.position.set(0, 5.0, 8.8);
    gMansion.add(vipBalustrade);
    this.registerConstructionSlot(vipBalustrade, '大游轮全景外圈 VIP 玻璃护栏 (Slot 89)');

    this.infiniteTowerGroup = new THREE.Group();
    gMansion.add(this.infiniteTowerGroup);

    this.buildingSpringScale = 1.0;
    this.buildingSpringVelocity = 0.0;
  }

  // 阳台紫发美女室友 (低多边形角色：脸部、长发、裙装与看书姿态)
  initBalconyAlly(parentGroup) {
    this.allyGroup = new THREE.Group();
    this.allyGroup.position.set(-2.5, 7.2, 5.2);
    // 木筏本身会绕 Y 轴旋转，补偿后让美女面向等轴镜头而不是只露侧脸。
    this.allyBaseRotationY = 1.25;
    this.allyGroup.rotation.y = this.allyBaseRotationY;

    const allySkinMat = new THREE.MeshStandardMaterial({ color: 0xf6c7a8, roughness: 0.48 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x6d28d9, roughness: 0.46 });
    const hairHighlightMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.38 });
    const dressMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.58 });
    const dressTrimMat = new THREE.MeshStandardMaterial({ color: 0xf0abfc, roughness: 0.48 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x30204f, roughness: 0.65 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x24113f, roughness: 0.3 });
    const eyeLightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lipMat = new THREE.MeshStandardMaterial({ color: 0xc24173, roughness: 0.35 });
    const bookCoverMat = new THREE.MeshStandardMaterial({ color: 0x8b5e34, roughness: 0.72 });
    const bookPageMat = new THREE.MeshStandardMaterial({ color: 0xfff1c7, roughness: 0.88 });

    const allyMesh = (geometry, material, position, rotation = null, scale = null) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(position[0], position[1], position[2]);
      if (rotation) mesh.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
      if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.allyGroup.add(mesh);
      return mesh;
    };

    // 修长裙装身形：上身、腰带、蓬裙与鞋子分层，避免再变成单一紫色圆柱。
    allyMesh(new THREE.CylinderGeometry(0.42, 0.58, 1.18, 12), dressMat, [0, 1.95, 0]);
    allyMesh(new THREE.CylinderGeometry(0.52, 1.02, 1.55, 12), dressMat, [0, 0.92, 0]);
    allyMesh(new THREE.TorusGeometry(0.53, 0.075, 8, 16), dressTrimMat, [0, 1.62, 0]);
    allyMesh(new THREE.BoxGeometry(0.38, 0.32, 0.78), shoeMat, [-0.3, 0.12, 0.18], [0, 0, 0.08]);
    allyMesh(new THREE.BoxGeometry(0.38, 0.32, 0.78), shoeMat, [0.3, 0.12, 0.18], [0, 0, -0.08]);

    // 肩膀、手臂与手掌，双手自然托住前方书本。
    allyMesh(new THREE.SphereGeometry(0.42, 10, 8), dressMat, [-0.46, 2.32, 0]);
    allyMesh(new THREE.SphereGeometry(0.42, 10, 8), dressMat, [0.46, 2.32, 0]);
    allyMesh(new THREE.CylinderGeometry(0.13, 0.16, 0.95, 10), allySkinMat, [-0.62, 2.08, 0.28], [0, 0, -0.62]);
    allyMesh(new THREE.CylinderGeometry(0.13, 0.16, 0.95, 10), allySkinMat, [0.62, 2.08, 0.28], [0, 0, 0.62]);
    allyMesh(new THREE.SphereGeometry(0.16, 10, 8), allySkinMat, [-0.9, 1.72, 0.53]);
    allyMesh(new THREE.SphereGeometry(0.16, 10, 8), allySkinMat, [0.9, 1.72, 0.53]);

    // 脸部与五官朝向露台外侧（+Z），从游戏镜头能辨认是美女而不是紫色方块。
    allyMesh(new THREE.CylinderGeometry(0.17, 0.2, 0.42, 10), allySkinMat, [0, 2.82, 0]);
    allyMesh(new THREE.SphereGeometry(0.72, 16, 12), allySkinMat, [0, 3.42, 0]);
    allyMesh(new THREE.SphereGeometry(0.78, 16, 12), hairMat, [0, 3.5, -0.34], null, [1.05, 1.16, 0.84]);
    allyMesh(new THREE.SphereGeometry(0.44, 12, 10), hairHighlightMat, [-0.52, 3.9, 0.02], null, [0.72, 1.18, 0.45]);
    allyMesh(new THREE.SphereGeometry(0.54, 12, 10), hairMat, [-0.78, 3.22, -0.22], null, [0.62, 1.45, 0.62]);
    allyMesh(new THREE.SphereGeometry(0.54, 12, 10), hairMat, [0.78, 3.22, -0.22], null, [0.62, 1.45, 0.62]);
    allyMesh(new THREE.SphereGeometry(0.14, 10, 8), eyeMat, [-0.25, 3.5, 0.64]);
    allyMesh(new THREE.SphereGeometry(0.14, 10, 8), eyeMat, [0.25, 3.5, 0.64]);
    allyMesh(new THREE.SphereGeometry(0.045, 8, 6), eyeLightMat, [-0.21, 3.54, 0.75]);
    allyMesh(new THREE.SphereGeometry(0.045, 8, 6), eyeLightMat, [0.29, 3.54, 0.75]);
    allyMesh(new THREE.SphereGeometry(0.08, 8, 6), lipMat, [0, 3.18, 0.68], null, [1.35, 0.5, 0.45]);

    // 手中翻开的书本：棕色封面加米白书页，让「看书室友」的动作一眼可读。
    allyMesh(new THREE.BoxGeometry(1.2, 0.12, 0.82), bookCoverMat, [0, 1.84, 0.62], [Math.PI / 8, 0, 0]);
    allyMesh(new THREE.BoxGeometry(0.98, 0.08, 0.68), bookPageMat, [0, 1.94, 0.62], [Math.PI / 8, 0, 0]);

    parentGroup.add(this.allyGroup);
  }

  // 6. 3D 海水过滤器机器 (完整放在右前甲板内，与船舷、房屋留出间距)
  initSeawaterFilter() {
    this.filterGroup = new THREE.Group();
    const { x, y, z } = this.engine.deckLayout.filter;
    this.filterGroup.position.set(x, y, z);
    this.filterGroup.scale.setScalar(0.8);
    this.filterGroup.visible = false;
    this.raftGroup.add(this.filterGroup);

    // 支架底座
    const legMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7 });
    [-1.8, 1.8].forEach((lx) => {
      [-1.4, 1.4].forEach((lz) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.6, 6), legMat);
        leg.position.set(lx, 1.3, lz);
        this.filterGroup.add(leg);
      });
    });

    // 水槽与蒸馏罩
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.6, roughness: 0.3 });
    const tank = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.6, 3.4), tankMat);
    tank.position.y = 2.6;
    tank.castShadow = true;
    this.filterGroup.add(tank);

    // 旋转光环 (Lv.4)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    this.filterRings = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.25, 8, 20), ringMat);
    this.filterRings.position.y = 3.6;
    this.filterRings.visible = false;
    this.filterGroup.add(this.filterRings);
  }

  // 6.5 3D 木材安装点提示系统 (主播控制角色找地方敲钉安装木头，彻底告别搞笑丢木头)
  initConstructionTargets() {
    this.installNodes = [
      { id: 0, pos: new THREE.Vector3(-6.2, 1.85, 7.5), angle: -0.35, name: '加固左前防浪原木' },
      { id: 1, pos: new THREE.Vector3(6.2, 1.85, 7.5), angle: 0.35, name: '加固右前防浪原木' },
      { id: 2, pos: new THREE.Vector3(0.0, 1.85, 3.8), angle: 0, name: '修补中央厚实木板' },
      { id: 3, pos: new THREE.Vector3(-6.2, 1.85, -7.5), angle: -2.8, name: '安装左后加固梁' },
      { id: 4, pos: new THREE.Vector3(6.2, 1.85, -7.5), angle: 2.8, name: '安装右后加固梁' },
      { id: 5, pos: new THREE.Vector3(0.0, 1.85, 8.8), angle: 0, name: '扩建前沿登船板' },
    ];
    this.activeNodeIndex = 0;

    // 建立 3D 安装点视觉提示容器 (钓鱼建造模式下隐藏，木筏呈现纯净写实与木材堆垛)
    this.installPromptGroup = new THREE.Group();
    this.installPromptGroup.visible = false;
    this.raftGroup.add(this.installPromptGroup);

    // (A) 全息待安装木板虚影 (Ghost Blueprint Plank)
    const ghostGeom = new THREE.BoxGeometry(7.0, 0.72, 1.9);
    this.ghostMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.68,
      roughness: 0.3,
    });
    this.ghostPlank = new THREE.Mesh(ghostGeom, this.ghostMat);
    this.installPromptGroup.add(this.ghostPlank);

    // 全息木板边框高亮线
    const ghostEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(ghostGeom),
      new THREE.LineBasicMaterial({ color: 0xbae6fd, linewidth: 2 })
    );
    this.ghostPlank.add(ghostEdges);

    // (B) 地面旋转导引光环
    const ringGeom = new THREE.RingGeometry(1.6, 2.0, 24);
    ringGeom.rotateX(-Math.PI / 2);
    this.targetRingMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    this.targetRing = new THREE.Mesh(ringGeom, this.targetRingMat);
    this.targetRing.position.y = 0.05;
    this.installPromptGroup.add(this.targetRing);

    // (C) 上方 3D 悬浮指引标记 (向下立体箭头 + 小铁锤图标)
    this.floatingArrowGroup = new THREE.Group();
    this.floatingArrowGroup.position.y = 3.6;
    this.installPromptGroup.add(this.floatingArrowGroup);

    // 倒三角立体箭头
    const arrowGeom = new THREE.ConeGeometry(0.85, 1.3, 8);
    arrowGeom.rotateX(Math.PI);
    this.floatingArrowMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xd97706,
      emissiveIntensity: 0.85,
      roughness: 0.2,
    });
    this.floatingArrow = new THREE.Mesh(arrowGeom, this.floatingArrowMat);
    this.floatingArrowGroup.add(this.floatingArrow);

    // 悬浮铁锤图标
    const miniHammer = new THREE.Group();
    miniHammer.position.y = 1.2;
    const mHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 8), new THREE.MeshBasicMaterial({ color: 0x78350f }));
    const mHead = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.8), new THREE.MeshBasicMaterial({ color: 0xe2e8f0 }));
    mHead.position.y = 0.5;
    miniHammer.add(mHandle, mHead);
    miniHammer.rotation.z = Math.PI / 4;
    this.floatingArrowGroup.add(miniHammer);
  }

  // 7. 特效物件池 (抛物线飞木、碎片翻滚、水花浪圈、核弹蘑菇云)
  initFxPools() {
    this.flyingWoods = [];
    this.debrisPool = [];
    this.waterRings = [];
    this.projectiles = [];
    this.particles = [];

    this.woodPlankGeom = new THREE.BoxGeometry(1.2, 0.6, 4.2);
    this.woodPlankMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7 });

    this.stoneGeom = new THREE.DodecahedronGeometry(2.0);
    this.stoneMat = new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.9, flatShading: true });

    this.bombGeom = new THREE.SphereGeometry(2.4, 12, 12);
    this.bombMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4 });

    this.nukeGeom = new THREE.CylinderGeometry(3.0, 3.0, 12.0, 14);
    this.nukeMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.8, roughness: 0.2 });
  }

  bindEngineCallbacks() {
    this.engine.onGiftEffect = (...args) => this.giftFx.gift(...args);
    this.engine.onBuildWoodEffect = ({ fromFilter, count, upgraded, isCrit }) => {
      if (fromFilter) this.filterGroup.visible = true;
      this.triggerFishingCatchEffect(fromFilter, count, isCrit);
      this.buildingSpringVelocity = isCrit ? 0.32 : 0.22;
      if (upgraded) {
        this.spawnConstructionDust(new THREE.Vector3(0, 15, -4), 25);
      }
    };

    this.engine.onMissEffect = (count = 1) => {
      this.triggerFishingMissEffect(count);
    };

    this.engine.onDismantleEffect = ({ count, severe, nuke }) => {
      this.spawnDismantleDebris(count, severe, nuke);
      this.removeLogsFromStack(count);
      this.updateConstructionState();
      this.screenShake = Math.min(35, this.screenShake + (nuke ? 30 : severe ? 16 : 8));
      this.buildingSpringVelocity = -0.25;
    };

    this.engine.onSpawnStoneEffect = (count) => {
      for (let i = 0; i < Math.min(4, count); i++) {
        this.spawnProjectile('stone');
      }
    };

    this.engine.onSpawnBombEffect = (sizeType, count) => {
      for (let i = 0; i < Math.min(4, count); i++) {
        this.spawnProjectile(sizeType === 'big' ? 'bomb-big' : 'bomb-small');
      }
    };

    this.engine.onNukeEffect = () => {
      this.resetExpansionAnimations();
      // 清除旧木材航班，避免它们在清零后抵达并再次显示已拆除的部件。
      for (const item of this.flyingWoods) {
        this.scene.remove(item.mesh);
        item.mesh.traverse((part) => part.geometry?.dispose());
      }
      this.flyingWoods.length = 0;
      this.clearWoodStack();
      this.updateConstructionState();
      this.spawnNukeBlast3D();
    };

    // 木筏升级「堆叠物件一个个扩建」弹簧动画回调
    this.engine.onStageUpgrade = (newStage, oldStage) => {
      this.giftFx.upgrade();
      this.updateConstructionState();
      this.triggerStaggeredUpgrade(newStage);
    };
  }

  // 木筏升级「堆叠物件一个个扩建」的动画
  triggerStaggeredUpgrade(newStage) {
    const stageGroup = this.stages[newStage];
    if (!stageGroup) return;

    this.resetExpansionAnimations(newStage);
    stageGroup.visible = true;
    let delay = 0;
    for (const part of this.stageLayouts[newStage]) {
      const { mesh, position, scale } = part;
      mesh.position.copy(position);
      mesh.position.y += 8;
      mesh.scale.copy(scale).multiplyScalar(0.1);
      mesh.userData.expanding = true;
      this.expansionQueue.push({
        mesh,
        stage: newStage,
        targetPosition: position,
        targetY: position.y,
        currentY: position.y + 8,
        targetScale: scale,
        vy: 0,
        scale: 0.1,
        delayMs: Math.min(delay, 900),
      });
      delay += 55;
    }
  }

  resetExpansionAnimations(stage = null) {
    this.expansionQueue = this.expansionQueue.filter((item) => {
      if (stage !== null && item.stage !== stage) return true;
      item.mesh.position.copy(item.targetPosition);
      item.mesh.scale.copy(item.targetScale);
      item.mesh.userData.expanding = false;
      return false;
    });
  }

  // 触发钓鱼扬竿收线与木材从海面飞入有规则搭建至木筏结构上 (依序实体搭建扩展)
  triggerFishingCatchEffect(fromFilter = false, count = 1, isCrit = false) {
    // 1. 角色立即执行正手双手向上后倾扬竿收线动作
    this.engine.workerState = 'fishing';
    this.engine.workerTimer = 26;

    // 2. 浮标受力向下扎入水中并激荡起雪白水花
    this.bobberYankTimer = 18;
    this.spawnWaterRing(this.fishingBobberPos.x, this.fishingBobberPos.z);

    // 3. 建筑与木筏受力产生爽快的弹簧缩放反馈
    this.buildingSpringVelocity = isCrit ? 0.32 : 0.22;

    // 4. 原木从海面浮标处破浪高高跃起，沿抛物线精确飞向木筏下一个规则搭建槽位！
    const loopCount = Math.min(24, Math.max(1, count));
    for (let c = 0; c < loopCount; c++) {
      if (this.flyingWoods.length >= 24) {
        const old = this.flyingWoods.shift(); this.scene.remove(old.mesh);
        old.mesh.traverse((part) => part.geometry?.dispose());
      }
      const startPos = new THREE.Vector3(
        this.fishingBobberPos.x + (Math.random() - 0.5) * 1.2,
        0.2,
        this.fishingBobberPos.z + (Math.random() - 0.5) * 1.2
      );

      // 目标规则建筑槽位：当前正在搭建的木筏部件
      const curWoodCount = this.engine ? this.engine.wood : 1;
      const slotIndex = Math.min(Math.max(0, curWoodCount - loopCount + c), Math.max(0, this.constructionSlots.length - 1));
      const targetSlot = this.constructionSlots[slotIndex];

      const targetPos = new THREE.Vector3();
      if (targetSlot && targetSlot.mesh) {
        targetSlot.mesh.updateMatrixWorld(true);
        targetSlot.mesh.getWorldPosition(targetPos);
        if (targetPos.y < 1.0) targetPos.y = 1.85;
      } else {
        targetPos.set(0, 2.5, 0);
      }

      // 生成飞行的实体 3D 原木 (100% 满足 flyingWoods 测试检查)
      const flyGeom = new THREE.CylinderGeometry(0.36, 0.36, 4.2, 12);
      flyGeom.rotateX(Math.PI / 2);
      const flyMesh = new THREE.Mesh(flyGeom, isCrit ? this.matPlankDeck : this.matLogBark);
      const fCapFront = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12), this.matLogCap);
      fCapFront.position.set(0, 0, 2.11);
      const fCapBack = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12), this.matLogCap);
      fCapBack.position.set(0, 0, -2.11);
      fCapBack.rotation.y = Math.PI;
      flyMesh.add(fCapFront, fCapBack);
      flyMesh.position.copy(startPos);
      this.scene.add(flyMesh);

      const delay = c * 60;
      this.flyingWoods.push({
        mesh: flyMesh,
        startPos,
        targetPos,
        slotIndex,
        targetSlot,
        progress: 0,
        speed: 0.045,
        delay,
        isCrit,
        isSpark: false,
        done: false,
      });

      // 伴随破水水花微粒
      this.spawnConstructionDust(startPos, 6);
    }
  }

  // 钓鱼脱钩 Miss 特效：水花飞溅，木材掉落海中，规则结构件相应脱落坠海
  triggerFishingMissEffect(count = 1) {
    this.bobberYankTimer = 10;
    this.spawnWaterRing(this.fishingBobberPos.x, this.fishingBobberPos.z);
    this.spawnConstructionDust(this.fishingBobberPos, 6);

    // 规则结构件脱落坠海
    if (count > 0 && this.constructionSlots.length > 0) {
      this.updateConstructionState();
      this.spawnDismantleDebris(Math.min(6, count * 3), false, false);
    }
    if (count > 0 && this.stackedLogs && this.stackedLogs.length > 0) {
      this.removeLogsFromStack(count);
    }
  }

  // 相容介面
  triggerInstallWoodEffect(fromFilter = false, count = 1) {
    this.triggerFishingCatchEffect(fromFilter, count, false);
  }

  spawnFlyingWood(fromFilter, delayMs = 0) {
    this.triggerFishingCatchEffect(fromFilter, 1, false);
  }

  spawnDismantleDebris(count = 8, severe = false, isNuke = false) {
    const n = Math.min(45, count);
    for (let i = 0; i < n; i++) {
      if (this.debrisPool.length >= 60) {
        const old = this.debrisPool.shift();
        this.scene.remove(old.mesh); old.mesh.geometry.dispose();
      }
      const g = Math.random() > 0.4
        ? new THREE.BoxGeometry(1.6 + Math.random() * 1.5, 0.8, 2.5 + Math.random() * 2)
        : new THREE.CylinderGeometry(1.2, 1.2, 2.8, 8);
      const m = Math.random() > 0.5 ? this.matPlankDeck : this.matRustyMetal;
      const mesh = new THREE.Mesh(g, m);

      mesh.position.set(
        (Math.random() - 0.5) * 16,
        6 + Math.random() * (severe ? 18 : 8),
        -4.0 + (Math.random() - 0.5) * 12
      );
      this.scene.add(mesh);

      const speedMult = isNuke ? 3.0 : severe ? 2.0 : 1.2;
      this.debrisPool.push({
        mesh,
        vx: (Math.random() - 0.5) * 1.8 * speedMult,
        vy: (1.2 + Math.random() * 2.2) * speedMult,
        vz: (Math.random() - 0.5) * 1.8 * speedMult,
        rx: (Math.random() - 0.5) * 0.3,
        ry: (Math.random() - 0.5) * 0.3,
        rz: (Math.random() - 0.5) * 0.3,
      });
    }
  }

  spawnWaterRing(x, z) {
    if (this.waterRings.length >= 40) {
      const old = this.waterRings.shift();
      this.scene.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose();
    }
    const geom = new THREE.RingGeometry(0.8, 1.6, 20);
    geom.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geom, mat);
    ring.position.set(x, 0.15, z);
    this.scene.add(ring);
    this.waterRings.push({ mesh: ring, scale: 1.0, opacity: 0.85 });
  }

  spawnConstructionDust(pos, count = 15) {
    this.giftFx.burst(pos, 0xffdc91, Math.min(25, count), 5, .6, .75, 3);
  }

  spawnProjectile(type) {
    if (this.projectiles.length >= 8) this.scene.remove(this.projectiles.shift().mesh);
    let mesh;
    if (type === 'stone') {
      mesh = new THREE.Mesh(this.stoneGeom, this.stoneMat);
    } else if (type === 'bomb-big') {
      mesh = this.giftFx.makeBomb(true);
    } else {
      mesh = this.giftFx.makeBomb(false);
    }

    const startPos = new THREE.Vector3(
      35 + (Math.random() - 0.5) * 10,
      45 + Math.random() * 10,
      35 + (Math.random() - 0.5) * 10
    );
    const targetPos = new THREE.Vector3(
      (Math.random() - 0.5) * 14,
      this.engine.deckLayout.worker.y + 1,
      6.0 + Math.random() * 3
    );

    mesh.position.copy(startPos);
    mesh.castShadow = true;
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      startPos,
      targetPos,
      progress: 0,
      speed: type === 'bomb-big' ? 0.026 : 0.035,
      type,
    });
  }

  spawnNukeBlast3D() {
    this.giftFx.nuke();
  }


  setTheme(theme) {
    if (theme === 'sunset') {
      this.scene.background = new THREE.Color(0x270b02);
      this.scene.fog.color.setHex(0x270b02);
      this.oceanMaterial.color.setHex(0x9a3412);
      this.sunLight.color.setHex(0xfb923c);
    } else if (theme === 'cyber') {
      this.scene.background = new THREE.Color(0x0d0617);
      this.scene.fog.color.setHex(0x0d0617);
      this.oceanMaterial.color.setHex(0x4c1d95);
      this.sunLight.color.setHex(0xc084fc);
    } else {
      this.scene.background = new THREE.Color(0x38bdf8);
      this.scene.fog.color.setHex(0x38bdf8);
      this.oceanMaterial.color.setHex(0x06b6d4);
      this.sunLight.color.setHex(0xfffaed);
    }
  }

  // 主更新每帧更新循环
  update(dt = 1 / 60) {
    this.time += 0.02;
    const t = this.time;

    // 1. 动态物理大洋波浪与动态浪尖白沫顶点著色
    const posAttr = this.oceanMesh.geometry.attributes.position;
    const colorAttr = this.oceanMesh.geometry.attributes.color;
    const arr = posAttr.array;
    const cArr = colorAttr.array;

    for (let i = 0; i < arr.length; i += 3) {
      const origX = this.oceanVertices[i];
      const origZ = this.oceanVertices[i + 2];
      const h = this.getWaveHeight(origX, origZ, t);
      arr[i + 1] = h;

      // 依据距离计算大洋通透度 (近处绿松石透光，远处深邃海军蓝)
      const distToRaft = Math.hypot(origX, origZ);
      const distFactor = Math.min(1.0, distToRaft / 120);

      // 基底水色：近处绿松石青碧 (0.05, 0.76, 0.82) -> 远处深海蔚蓝 (0.02, 0.42, 0.68)
      const baseR = 0.05 * (1.0 - distFactor) + 0.02 * distFactor;
      const baseG = 0.76 * (1.0 - distFactor) + 0.42 * distFactor;
      const baseB = 0.82 * (1.0 - distFactor) + 0.68 * distFactor;

      if (h > 0.42) {
        // 浪尖涌起雪白海沫 (Whitecaps Foam)
        const foamFactor = Math.min(1.0, (h - 0.42) / 0.65);
        cArr[i] = baseR + (0.98 - baseR) * foamFactor;
        cArr[i + 1] = baseG + (0.99 - baseG) * foamFactor;
        cArr[i + 2] = baseB + (1.0 - baseB) * foamFactor;
      } else if (h < -0.25) {
        // 波谷深邃渐层
        const deepFactor = Math.min(1.0, (-0.25 - h) / 0.65);
        cArr[i] = baseR * (1.0 - deepFactor * 0.45);
        cArr[i + 1] = baseG * (1.0 - deepFactor * 0.4);
        cArr[i + 2] = baseB * (1.0 - deepFactor * 0.25);
      } else {
        cArr[i] = baseR;
        cArr[i + 1] = baseG;
        cArr[i + 2] = baseB;
      }
    }
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    this.oceanMesh.geometry.computeVertexNormals();

    // 法线微波与水底太阳焦散随海风微流动
    if (this.texWaterNormal) {
      this.texWaterNormal.offset.x += 0.0006;
      this.texWaterNormal.offset.y += 0.001;
    }
    if (this.texCaustics) {
      this.texCaustics.offset.x += 0.0003;
      this.texCaustics.offset.y += 0.0004;
    }

    // 2. 木筏物理浮力颠簸与倾斜 (随海浪晃动，保持 3/4 等轴倾角)
    const raftWave = this.getWaveHeight(0, 0, t);
    this.raftGroup.position.y = raftWave * 0.9;
    this.raftGroup.rotation.x = Math.sin(t * 1.4) * 0.035;
    this.raftGroup.rotation.y = (this.raftBaseRotationY || -0.62) + Math.sin(t * 0.8) * 0.012;
    this.raftGroup.rotation.z = Math.cos(t * 1.2) * 0.035;

    // 3. 木筏周围自然水花微动呼吸
    if (this.contactFoamMesh) {
      this.contactFoamMesh.position.y = 0.15 + raftWave * 0.1;
      this.contactFoamMesh.scale.setScalar(1.0 + Math.sin(t * 2.0) * 0.03);
    }

    // 4. 漂流物资随波摇晃
    if (this.driftingCrates) {
      this.driftingCrates.forEach((c) => {
        c.group.position.y = this.getWaveHeight(c.baseX, c.baseZ, t) + 0.2;
        c.group.rotation.x = Math.sin(t * 1.5 + c.seed) * 0.08;
        c.group.rotation.z = Math.cos(t * 1.3 + c.seed) * 0.08;
      });
    }

    // 5. 海面浮标与钓线动态 (浮标随海浪波高起伏，钓线连通竿尖)
    if (this.fishingBobberGroup && this.fishingLine && this.rodTipMarker) {
      const bobWave = this.getWaveHeight(this.fishingBobberPos.x, this.fishingBobberPos.z, t);
      const yankOffset = this.bobberYankTimer > 0 ? 0.65 : 0;
      if (this.bobberYankTimer > 0) this.bobberYankTimer--;

      this.fishingBobberGroup.position.set(
        this.fishingBobberPos.x,
        0.2 + bobWave - yankOffset,
        this.fishingBobberPos.z
      );
      this.fishingBobberGroup.rotation.z = Math.sin(t * 3) * 0.12;

      this.rodTipMarker.getWorldPosition(this._tipWorldPos);
      this.fishingBobberGroup.getWorldPosition(this._bobberWorldPos);

      const lineAttr = this.fishingLine.geometry.attributes.position;
      lineAttr.setXYZ(0, this._tipWorldPos.x, this._tipWorldPos.y, this._tipWorldPos.z);
      lineAttr.setXYZ(1, this._bobberWorldPos.x, this._bobberWorldPos.y + 0.45, this._bobberWorldPos.z);
      lineAttr.needsUpdate = true;
    }

    // 5.1 主角海钓冒险家姿态与扬竿更新
    this.updateWorkerCharacter(t);

    // 5.5 木材安装点提示系统 (呼吸全息蓝图、导引光圈、悬浮箭头铁锤)
    this.updateConstructionTargets(t);

    // 6. 二楼助手微动
    if (this.allyGroup) {
      this.allyGroup.rotation.y = (this.allyBaseRotationY || 0) + Math.sin(t * 0.8) * 0.1;
    }

    // 7. 风车旋转 (只旋转叶片枢纽，立柱与机舱保持静止稳固)
    if (this.turbineBlades && this.turbineBlades.length > 0) {
      this.turbineBlades.forEach((b) => {
        b.rotation.z += 0.04;
      });
    }

    // 8. 建筑外观阶段显隐与弹簧缩放
    this.updateBuildingStages();

    // 9. 扩建逐件队列动画 (Staggered Expansion)
    this.updateExpansionQueue();

    // 10. 飞行木条、碎片落海、水圈、投掷物
    this.updateFx();
    this.giftFx.update(dt);

    // 11. 动态相机平滑后拉 (随木筏扩建与阶段升级后拉抬升视野，营造慢慢扩展的感觉)
    const targetCam = this.getTargetCameraConfig();
    this.currentCamPos.lerp(targetCam.pos, 0.038);
    this.currentLookAt.lerp(targetCam.lookAt, 0.038);

    this.camera.position.copy(this.currentCamPos);
    if (this.screenShake > 0) {
      // 爆炸以闪光、碎片和水花呈现；不再随机位移相机，避免角色看起来狂抖或骨架坏掉。
      this.screenShake *= 0.72;
      if (this.screenShake < 0.1) this.screenShake = 0;
    }
    if (this.engine.workerState === 'dizzy' || this.engine.workerState === 'charred') {
      this.screenShake = 0;
    }
    this.camera.lookAt(this.currentLookAt);

    this.renderer.render(this.scene, this.camera);
  }

  // 主播角色移动、面向与骨骼姿态更新 (主角居中正手握持钓竿面向大海)
  updateWorkerCharacter(t) {
    const curX = this.workerGroup.position.x;
    const curZ = this.workerGroup.position.z;
    const tarX = this.engine.workerTargetPos.x;
    const tarZ = this.engine.workerTargetPos.z;

    const dx = tarX - curX;
    const dz = tarZ - curZ;
    const dist = Math.hypot(dx, dz);

    const isMoving = dist > 0.15 && !this.engine.weedActive && this.engine.workerState !== 'charred' && this.engine.workerDizzyTimer <= 0;

    if (isMoving) {
      // 平滑移动
      const speed = 0.22;
      this.workerGroup.position.x += (dx / dist) * Math.min(dist, speed);
      this.workerGroup.position.z += (dz / dist) * Math.min(dist, speed);
      this.engine.workerPos.x = this.workerGroup.position.x;
      this.engine.workerPos.z = this.workerGroup.position.z;

      // 旋转转向移动方向
      const targetAngle = Math.atan2(dx, dz);
      let angleDiff = targetAngle - this.workerGroup.rotation.y;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      this.workerGroup.rotation.y += angleDiff * 0.25;

      // 行走骨骼动态 (手脚交替摆动，身体起伏)
      const walkCycle = Math.sin(t * 12);
      this.legL.rotation.x = walkCycle * 0.55;
      this.legR.rotation.x = -walkCycle * 0.55;
      this.armL.rotation.x = -walkCycle * 0.45;
      this.armR.rotation.x = walkCycle * 0.45;
      this.workerTorso.position.y = 3.6 + Math.abs(Math.sin(t * 12)) * 0.18;
    } else {
      // 站立待机姿态：保持目前位置，避免受击后到达目标点又被重设回中心，造成来回抖动。
      this.workerGroup.rotation.y = 0; // 正对世界海面浮标方向

      this.legL.rotation.x *= 0.8;
      this.legR.rotation.x *= 0.8;
      this.workerTorso.position.y = 3.6 + Math.sin(t * 3) * 0.04;

      if (this.engine.workerState === 'charred' || this.engine.workerState === 'dizzy') {
        // 爆炸后只显示稳定的受击／黑炭姿势；不把随机震屏写进角色骨架，避免姿势越抖越歪。
        this.workerGroup.rotation.set(0, 0, 0);
        this.workerTorso.position.y = 3.6;
        this.workerTorso.rotation.set(0, 0, 0);
        this.armR.rotation.set(-0.78, 0.15, -0.42);
        this.armL.rotation.set(-0.85, -0.15, 0.42);
        this.fishingRodGroup.rotation.set(0.873, 0, 0);
      } else if (this.engine.workerState === 'fishing') {
        // 钓鱼收线扬竿动作：正手双臂与钓竿猛力向上后倾提竿！身体微后仰
        const pullPhase = Math.sin(this.engine.workerTimer * 0.28);
        const pull = Math.max(0, pullPhase);
        this.armR.rotation.x = -0.78 + pull * 0.45;
        this.armL.rotation.x = -0.85 + pull * 0.45;
        this.fishingRodGroup.rotation.x = 0.873 - pull * 0.35;
        this.workerTorso.rotation.x = -pull * 0.12; // 身体微后仰发力提竿
      } else if (this.engine.workerState === 'cheering') {
        // 胜利跳跃欢呼
        this.armL.rotation.z = Math.PI * 0.75;
        this.armR.rotation.z = -Math.PI * 0.75;
        this.workerTorso.position.y = 3.6 + Math.abs(Math.sin(t * 8)) * 1.2;
      } else {
        // 专注双手正手持竿待机：两臂与钓竿随呼吸微幅起伏
        const breath = Math.sin(t * 2.2) * 0.025;
        this.armR.rotation.set(-0.78 + breath, 0.15, -0.42);
        this.armL.rotation.set(-0.85 + breath, -0.15, 0.42);
        this.fishingRodGroup.rotation.set(0.873 + breath, 0, 0);
        this.workerTorso.rotation.x = 0;
      }
    }

    // 眩晕星星旋转
    if (this.engine.workerDizzyTimer > 0) {
      this.engine.workerDizzyTimer--;
      this.dizzyStarsGroup.visible = true;
      this.dizzyStarsGroup.rotation.y += 0.12;
      if (this.engine.workerDizzyTimer <= 0) {
        this.dizzyStarsGroup.visible = false;
        if (this.engine.workerState === 'dizzy') this.engine.workerState = 'idle';
      }
    } else {
      this.dizzyStarsGroup.visible = false;
    }

    // 海草缠绕与黑炭状态
    this.weedWrapMesh.visible = this.engine.weedActive;
    const isCharred = this.engine.workerState === 'charred';
    if (this.matSkin) {
      this.matSkin.color.setHex(isCharred ? 0x18181b : 0xc88e60);
    }
    if (this.matVest) {
      this.matVest.color.setHex(isCharred ? 0x27272a : 0x585d46);
    }
    if (this.workerTorso) {
      this.workerTorso.traverse((child) => {
        if (child.isMesh && child !== this.weedWrapMesh) {
          if (isCharred) {
            child.material = this.matCharred;
          } else if (child.userData.baseMaterial) {
            child.material = child.userData.baseMaterial;
          }
        }
      });
    }
  }

  updateDeckLayout() {
    const layout = this.engine.deckLayout;
    // 只在甲板布局改变时重新就位，待机帧不重设 X/Z，保留受击后的稳定位置。
    if (layout === this.currentDeckLayout) return;
    this.currentDeckLayout = layout;
    this.engine.resetWorkerPosition();
    const { x, y, z } = layout.worker;
    this.workerGroup.position.set(x, y, z);
    this.filterGroup.position.set(layout.filter.x, layout.filter.y, layout.filter.z);
  }

  updateBuildingStages() {
    const curStage = this.engine ? this.engine.stage : 0;
    this.updateDeckLayout();
    if (curStage < this.lastBuildingStage) this.resetExpansionAnimations();
    this.lastBuildingStage = curStage;

    // 6 种等级外观显隐协调控制 (彻底解决穿模与违建感)
    // 等级 0: 木筏 (Raft) - 基础原木浮动平台始终保持，专属求生道具仅在 Stage 0 显示
    if (this.stages[0]) this.stages[0].visible = true;
    if (this.stage0Props) this.stage0Props.visible = curStage === 0;

    // 等级 1: 木船 (Wooden Boat) - 只在木船与大木船阶段显示，升级后由新结构完整替换。
    if (this.stages[1]) this.stages[1].visible = curStage >= 1 && curStage <= 2;
    if (this.sailAwning) this.sailAwning.visible = curStage === 1;
    if (this.boatMast) this.boatMast.visible = curStage === 1;

    // 等级 2: 大木船 (Large Wooden Boat, 独立空间) - 宽敞原木内房舱室 (等级 2 独占)
    if (this.stages[2]) this.stages[2].visible = curStage === 2;

    // 等级 3: 铁皮船 (Iron Plated Ship, 钢铁外观、独立船长室) - 阶段替换制，避免铁皮船零件穿进 Stage 4 房屋。
    if (this.stages[3]) this.stages[3].visible = curStage === 3;
    if (this.legacyIronGroup) this.legacyIronGroup.visible = false;

    // 等级 4: 多层海景屋 (Multi-tier Sea Villa, 美女室友) - 单一完整房体。
    if (this.stages[4]) this.stages[4].visible = curStage === 4;
    if (this.legacyStage4Group) this.legacyStage4Group.visible = false;

    // 等级 5: 大游轮 (Grand Luxury Cruise Ship) - 终极奢华大邮轮 (等级 5 独占，干净现代，完全隐藏低阶冲突部件)
    if (this.stages[5]) this.stages[5].visible = curStage >= 5;

    // 弹簧阻尼缩放计算 (Spring Scale Bounce)
    const springK = 0.15;
    const damping = 0.82;
    const displacement = this.buildingSpringScale - 1.0;
    this.buildingSpringVelocity += -springK * displacement;
    this.buildingSpringVelocity *= damping;
    this.buildingSpringScale += this.buildingSpringVelocity;

    // 建筑大楼本体保持 1.0 稳定不动
    this.buildingGroup.scale.set(1.0, 1.0, 1.0);
  }

  // 逐件扩建队列推进
  updateExpansionQueue() {
    for (let i = this.expansionQueue.length - 1; i >= 0; i--) {
      const item = this.expansionQueue[i];
      if (item.delayMs > 0) {
        item.delayMs -= 16;
        continue;
      }

      // 弹簧阻尼重力跌落
      const dy = item.targetY - item.currentY;
      item.vy += dy * 0.18;
      item.vy *= 0.75;
      item.currentY += item.vy;
      item.mesh.position.y = item.currentY;

      item.scale = Math.min(1.0, item.scale + 0.15);
      item.mesh.scale.copy(item.targetScale).multiplyScalar(item.scale);

      if (Math.abs(dy) < 0.05 && Math.abs(item.vy) < 0.05) {
        item.mesh.position.y = item.targetY;
        item.mesh.scale.copy(item.targetScale);
        item.mesh.userData.expanding = false;
        this.spawnConstructionDust(item.mesh.getWorldPosition(new THREE.Vector3()), 6);
        this.expansionQueue.splice(i, 1);
      }
    }
  }

  // 5.5 木材安装点提示每帧动态与距离判定
  updateConstructionTargets(t) {
    if (!this.installNodes || !this.installPromptGroup) return;

    const targetNode = this.installNodes[this.activeNodeIndex];
    this.installPromptGroup.position.copy(targetNode.pos);
    this.ghostPlank.rotation.y = targetNode.angle || 0;

    // 悬浮 3D 倒三角箭头与小铁锤上下跳动
    this.floatingArrowGroup.position.y = 3.2 + Math.sin(t * 4.5) * 0.35;
    this.floatingArrowGroup.rotation.y += 0.025;

    // 地面光圈自转与脉动呼吸
    this.targetRing.rotation.z += 0.02;
    const pulse = 1.0 + Math.sin(t * 5.0) * 0.12;
    this.targetRing.scale.set(pulse, pulse, 1);

    // 检测主角与目标安装点的距离
    const dx = this.workerGroup.position.x - targetNode.pos.x;
    const dz = this.workerGroup.position.z - targetNode.pos.z;
    const dist = Math.hypot(dx, dz);
    const isNear = dist < 3.2;

    if (isNear) {
      // 走进范围：耀眼鲜绿色提示「已就位，按 Space 安装！」
      this.ghostMat.color.setHex(0x22c55e);
      this.ghostMat.emissive.setHex(0x16a34a);
      this.targetRingMat.color.setHex(0x22c55e);
      this.floatingArrowMat.color.setHex(0x22c55e);
      this.floatingArrowMat.emissive.setHex(0x15803d);
    } else {
      // 距离远：醒目金黄色指引主播走过来
      this.ghostMat.color.setHex(0x38bdf8);
      this.ghostMat.emissive.setHex(0x0284c7);
      this.targetRingMat.color.setHex(0xfacc15);
      this.floatingArrowMat.color.setHex(0xfacc15);
      this.floatingArrowMat.emissive.setHex(0xd97706);
    }

    // 同步更新介面上的安装木头引导提示徽章
    const badge = document.getElementById('install-target-badge');
    if (badge) {
      if (isNear) {
        if (!badge.classList.contains('ready')) {
          badge.classList.add('ready');
        }
        badge.innerHTML = `✨ <strong>已就位！</strong>按 <span class="key-badge">Space</span> 挥动羊角铁锤安装「${targetNode.name}」！`;
      } else {
        if (badge.classList.contains('ready')) {
          badge.classList.remove('ready');
        }
        badge.innerHTML = `📍 当前待加固点：<strong>${targetNode.name}</strong>（操控角色走进光圈后按 Space 安装木头）`;
      }
    }
  }

  updateFx() {
    // 1. 钓鱼收线原木高拱抛物线飞向木筏堆垛 (落体弹跳啪啪啪物理)
    for (let i = this.flyingWoods.length - 1; i >= 0; i--) {
      const f = this.flyingWoods[i];
      if (f.delay > 0) {
        f.delay -= 16;
        continue;
      }
      if (f.isSpark) {
        f.mesh.position.addScaledVector(f.vel, 0.04);
        f.vel.y -= 0.22;
        f.life -= f.decay;
        f.mesh.scale.setScalar(Math.max(0.01, f.life));
        if (f.life <= 0 || f.mesh.position.y < 0.2) {
          this.scene.remove(f.mesh);
          this.flyingWoods.splice(i, 1);
        }
        continue;
      }

      f.progress += f.speed;
      if (f.progress < 1.0) {
        const p = f.progress;
        // 抛物线高拱飞越海面
        const curX = f.startPos.x + (f.targetPos.x - f.startPos.x) * p;
        const curZ = f.startPos.z + (f.targetPos.z - f.startPos.z) * p;
        const arcY = Math.sin(p * Math.PI) * 8.2;
        const curY = f.startPos.y + (f.targetPos.y - f.startPos.y) * p + arcY;
        f.mesh.position.set(curX, curY, curZ);
        f.mesh.rotation.x += 0.18;
        f.mesh.rotation.y += 0.12;
      } else {
        // 落地瞬间：实体化进规则木筏结构件，触发卡通落体弹跳冲击 (Squash & Stretch)
        this.scene.remove(f.mesh);
        f.mesh.traverse((part) => part.geometry?.dispose());
        if (f.slotIndex !== undefined) {
          this.updateConstructionState(f.slotIndex);
        } else {
          this.updateConstructionState();
        }
        if (f.stackSlot && f.stackSlot.mesh) {
          f.stackSlot.mesh.visible = true;
          f.stackSlot.mesh.scale.set(1.24, 0.76, 1.24); // 落地瞬间受力压缩
        }
        this.spawnConstructionDust(f.targetPos, 8);
        this.buildingSpringVelocity = 0.22;
        this.flyingWoods.splice(i, 1);
      }
    }

    // 1.2 规则木筏结构件弹跳回弹 (Squash & Stretch Lerp to origScale)
    for (let c = 0; c < this.constructionSlots.length; c++) {
      const slot = this.constructionSlots[c];
      if (slot.mesh && slot.mesh.visible && !slot.mesh.userData.expanding) {
        const os = slot.origScale;
        const ms = slot.mesh.scale;
        if (Math.abs(ms.x - os.x) > 0.001 || Math.abs(ms.y - os.y) > 0.001) {
          ms.x += (os.x - ms.x) * 0.18;
          ms.y += (os.y - ms.y) * 0.18;
          ms.z += (os.z - ms.z) * 0.18;
        }
      }
    }

    // 1.5 船上堆叠木材弹跳恢复 (Lerp to 1.0)
    if (this.stackedLogs) {
      for (let s = 0; s < this.stackedLogs.length; s++) {
        const mesh = this.stackedLogs[s];
        if (mesh.scale.x !== 1.0 || mesh.scale.y !== 1.0) {
          mesh.scale.x += (1.0 - mesh.scale.x) * 0.15;
          mesh.scale.y += (1.0 - mesh.scale.y) * 0.15;
          mesh.scale.z += (1.0 - mesh.scale.z) * 0.15;
        }
      }
    }

    // 2. 碎裂碎片翻滚落海
    for (let i = this.debrisPool.length - 1; i >= 0; i--) {
      const d = this.debrisPool[i];
      d.mesh.position.x += d.vx;
      d.mesh.position.y += d.vy;
      d.mesh.position.z += d.vz;
      d.vy -= 0.12; // 重力
      d.mesh.rotation.x += d.rx;
      d.mesh.rotation.y += d.ry;
      d.mesh.rotation.z += d.rz;

      if (d.mesh.position.y <= 0) {
        this.spawnWaterRing(d.mesh.position.x, d.mesh.position.z);
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        this.debrisPool.splice(i, 1);
      }
    }

    // 3. 落海扩散水花浪圈
    for (let i = this.waterRings.length - 1; i >= 0; i--) {
      const r = this.waterRings[i];
      r.scale += 0.1;
      r.opacity -= 0.025;
      r.mesh.scale.set(r.scale, r.scale, r.scale);
      r.mesh.material.opacity = Math.max(0, r.opacity);
      if (r.opacity <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose(); r.mesh.material.dispose();
        this.waterRings.splice(i, 1);
      }
    }

    // 4. 投掷物 (石头、炸弹)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.progress += p.speed;
      if (p.progress >= 1.0) {
        this.scene.remove(p.mesh);
        this.giftFx.impact(p.targetPos, p.type.includes('big'), p.type === 'stone');
        this.spawnDismantleDebris(p.type.includes('big') ? 14 : 6, p.type.includes('big'));
        this.screenShake = Math.min(25, this.screenShake + (p.type.includes('big') ? 18 : 8));
        this.projectiles.splice(i, 1);
      } else {
        const t = p.progress;
        const curX = p.startPos.x + (p.targetPos.x - p.startPos.x) * t;
        const curZ = p.startPos.z + (p.targetPos.z - p.startPos.z) * t;
        const arcY = Math.sin(t * Math.PI) * 16.0;
        const curY = p.startPos.y + (p.targetPos.y - p.startPos.y) * t + arcY;
        p.mesh.position.set(curX, curY, curZ);
        p.mesh.rotation.x += 0.15;
        this.giftFx.trail(p.mesh.position, p.type);
      }
    }

    // 5. 施工微粒
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.mesh.position.x += pt.vx;
      pt.mesh.position.y += pt.vy;
      pt.mesh.position.z += pt.vz;
      pt.life -= pt.decay;
      pt.mesh.material.opacity = Math.max(0, pt.life);
      if (pt.life <= 0) {
        this.scene.remove(pt.mesh);
        pt.mesh.material.dispose();
        this.particles.splice(i, 1);
      }
    }
  }
}

// ==========================================
// 4. 应用主控器与 ZhudaDyLive 通讯对接
// ==========================================
class CrazySeaApp {
  constructor() {
    this.engine = new CrazySeaEngine();
    this.canvas = document.getElementById('world-canvas');
    this.renderer = new ThreeWorldRenderer(this.canvas, this.engine);

    this.keys = {};
    this.raycaster = new THREE.Raycaster();
    this.mouseVec = new THREE.Vector2();

    // 猪大钓鱼 QTE 摆动指针参数
    this.fishPointerPos = 15; // 0 ~ 100%
    this.fishPointerSpeed = 72; // %/秒，流畅自然
    this.fishPointerDir = 1;
    this.lastLoopTime = performance.now();
    this.lastPointerTime = this.lastLoopTime;
    this.fishingSweeps = [];

    this.pluginRunning = false;
    this.pluginVisible = true;
    this.hostAudioEnabled = false;
    this.pluginLifecycleState = null;
    this.bridge = null;
    this.lastHostSettings = null;
    this.lastHostTheme = null;

    this.layoutManager = new LayoutManager(this);

    this.initViewportScale();
    this.setDockExpanded(false);
    this.initEventListeners();
    this.initInkCanvasWiper();
    this.layoutManager.init();

    // 先 loadSettings 完成，再创建 bridge，防止异步存储覆盖已收到的新宿主设置
    this.loadSettings().finally(() => {
      this.bridge = createPluginBridge(this);
    });

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  isGamePlayable() {
    return this.pluginRunning && this.pluginVisible !== false;
  }

  initViewportScale() {
    const resize = () => {
      const viewport = document.getElementById('game-viewport');
      if (!viewport) return;
      const targetW = 1080;
      const targetH = 1920;
      const winW = window.innerWidth || document.documentElement.clientWidth || targetW;
      const winH = window.innerHeight || document.documentElement.clientHeight || targetH;
      if (winW <= 10 || winH <= 10) return; // avoid 1x1 headless glitch
      const scale = Math.min(winW / targetW, winH / targetH);
      viewport.style.transform = `translate(-50%, -50%) scale(${scale})`;
    };
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    window.addEventListener('load', resize);
    resize();
    requestAnimationFrame(resize);
    setTimeout(resize, 100);
    setTimeout(resize, 500);
  }

  setDockExpanded(expanded) {
    this.dockExpanded = Boolean(expanded);
    const panel = document.getElementById('dock-toolbar');
    const toggle = document.getElementById('toggle-dock-btn');
    document.getElementById('control-dock')?.classList.toggle('is-collapsed', !this.dockExpanded);
    if (panel) {
      if (!this.dockExpanded && panel.contains(document.activeElement)) toggle?.focus({ preventScroll: true });
      panel.classList.toggle('hidden', !this.dockExpanded);
      panel.inert = !this.dockExpanded;
      panel.setAttribute('aria-hidden', String(!this.dockExpanded));
    }
    if (toggle) {
      toggle.textContent = this.dockExpanded ? '⌄ 收合操作面板' : '⌃ 展开操作面板';
      toggle.setAttribute('aria-expanded', String(this.dockExpanded));
    }
  }

  initEventListeners() {
    const unlockSound = (event) => {
      if (event.isTrusted) this.engine.sound.ensureContext().then(() => this.syncSoundStatus());
    };
    this.engine.sound.onStateChange = () => this.syncSoundStatus();
    // 捕获阶段先解锁音频，第一次触控的命中／礼物也会有音效。
    window.addEventListener('pointerdown', unlockSound, { capture: true, passive: true });
    window.addEventListener('keydown', unlockSound, { capture: true });
    // 绑定绿色命中区位置与宽度动态变换
    this.engine.onHitZoneChanged = ({ start, width }) => {
      // 新绿区不能继承旧绿区出现前的指针轨迹。
      this.fishingSweeps.length = 0;
      const hitZoneEl = document.getElementById('fq-hitzone');
      if (hitZoneEl) {
        hitZoneEl.style.left = `${start}%`;
        hitZoneEl.style.width = `${width}%`;
        hitZoneEl.classList.toggle('is-tiny', width < 2);
      }
    };
    // 初次载入定位命中区
    this.engine.onHitZoneChanged({ start: this.engine.hitZoneStart, width: this.engine.hitZoneWidth });

    // 猪大钓鱼收线 QTE 触发函式 (绿色命中堆叠木头，没命中扣除木头)
    const triggerFishingPull = () => {
      if (!this.isGamePlayable()) return;
      // 使用已经显示的位置，不在输入时把指针偷偷往前推进。
      const track = document.querySelector('.ft-track');
      const pointer = document.getElementById('fishing-pointer');
      const trackRect = track?.getBoundingClientRect();
      const pointerRect = pointer?.getBoundingClientRect();
      const scale = track?.offsetWidth > 0 ? trackRect.width / track.offsetWidth : 0;
      const trackWidth = (track?.clientWidth ?? 0) * scale;
      const trackLeft = (trackRect?.left ?? 0) + (track?.clientLeft ?? 0) * scale;
      // 同一份画面矩形负责左右两侧和完全包住绿区的判定，手机缩放也一致。
      const contactRange = pointerRect && trackWidth > 0 ? {
        min: (pointerRect.left - trackLeft) / trackWidth * 100,
        max: (pointerRect.right - trackLeft) / trackWidth * 100,
      } : { min: this.fishPointerPos, max: this.fishPointerPos };
      const radius = (contactRange.max - contactRange.min) / 2;
      const now = performance.now();
      // 保留最多 80ms 的已显示轨迹，补偿合成画面／触控延迟，不预测未来位置。
      // 换区和每次收线都会清空，卡顿／切回页面也不追溯过期轨迹。
      for (const sweep of this.fishingSweeps) {
        if (now >= sweep.toTime && now - sweep.fromTime <= FISHING_INPUT_GRACE_MS &&
            sweep.zoneStart === this.engine.hitZoneStart && sweep.zoneWidth === this.engine.hitZoneWidth) {
          contactRange.min = Math.min(contactRange.min, sweep.min - radius);
          contactRange.max = Math.max(contactRange.max, sweep.max + radius);
        }
      }
      this.fishingSweeps.length = 0;
      const res = this.engine.pullFishingRod(this.fishPointerPos, contactRange);
      const fb = document.getElementById('fq-feedback');
      if (fb) {
        fb.className = 'fq-feedback';
        void fb.offsetWidth; // 强制重绘触发 CSS 动画
        if (res.success) {
          fb.classList.add('hit');
          fb.textContent = res.message;
        } else {
          fb.classList.add('miss');
          fb.textContent = res.message;
        }
      }
    };
    this.triggerFishingPull = triggerFishingPull;

    // 键盘移动与热键
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target instanceof HTMLElement && e.target.closest('button')) return;
      // 输入框内打字时屏蔽任何热键（包括 L 与游戏操作）
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]')) {
        if (e.code === 'Escape' && this.layoutManager?.isEditing) {
          this.layoutManager.setEditing(false);
        }
        return;
      }

      // 快捷键 L 开关 UI 自由布局编辑模式 (防止长按 repeat 抖动)
      if (e.code === 'KeyL') {
        e.preventDefault();
        if (e.repeat) return;
        this.layoutManager?.toggleEditing();
        return;
      }
      // 布局编辑模式下屏蔽游戏操作热键
      if (this.layoutManager?.isEditing) {
        if (e.code === 'Escape') this.layoutManager.setEditing(false);
        return;
      }

      // 主播授权弹窗开启时屏蔽游戏热键
      const hostAuthModal = document.getElementById('host-auth-modal');
      if (hostAuthModal && !hostAuthModal.classList.contains('hidden')) {
        if (e.code === 'Escape') {
          hostAuthModal.classList.add('hidden');
        }
        return;
      }

      if (document.getElementById('config-modal')?.classList.contains('active') && e.code !== 'KeyP') return;
      this.keys[e.code] = true;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) triggerFishingPull();
      } else if (e.code === 'Digit1') {
        // 1. 丢炸弹炸掉木头 (统一通过 triggerDockAction 分发)
        triggerDockAction('small-bomb', 1, () => this.engine.applySmallBomb('开播测试员', 1));
      } else if (e.code === 'Digit2') {
        // 2. 丢烟雾减慢光标速度
        triggerDockAction('smoke', 1, () => this.engine.applySmoke('开播测试员', 6));
      } else if (e.code === 'Digit3') {
        // 3. 丢海带遮住面板
        triggerDockAction('kelp', 1, () => this.engine.applyKelp('开播测试员', 7));
      } else if (e.code === 'Digit4') {
        // 4. 丢河豚减少命中区范围
        triggerDockAction('shrink-zone', 1, () => this.engine.applyShrinkZone('开播测试员'));
      } else if (e.code === 'Digit5') {
        // 5. 丢海星增加命中区范围
        triggerDockAction('expand-zone', 1, () => this.engine.applyExpandZone('开播测试员'));
      } else if (e.code === 'Digit0') {
        triggerDockAction('nuke', 1, () => this.engine.applyNuke('神秘大哥'));
      } else if (e.code === 'KeyF') {
        triggerDockAction('filter', 1, () => this.engine.applyFilter('榜一大哥', 1));
      } else if (e.code === 'KeyI') {
        triggerDockAction('ink', 1, () => this.engine.applyInk('淘气观众'));
      } else if (e.code === 'KeyW') {
        triggerDockAction('weed', 1, () => this.engine.applyWeed('水草王'));
      } else if (e.code === 'KeyC') {
        // 清除所有干扰 (海带、烟雾、海草、墨汁)
        triggerDockAction('clean', 1, () => this.engine.clearAllInterference());
      } else if (e.code === 'KeyR') {
        triggerDockAction('rage', 1, () => {
          this.engine.isRageMode = !this.engine.isRageMode;
          this.engine.triggerToast(this.engine.isRageMode ? '🔥 狂暴加班模式开启！' : '🌿 退出狂暴模式', true);
          this.engine.updateUI();
        });

      } else if (e.code === 'KeyH') {
        if (!e.repeat) this.setDockExpanded(!this.dockExpanded);
      } else if (e.code === 'KeyP') {
        const modal = document.getElementById('config-modal');
        if (modal) modal.classList.toggle('active');
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // 统一动作分发入口 (仅执行本地动作，无网络队列)
    const triggerDockAction = (eventId, count, fn, defaultSender = '主播测试') => {
      if (!this.isGamePlayable()) return;
      fn();
    };

    // 全屏幕点击收线拉竿 (不需要按钮，主播点屏幕任意处或是按 Space 都行)
    window.addEventListener('pointerdown', (e) => {
      const target = e.target;
      if (!(target instanceof Element) || e.button !== 0 || !e.isPrimary) return;

      // 自由布局编辑模式中禁止触发钓鱼
      if (
        this.layoutManager?.isEditing ||
        this.layoutManager?.justFinishedDragging ||
        target.closest('#layout-editor-toolbar, .ui-drag-handle, .is-editing-layout')
      ) {
        return;
      }

      // 排除主播授权 UI、模式状态徽章、输入框、各种弹窗与按钮
      if (
        target.closest('#mode-status-badge') ||
        target.closest('.mode-badge') ||
        target.closest('#host-auth-modal') ||
        target.closest('.host-auth-modal-overlay') ||
        target.closest('.host-auth-dialog') ||
        target.closest('#control-dock') ||
        target.closest('#config-modal') ||
        target.closest('#victory-modal') ||
        target.closest('.leaderboard-card') ||
        target.closest('.preset-btn') ||
        target.closest('button') ||
        target.tagName === 'INPUT'
      ) {
        return;
      }

      // 收线按钮也在按下时判定，避免触屏松手的延迟和随后 click 的重复判定。
      if (target.closest('#btn-reel-pull, #btn-hammer')) {
        triggerFishingPull();
        return;
      }

      triggerFishingPull();
    });

    // UI 按钮事件绑定
    const bindBtn = (id, fn) => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', fn);
    };

    const pullFromKeyboardClick = (event) => {
      if (event.detail === 0) {
        triggerFishingPull();
        // 普通本地 QTE 钓鱼点击不凭空记账 tap-nail，保持本地游戏纯粹性
      }
    };
    bindBtn('btn-reel-pull', pullFromKeyboardClick);
    bindBtn('btn-hammer', pullFromKeyboardClick);
    bindBtn('btn-bomb', () => triggerDockAction('small-bomb', 1, () => this.engine.applySmallBomb('测试观众', 1)));
    bindBtn('btn-smoke', () => triggerDockAction('smoke', 1, () => this.engine.applySmoke('测试观众', 6)));
    bindBtn('btn-kelp', () => triggerDockAction('kelp', 1, () => this.engine.applyKelp('测试观众', 7)));
    bindBtn('btn-puffer', () => triggerDockAction('shrink-zone', 1, () => this.engine.applyShrinkZone('测试观众')));
    bindBtn('btn-starfish', () => triggerDockAction('expand-zone', 1, () => this.engine.applyExpandZone('测试观众')));
    bindBtn('btn-stone', () => triggerDockAction('stone', 1, () => this.engine.applyStone('测试观众', 1)));
    bindBtn('btn-small-bomb', () => triggerDockAction('small-bomb', 1, () => this.engine.applySmallBomb('测试观众', 1)));
    bindBtn('btn-big-bomb', () => triggerDockAction('big-bomb', 1, () => this.engine.applyBigBomb('测试观众', 1)));
    bindBtn('btn-nuke', () => triggerDockAction('nuke', 1, () => this.engine.applyNuke('毁灭者')));
    bindBtn('btn-filter', () => triggerDockAction('filter', 1, () => this.engine.applyFilter('护航大哥', 1)));
    bindBtn('btn-ink', () => triggerDockAction('ink', 1, () => this.engine.applyInk('墨汁怪')));
    bindBtn('btn-weed', () => triggerDockAction('weed', 1, () => this.engine.applyWeed('水草王')));
    bindBtn('btn-clean', () => triggerDockAction('clean', 1, () => this.engine.clearAllInterference()));
    bindBtn('btn-rage', () => {
      triggerDockAction('rage', 1, () => {
        this.engine.isRageMode = !this.engine.isRageMode;
        this.engine.triggerToast(this.engine.isRageMode ? '🔥 狂暴加班开启！' : '🌿 退出狂暴模式', true);
        this.engine.updateUI();
      });
    });
    bindBtn('btn-config', () => {
      const modal = document.getElementById('config-modal');
      if (modal) modal.classList.add('active');
    });

    bindBtn('btn-open-layout-editor', () => {
      const modal = document.getElementById('config-modal');
      if (modal) modal.classList.remove('active');
      this.layoutManager?.setEditing(true);
    });

    bindBtn('toggle-dock-btn', () => {
      this.setDockExpanded(!this.dockExpanded);
      this.engine.sound.playUI();
    });
    bindBtn('btn-sound', () => {
      this.engine.soundEnabled = !this.engine.soundEnabled;
      this.syncSoundSettings();
      this.engine.sound.playUI();
      this.saveSettings();
    });
    bindBtn('btn-sound-preview', () => this.engine.sound.playPreview());

    // 设置面板关闭
    bindBtn('close-config-btn', () => {
      const modal = document.getElementById('config-modal');
      if (modal) modal.classList.remove('active');
      this.saveSettings();
    });

    // 胜利弹窗
    bindBtn('victory-continue-btn', () => {
      this.engine.targetWood += 1000;
      this.engine.hasWon = false;
      this.engine.workerState = 'idle';
      const modal = document.getElementById('victory-modal');
      if (modal) modal.classList.remove('active');
      this.engine.updateUI();
    });
    bindBtn('victory-close-btn', () => {
      const modal = document.getElementById('victory-modal');
      if (modal) modal.classList.remove('active');
    });

    // 默认模式切换
    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
        e.target.classList.add('active');
        const p = e.target.dataset.preset;
        if (p === 'small') {
          this.engine.targetWood = 300;
          this.engine.stoneDamage = 2;
          this.engine.smallBombDamage = 8;
        } else if (p === 'standard') {
          this.engine.targetWood = 1000;
          this.engine.stoneDamage = 5;
          this.engine.smallBombDamage = 20;
        } else if (p === 'large') {
          this.engine.targetWood = 5000;
          this.engine.stoneDamage = 15;
          this.engine.smallBombDamage = 50;
        }
        this.syncConfigUI();
        this.engine.updateUI();
      });
    });

    this.bindConfigInputs();
  }

  bindConfigInputs() {
    const bindVal = (id, prop, isNum = true) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', (e) => {
          this.engine[prop] = isNum ? Number(e.target.value) : e.target.checked;
          this.engine.updateUI();
          this.saveSettings();
        });
      }
    };
    bindVal('cfg-target-wood', 'targetWood');
    bindVal('cfg-stone-dmg', 'stoneDamage');
    bindVal('cfg-small-bomb-dmg', 'smallBombDamage');
    bindVal('cfg-big-bomb-dmg', 'bigBombDamage');
    bindVal('cfg-filter-lv1', 'filterWoodLv1');
    bindVal('cfg-autotap-speed', 'autoTapSpeed');
    bindVal('cfg-filter-autoupgrade', 'filterAutoUpgrade', false);
    document.getElementById('cfg-sound-volume')?.addEventListener('change', (event) => {
      const value = event.target.valueAsNumber;
      if (Number.isFinite(value)) this.engine.soundVolume = Math.max(0, Math.min(100, value));
      this.syncSoundSettings();
      this.saveSettings();
    });
    document.getElementById('cfg-sound-enabled')?.addEventListener('change', (event) => {
      this.engine.soundEnabled = event.target.checked;
      this.syncSoundSettings();
      this.saveSettings();
    });

    document.getElementById('apply-stage-thresholds')?.addEventListener('click', () => this.applyStageThresholdSettings());
    document.getElementById('apply-hit-zone-settings')?.addEventListener('click', () => this.applyHitZoneSettings());
    for (const id of ['stage-threshold-settings', 'fishing-zone-settings']) {
      document.getElementById(id)?.addEventListener('input', () => {
        const statusId = id === 'stage-threshold-settings' ? 'stage-threshold-status' : 'hit-zone-status';
        this.showConfigStatus(statusId, '修改尚未应用，完成后请按应用并保存。', 'draft');
      });
    }

    const themeSel = document.getElementById('cfg-theme');
    if (themeSel) {
      themeSel.addEventListener('change', (e) => {
        this.engine.theme = e.target.value;
        document.body.dataset.theme = e.target.value;
        this.renderer.setTheme(e.target.value);
        this.saveSettings();
      });
    }
  }

  showConfigStatus(id, message, state) {
    const status = document.getElementById(id);
    if (status) {
      status.textContent = message;
      status.dataset.state = state;
    }
  }

  refreshBuildingSettings() {
    this.renderer.resetExpansionAnimations();
    this.renderer.updateConstructionState();
    this.renderer.updateBuildingStages();
    this.engine.updateUI();
  }

  async applyStageThresholdSettings() {
    const inputs = Array.from({ length: 5 }, (_, index) => document.getElementById(`cfg-stage-${index + 1}`));
    const values = [0, ...inputs.map((input) => Number(input.value))];
    const valid = this.engine.setStageThresholds(values);
    inputs.forEach((input, index) => {
      const invalid = !input.checkValidity() || values[index + 1] <= values[index];
      input.setAttribute('aria-invalid', String(invalid));
    });
    if (!valid) {
      this.showConfigStatus('stage-threshold-status', '请填入 1～1,000,000 的整数，且每一阶门槛须大于前一阶。', 'error');
      return false;
    }
    this.refreshBuildingSettings();
    const saved = await this.saveSettings();
    if (saved) {
      this.showConfigStatus('stage-threshold-status', '已应用并保存，建筑与上方进度已更新。', 'saved');
    } else {
      this.showConfigStatus('stage-threshold-status', '设置已应用，本机保存失败，请重试', 'error');
    }
    return saved;
  }

  async applyHitZoneSettings() {
    const baseInput = document.getElementById('cfg-hit-zone-width');
    const minInput = document.getElementById('cfg-min-hit-zone-width');
    const baseWidth = Number(baseInput.value);
    const minWidth = Number(minInput.value);
    const valid = baseInput.checkValidity() && minInput.checkValidity() && this.engine.setHitZoneConfig(baseWidth, minWidth);
    baseInput.setAttribute('aria-invalid', String(!baseInput.checkValidity()));
    minInput.setAttribute('aria-invalid', String(!minInput.checkValidity() || minWidth > baseWidth));
    if (!valid) {
      this.showConfigStatus('hit-zone-status', '宽度须为 0.1～50%，且最小宽度不可大于起始宽度。', 'error');
      return false;
    }
    this.engine.updateUI();
    const saved = await this.saveSettings();
    if (saved) {
      this.showConfigStatus('hit-zone-status', `已应用并保存，目前绿区宽度为 ${this.engine.hitZoneWidth}%。`, 'saved');
    } else {
      this.showConfigStatus('hit-zone-status', '设置已应用，本机保存失败，请重试', 'error');
    }
    return saved;
  }

  syncConfigUI() {
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v;
    };
    setVal('cfg-target-wood', this.engine.targetWood);
    this.engine.stageThresholds.slice(1).forEach((value, index) => setVal(`cfg-stage-${index + 1}`, value));
    setVal('cfg-hit-zone-width', this.engine.baseHitZoneWidth);
    setVal('cfg-min-hit-zone-width', this.engine.minHitZoneWidth);
    setVal('cfg-stone-dmg', this.engine.stoneDamage);
    setVal('cfg-small-bomb-dmg', this.engine.smallBombDamage);
    setVal('cfg-big-bomb-dmg', this.engine.bigBombDamage);
    setVal('cfg-filter-lv1', this.engine.filterWoodLv1);
    setVal('cfg-autotap-speed', this.engine.autoTapSpeed);
    this.syncSoundSettings();
  }

  syncSoundSettings() {
    const audible = Boolean(this.engine.soundEnabled && this.hostAudioEnabled && this.isGamePlayable());
    this.engine.sound.setVolume(this.engine.soundVolume);
    this.engine.sound.setEnabled(audible);
    if (!audible) {
      this.engine.sound.stopAll?.();
    }
    const volume = document.getElementById('cfg-sound-volume');
    const enabled = document.getElementById('cfg-sound-enabled');
    const toggle = document.getElementById('btn-sound');
    if (volume) volume.value = this.engine.soundVolume;
    if (enabled) enabled.checked = this.engine.soundEnabled;
    if (toggle) {
      toggle.textContent = audible ? '🔊 音效开' : '🔇 已静音';
      toggle.setAttribute('aria-pressed', String(this.engine.soundEnabled));
      toggle.setAttribute('aria-label', this.engine.soundEnabled ? '关闭音效' : '开启音效');
    }
    const preview = document.getElementById('btn-sound-preview');
    if (preview) preview.disabled = !audible || this.engine.soundVolume === 0;
    this.syncSoundStatus();
  }

  syncSoundStatus() {
    const status = document.getElementById('sound-status');
    if (!status) return;
    const text = !this.engine.soundEnabled || this.engine.soundVolume === 0 || !this.hostAudioEnabled || !this.isGamePlayable()
      ? '已静音'
      : this.engine.sound.ctx?.state === 'running' ? '音效已启用' : '点一下画面，即可开始播放音效。';
    if (status.textContent !== text) status.textContent = text;
  }

  initInkCanvasWiper() {
    const canvas = document.getElementById('ink-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let isWiping = false;

    const wipe = (x, y) => {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    canvas.addEventListener('pointerdown', (e) => {
      isWiping = true;
      const rect = canvas.getBoundingClientRect();
      wipe(((e.clientX - rect.left) / rect.width) * canvas.width, ((e.clientY - rect.top) / rect.height) * canvas.height);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!isWiping) return;
      const rect = canvas.getBoundingClientRect();
      wipe(((e.clientX - rect.left) / rect.width) * canvas.width, ((e.clientY - rect.top) / rect.height) * canvas.height);
    });

    window.addEventListener('pointerup', () => {
      isWiping = false;
    });
  }

  getSettings() {
    return {
      targetWood: this.engine.targetWood,
      stageThresholds: [...this.engine.stageThresholds],
      baseHitZoneWidth: this.engine.baseHitZoneWidth,
      minHitZoneWidth: this.engine.minHitZoneWidth,
      stoneDamage: this.engine.stoneDamage,
      smallBombDamage: this.engine.smallBombDamage,
      bigBombDamage: this.engine.bigBombDamage,
      filterWoodLv1: this.engine.filterWoodLv1,
      filterAutoUpgrade: Boolean(this.engine.filterAutoUpgrade),
      inkDuration: this.engine.inkDuration,
      weedDuration: this.engine.weedDuration,
      soundVolume: this.engine.soundVolume,
      soundEnabled: Boolean(this.engine.soundEnabled),
      theme: this.engine.theme || 'default',
      autoTapSpeed: 0
    };
  }

  async saveSettings() {
    try {
      const data = {
        ...this.getSettings(),
        __hostSettings: this.lastHostSettings ? { ...this.lastHostSettings } : null,
        __hostTheme: this.lastHostTheme || null
      };
      await pluginStorage.set('crazysea.settings.v1', data);
      return true;
    } catch (err) {
      console.warn('[Settings] 保存到本机存储失败:', err);
      this.engine?.triggerToast?.('设置已应用，本机保存失败，请重试', false);
      return false;
    }
  }

  async loadSettings() {
    try {
      const saved = await pluginStorage.get('crazysea.settings.v1');
      if (saved && typeof saved === 'object') {
        if (saved.__hostSettings && typeof saved.__hostSettings === 'object') {
          this.lastHostSettings = { ...saved.__hostSettings };
        }
        if (typeof saved.__hostTheme === 'string') {
          this.lastHostTheme = saved.__hostTheme;
        }
        this.setPluginSettings(saved, true);
        if (typeof saved.theme === 'string' && saved.theme) {
          this.setPluginTheme(saved.theme, true);
        }
      }
    } catch (err) {
      console.warn('[Settings] 读取设置失败:', err);
      this.engine?.triggerToast?.('读取失败，使用默认设置/布局，请重试', false);
    }
    if (typeof this.syncConfigUI === 'function') this.syncConfigUI();
    if (typeof this.refreshBuildingSettings === 'function') this.refreshBuildingSettings();
  }

  applySettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    const s = settings;
    const previousSettings = typeof this.getSettings === 'function' ? JSON.stringify(this.getSettings()) : '';

    if (Number.isFinite(s.targetWood) && s.targetWood >= 1 && s.targetWood <= 1000000) {
      this.engine.targetWood = Math.round(s.targetWood);
    }

    // 映射 stageThresholds 或 STAGE_SETTING_KEYS
    let newThresholds = null;
    if (Array.isArray(s.stageThresholds) && s.stageThresholds.length === 6) {
      if (s.stageThresholds.every(v => Number.isInteger(v) && v >= 0 && v <= 1000000)) {
        newThresholds = s.stageThresholds;
      }
    } else if (STAGE_SETTING_KEYS.some(k => Number.isFinite(s[k]))) {
      const candidate = [...this.engine.stageThresholds];
      STAGE_SETTING_KEYS.forEach((k, idx) => {
        if (Number.isFinite(s[k])) {
          candidate[idx + 1] = Math.round(s[k]);
        }
      });
      if (candidate.length === 6 && candidate[0] === 0 &&
          candidate.slice(1).every((val, idx) => Number.isInteger(val) && val >= 1 && val <= 1000000 && val > candidate[idx])) {
        newThresholds = candidate;
      }
    }

    if (newThresholds && JSON.stringify(newThresholds) !== JSON.stringify(this.engine.stageThresholds)) {
      if (this.engine.setStageThresholds(newThresholds)) {
        if (typeof this.refreshBuildingSettings === 'function') {
          this.refreshBuildingSettings();
        }
      }
    }

    // 绿区设置，保留 0.1..50 边界，值没变化不随机换绿区
    if (Number.isFinite(s.baseHitZoneWidth) || Number.isFinite(s.minHitZoneWidth)) {
      const baseWidth = Math.max(0.1, Math.min(50, Number(s.baseHitZoneWidth ?? this.engine.baseHitZoneWidth)));
      const minWidth = Math.max(0.1, Math.min(50, Number(s.minHitZoneWidth ?? this.engine.minHitZoneWidth)));
      if (baseWidth !== this.engine.baseHitZoneWidth || minWidth !== this.engine.minHitZoneWidth) {
        this.engine.setHitZoneConfig(baseWidth, minWidth);
      }
    }

    if (Number.isInteger(s.stoneDamage) && s.stoneDamage >= 1 && s.stoneDamage <= 1000000) this.engine.stoneDamage = s.stoneDamage;
    if (Number.isInteger(s.smallBombDamage) && s.smallBombDamage >= 1 && s.smallBombDamage <= 1000000) this.engine.smallBombDamage = s.smallBombDamage;
    if (Number.isInteger(s.bigBombDamage) && s.bigBombDamage >= 1 && s.bigBombDamage <= 1000000) this.engine.bigBombDamage = s.bigBombDamage;
    if (Number.isInteger(s.filterWoodLv1) && s.filterWoodLv1 >= 1 && s.filterWoodLv1 <= 1000000) this.engine.filterWoodLv1 = s.filterWoodLv1;
    if (typeof s.filterAutoUpgrade === 'boolean') this.engine.filterAutoUpgrade = s.filterAutoUpgrade;
    if (Number.isFinite(s.inkDuration) && s.inkDuration >= 1 && s.inkDuration <= 60) this.engine.inkDuration = Math.round(s.inkDuration);
    if (Number.isFinite(s.weedDuration) && s.weedDuration >= 1 && s.weedDuration <= 60) this.engine.weedDuration = Math.round(s.weedDuration);
    if (Number.isFinite(s.soundVolume)) this.engine.soundVolume = Math.max(0, Math.min(100, Math.round(s.soundVolume)));
    if (typeof s.soundEnabled === 'boolean') this.engine.soundEnabled = s.soundEnabled;

    // 保证 autoTapSpeed 为 0，不启用自动建设
    this.engine.autoTapSpeed = 0;

    // 主题变更
    if (typeof s.theme === 'string' && s.theme && s.theme !== this.engine.theme) {
      this.setPluginTheme(s.theme, true);
    }

    if (typeof this.getSettings === 'function' && JSON.stringify(this.getSettings()) !== previousSettings) {
      if (typeof this.syncConfigUI === 'function') this.syncConfigUI();
    }
  }

  setPluginSettings(settings, fromSaved = false) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    if (fromSaved) {
      this.applySettings(settings);
      return;
    }

    if (!this.lastHostSettings) {
      this.lastHostSettings = { ...settings };
      this.applySettings(settings);
      return;
    }

    const changed = {};
    let hasChanges = false;
    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined) continue;
      const prev = this.lastHostSettings[key];
      let isDifferent = false;
      if (Array.isArray(value) && Array.isArray(prev)) {
        isDifferent = JSON.stringify(value) !== JSON.stringify(prev);
      } else if (value && typeof value === 'object' && prev && typeof prev === 'object') {
        isDifferent = JSON.stringify(value) !== JSON.stringify(prev);
      } else {
        isDifferent = value !== prev;
      }

      if (isDifferent) {
        changed[key] = value;
        this.lastHostSettings[key] = (typeof structuredClone === 'function') ? structuredClone(value) : JSON.parse(JSON.stringify(value));
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.applySettings(changed);
    }
  }

  setPluginTheme(theme, fromSaved = false) {
    if (typeof theme !== 'string' || !theme) return;
    if (fromSaved) {
      this.engine.theme = theme;
      if (typeof document !== 'undefined' && document.body && document.body.dataset) {
        document.body.dataset.theme = theme;
      }
      if (this.renderer && typeof this.renderer.setTheme === 'function') {
        this.renderer.setTheme(theme);
      }
      return;
    }

    if (!this.lastHostTheme) {
      this.lastHostTheme = theme;
      this.engine.theme = theme;
      if (typeof document !== 'undefined' && document.body && document.body.dataset) {
        document.body.dataset.theme = theme;
      }
      if (this.renderer && typeof this.renderer.setTheme === 'function') {
        this.renderer.setTheme(theme);
      }
      return;
    }

    if (theme === this.lastHostTheme) {
      return;
    }

    this.lastHostTheme = theme;
    this.engine.theme = theme;
    if (typeof document !== 'undefined' && document.body && document.body.dataset) {
      document.body.dataset.theme = theme;
    }
    if (this.renderer && typeof this.renderer.setTheme === 'function') {
      this.renderer.setTheme(theme);
    }
  }

  setPluginLifecycle(state) {
    if (!state || typeof state !== 'object') return;
    this.pluginLifecycleState = state;
    const isRunning = state.status === 'running';
    const isVisible = state.visible !== false;
    const canPlay = isRunning && isVisible;

    this.pluginRunning = isRunning;
    this.pluginVisible = isVisible;

    if (state.audio) {
      this.hostAudioEnabled = state.audio.enabled !== false;
    }

    this.syncSoundSettings();

    if (!canPlay) {
      // 冻结 QTE/游戏计时/移动、停止声音、清空 fishingSweeps 和 keys
      this.keys = {};
      this.fishingSweeps.length = 0;
      this.engine.sound?.stopAll?.();

      // 安全取消待定动作 (核弹倒数/墨汁/海草等) 并清理 overlay/flag
      this.engine.cancelPendingActions?.();
    }
  }

  dispatchPluginAction(action) {
    if (!action || typeof action !== 'object') return;
    // 宿主动作 dispatch 判断游戏可运行状态；游标已在 bridge 中消耗该快照，暂停时不重播
    if (!this.isGamePlayable()) return;

    const sender = action.senderName || '热心观众';
    const count = parseInt(action.quantity || '1', 10) || 1;
    const total = action.total !== undefined ? action.total : count;
    const eventId = action.eventId || '';

    switch (eventId) {
      case 'stone':
        this.engine.applyStone(sender, count, total);
        break;
      case 'bomb-small':
      case 'small-bomb':
      case 'bomb':
        this.engine.applySmallBomb(sender, count, total);
        break;
      case 'bomb-big':
      case 'big-bomb':
        this.engine.applyBigBomb(sender, count, total);
        break;
      case 'bomb-nuke':
      case 'nuke':
        this.engine.applyNuke(sender);
        break;
      case 'filter':
        this.engine.applyFilter(sender, count, total);
        break;
      case 'tap-nail':
        this.engine.applyTapNail(sender, total);
        break;
      case 'smoke':
        this.engine.applySmoke(sender, total || 6);
        break;
      case 'kelp':
      case 'kelp-panel':
        this.engine.applyKelp(sender, total || 7);
        break;
      case 'shrink-zone':
      case 'pufferfish':
      case 'puffer':
        this.engine.applyShrinkZone(sender, total);
        break;
      case 'expand-zone':
      case 'starfish':
        this.engine.applyExpandZone(sender, total);
        break;
      case 'ink':
        this.engine.applyInk(sender);
        break;
      case 'weed':
        this.engine.applyWeed(sender);
        break;
      case 'clean':
        this.engine.clearAllInterference?.();
        break;
      case 'rage':
        this.engine.isRageMode = !this.engine.isRageMode;
        this.engine.triggerToast?.(this.engine.isRageMode ? '🔥 狂暴加班模式开启！' : '🌿 退出狂暴模式', true);
        this.engine.updateUI?.();
        break;
      default:
        break;
    }
  }

  updateFishingPointer(now = performance.now()) {
    const fromTime = this.lastPointerTime;
    const dt = Math.max(0, Math.min(0.08, (now - fromTime) / 1000));
    this.lastPointerTime = now;
    // 烟雾减速效果 (光标速度减慢 50%)
    const speedMult = this.engine.smokeActive ? 0.45 : 1.0;
    const previousPos = this.fishPointerPos;
    this.fishPointerPos += this.fishPointerSpeed * speedMult * this.fishPointerDir * dt;
    let turn = null;
    if (this.fishPointerPos >= 96) {
      this.fishPointerPos = 192 - this.fishPointerPos;
      this.fishPointerDir = -1;
      turn = 96;
    } else if (this.fishPointerPos <= 4) {
      this.fishPointerPos = 8 - this.fishPointerPos;
      this.fishPointerDir = 1;
      turn = 4;
    }
    this.fishingSweeps.push({
      min: Math.min(previousPos, this.fishPointerPos, turn ?? this.fishPointerPos),
      max: Math.max(previousPos, this.fishPointerPos, turn ?? this.fishPointerPos),
      fromTime, toTime: now,
      zoneStart: this.engine.hitZoneStart, zoneWidth: this.engine.hitZoneWidth,
    });
    while (this.fishingSweeps.length && now - this.fishingSweeps[0].fromTime > FISHING_INPUT_GRACE_MS) this.fishingSweeps.shift();

    const pointerEl = document.getElementById('fishing-pointer');
    if (pointerEl) {
      pointerEl.style.left = `${this.fishPointerPos}%`;
    }
  }

  loop() {
    const now = performance.now();
    const dt = Math.min(0.08, (now - this.lastLoopTime) / 1000);
    this.lastLoopTime = now;

    if (!this.isGamePlayable()) {
      this.keys = {};
      this.fishingSweeps.length = 0;
      this.lastPointerTime = now;
      requestAnimationFrame(this.loop);
      return;
    }

    // 烟雾与海带遮挡定时器倒数
    if (this.engine.smokeTimer > 0) {
      this.engine.smokeTimer -= dt;
      if (this.engine.smokeTimer <= 0) {
        this.engine.smokeActive = false;
        const sOverlay = document.getElementById('smoke-overlay');
        if (sOverlay) sOverlay.classList.remove('active');
        this.engine.updateUI();
      }
    }
    if (this.engine.kelpPanelTimer > 0) {
      this.engine.kelpPanelTimer -= dt;
      if (this.engine.kelpPanelTimer <= 0) {
        this.engine.kelpPanelActive = false;
        const kOverlay = document.getElementById('panel-kelp-overlay');
        if (kOverlay) kOverlay.classList.remove('active');
        this.engine.updateUI();
      }
    }

    if (this.engine.workerTimer > 0) {
      this.engine.workerTimer--;
      if (this.engine.workerTimer <= 0) {
        if (!this.engine.weedActive && this.engine.workerState !== 'cheering' && this.engine.workerDizzyTimer <= 0) {
          this.engine.workerState = 'idle';
        }
      }
    }

    this.renderer.update(dt);
    // 在耗时的 3D 更新完成后再提交光标，缩短新判定位置领先实际画面的时间。
    this.updateFishingPointer(performance.now());
    requestAnimationFrame(this.loop);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new CrazySeaApp();
  // 生产环境杜绝全局调试入口
});
