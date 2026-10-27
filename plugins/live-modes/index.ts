import { scene } from "../../streamingClient/packages/plugin-sdk/src/index";
import type {
  GameAction,
  SceneFrameState,
} from "../../streamingClient/packages/contracts/src/index";
import { ActionCursor } from "../../streamingClient/games/shared/actions";
import { machineArtwork } from "./artwork";
import { LiveEffects, PrisonGate } from "./effects";
import { SewingMotion } from "./sewing-motion";
import { ClothCanvas } from "./cloth-canvas";
import { SewingAudio } from "./sewing-audio";

const sewing = document.body.dataset.source === "sewing";
const root = document.getElementById("mode")!;
root.innerHTML = sewing
  ? `
  <canvas class="prison" aria-label="监狱栅栏"></canvas>
  <canvas class="cloth-field" aria-label="待缝布料：每点一块"></canvas>
  <header class="sewing-heading"><div><h1></h1></div>
    <div class="timer-card"><span>距离下班</span><strong id="timer">30:00</strong><small id="mode-status">尚未启动</small></div></header>
  <div class="machine-wrap"><div class="machine-aura"></div>${machineArtwork}<div class="work-badge"><i></i><span id="work-label">等待开工</span></div></div>
  <div class="event-toast sewing-toast" role="status"><svg class="toast-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="m6 11 10-5 10 5-10 5Zm0 5 10 5 10-5M6 21l10 5 10-5"/></svg><div class="toast-copy"><span></span><strong></strong></div><i class="toast-stitch" aria-hidden="true"></i></div>
  <div class="cloth-shockwave"></div><div class="flash"></div><canvas class="particles"></canvas>`
  : `
  <section class="task-board"><header><div><span class="eyebrow">直播里程碑</span><h1></h1></div><span class="task-status" id="mode-status">尚未启动</span></header>
  <div class="task-meters">${[
    ["giftPeople", "送礼人数", "giftGoal", "♡"],
    ["likes", "点赞数量", "likeGoal", "✦"],
    ["follows", "关注人数", "followGoal", "＋"],
  ]
    .map(
      ([key, label, goal, icon]) =>
        `<article class="task-meter" data-metric="${key}" data-goal="${goal}"><div class="meter-label"><span class="meter-icon">${icon}</span><h2>${label}</h2><span class="check">✓</span></div><div class="meter-number"><strong>0</strong><small> / <span>0</span></small></div><div class="meter-track" role="progressbar" aria-label="${label}" aria-valuemin="0"><div class="meter-fill"></div></div><div class="meter-footer"><span class="percent">0%</span><span class="goal-status">进行中</span></div></article>`,
    )
    .join("")}</div>
  <article class="score-meter task-meter" data-metric="score" data-goal="scoreGoal"><div class="score-heading"><div><span class="eyebrow">每一份支持，都有回应</span><h2 id="score-title">心愿进度</h2></div><span class="check">✓</span></div><div class="score-numbers"><div class="meter-number"><strong>0</strong><small> / <span>10,000</span></small></div><span class="percent">0%</span></div><div class="meter-track" role="progressbar" aria-label="目标分" aria-valuemin="0"><div class="meter-fill"></div></div><span class="goal-status">每一份支持，都离目标更近。</span></article>
  <footer class="task-footer"><i></i><span id="task-summary">等待开启任务</span><b>一起完成今天的小目标</b></footer></section>
  <div class="event-toast" role="status"><span></span><strong></strong></div><canvas class="particles"></canvas>`;

const effects = new LiveEffects(
  root.querySelector<HTMLCanvasElement>(".particles")!,
);
const gate = sewing
  ? new PrisonGate(root.querySelector<HTMLCanvasElement>(".prison")!)
  : null;
const cursor = new ActionCursor();
const motion = sewing ? new SewingMotion() : null;
const sound = sewing ? new SewingAudio() : null;
const cloth = sewing
  ? new ClothCanvas(root.querySelector<HTMLCanvasElement>(".cloth-field")!)
  : null;
let gateSignature = "";
let workSignature = "";
let current: SceneFrameState | null = null;
let stateAt = performance.now();
let lastRound: string | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let impactTimer: ReturnType<typeof setTimeout> | undefined;
const done = new Set<string>();
const format = (value: number | string) =>
  typeof value === "string" && /^\d+$/.test(value)
    ? BigInt(value).toLocaleString("zh-CN")
    : Math.floor(Number(value)).toLocaleString("zh-CN");
function accent() {
  return String(current?.settings.accent ?? "#efc982");
}
function burstAt(node: Element, amount = 80, color = accent(), thread = false) {
  const r = node.getBoundingClientRect();
  effects.burst(
    r.left + r.width / 2,
    r.top + r.height / 2,
    color,
    amount,
    thread,
  );
}
function needleBurst(amount: number, color = accent()) {
  const r = root.querySelector(".machine")!.getBoundingClientRect();
  effects.burst(
    r.left + (r.width * 215) / 900,
    r.top + (r.height * 447) / 640,
    color,
    amount,
    true,
  );
}
function toast(label: string, value: string, negative = false) {
  const el = root.querySelector<HTMLElement>(".event-toast")!;
  el.classList.remove("show");
  el.querySelector("span")!.textContent = label;
  el.querySelector("strong")!.textContent = value;
  el.dataset.negative = String(negative);
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2300);
}
function impact(kind: string) {
  root.dataset.impact = kind;
  clearTimeout(impactTimer);
  impactTimer = setTimeout(() => {
    delete root.dataset.impact;
  }, 1500);
}
function renderWork(actions: GameAction[] = []) {
  if (!motion || !current) return;
  const view = motion.sample(performance.now());
  sound!.update(current, actions, view, performance.now());
  const signature = `${current.game.round?.id}:${current.status}:${view.count}:${view.target}:${view.work}:${view.complete}:${view.finishedLoad}:${current.settings.bars}`;
  if (signature === workSignature) return;
  workSignature = signature;
  root.dataset.work = view.work;
  root.dataset.finished = String(view.complete);
  root.dataset.counterTarget = view.target.toString();
  const counter = root.querySelector("#stitch-count")!;
  const text = format(view.count.toString());
  if (counter.textContent !== text) counter.textContent = text;
  counter.setAttribute("font-size", text.length > 11 ? "20" : "32");
  if (text.length > 11) {
    counter.setAttribute("textLength", "172");
    counter.setAttribute("lengthAdjust", "spacingAndGlyphs");
  } else {
    counter.removeAttribute("textLength");
    counter.removeAttribute("lengthAdjust");
  }
  root.querySelector("#work-label")!.textContent =
    current.status === "paused"
      ? "已暂停"
      : current.status === "stopped"
        ? "已停止"
        : view.work === "sewing"
          ? current.game.round?.status === "won"
            ? "正在完成最后一单"
            : "加速缝制中"
          : view.work === "supply"
            ? "新订单 · 布料入库"
            : view.work === "overdrive"
              ? "机器过载"
              : view.complete
                ? view.target === 0n
                  ? "订单完成 · 等候新订单"
                  : "时间到 · 等候新订单"
                : "待机 · 等候缝制";
  for (const fold of root.querySelectorAll<SVGElement>(".finished-fold"))
    fold.style.opacity = String(
      Math.max(
        0,
        Math.min(1, view.finishedLoad * 4 - Number(fold.dataset.fold)),
      ),
    );
  (root.querySelector(".fabric") as SVGElement).style.opacity =
    view.count > 0n || view.work === "sewing" ? "1" : "0";
  (root.querySelector(".fabric-stitches") as SVGElement).style.opacity =
    view.finishedLoad > 0 || view.work === "sewing" ? "1" : "0";
  const bars = current.settings.bars !== false;
  const gateState = `${bars}:${view.complete}`;
  if (gateState !== gateSignature) {
    const sameRound = lastRound === (current.game.round?.id ?? null);
    gate!.update(bars, view.complete, sameRound);
    gateSignature = gateState;
  }
}
const unsubscribe = scene.subscribe((state) => {
  const sameRound = lastRound === (state.game.round?.id ?? null);
  current = state;
  stateAt = performance.now();
  document.body.dataset.theme = state.theme;
  root.style.setProperty("--text", String(state.settings.color ?? "#ffffff"));
  root.style.setProperty(
    "--accent",
    String(state.settings.accent ?? "#efc982"),
  );
  root.dataset.status = state.status;
  root.dataset.soft = String(state.settings.intensity === "soft");
  root.querySelector("h1")!.textContent = String(
    state.settings.title ?? state.name,
  );
  root.querySelector("#mode-status")!.textContent =
    state.status === "running"
      ? state.game.round?.status === "won"
        ? "等待新订单"
        : state.mode === "demo"
          ? "试玩中"
          : "直播中"
      : (
          {
            idle: "尚未启动",
            paused: "已暂停",
            stopped: "已停止",
            won: "挑战完成",
          } as const
        )[state.status];
  if (!sameRound) {
    done.clear();
    clearTimeout(toastTimer);
    clearTimeout(impactTimer);
    delete root.dataset.impact;
    root.querySelector(".event-toast")!.classList.remove("show");
    gateSignature = "";
  }
  const freshActions = cursor.consume(state.game);
  const actions =
    state.status === "running" || state.status === "won" ? freshActions : [];
  if (sewing) {
    const now = performance.now();
    motion!.sync(state, actions, now);
    const lastChange = [...actions].reverse().find((a) => a.before !== a.after);
    cloth!.update(
      BigInt(state.game.round?.remaining ?? "1"),
      state.theme,
      lastChange
        ? {
            before: lastChange.before,
            after: lastChange.after,
            duration: motion!.sample(now).duration,
          }
        : undefined,
      state.status === "paused" ||
        state.status === "stopped" ||
        state.status === "idle",
    );
    renderWork(actions);
  } else {
    root.dataset.panel = String(state.settings.panel !== false);
    root.querySelector("#score-title")!.textContent = String(
      state.settings.scoreTitle ?? "心愿进度",
    );
    (root.querySelector(".score-meter") as HTMLElement).hidden =
      state.settings.scoreVisible === false;
    let complete = 0,
      visible = 0;
    for (const meter of root.querySelectorAll<HTMLElement>(".task-meter")) {
      const key = meter.dataset.metric!,
        goal = Math.max(1, Number(state.settings[meter.dataset.goal!] ?? 1));
      const value = state.variables?.[key] ?? 0,
        percent = Math.min(100, (value / goal) * 100);
      meter.querySelector(".meter-number strong")!.textContent = format(value);
      meter.querySelector(".meter-number small span")!.textContent =
        format(goal);
      meter.querySelector(".percent")!.textContent = `${Math.floor(percent)}%`;
      (meter.querySelector(".meter-fill") as HTMLElement).style.width =
        `${percent}%`;
      const track = meter.querySelector(".meter-track")!;
      track.setAttribute("aria-valuenow", String(Math.min(value, goal)));
      track.setAttribute("aria-valuemax", String(goal));
      meter.dataset.done = String(value >= goal);
      meter.querySelector(".goal-status")!.textContent =
        value >= goal
          ? "目标达成"
          : key === "score"
            ? "每一份支持，都离目标更近。"
            : "进行中";
      if (!meter.hidden) {
        visible++;
        if (value >= goal) complete++;
      }
      if (value >= goal) {
        if (
          !done.has(key) &&
          sameRound &&
          state.status === "running" &&
          !meter.hidden
        )
          burstAt(meter, 95);
        done.add(key);
      } else done.delete(key);
    }
    root.querySelector("#task-summary")!.textContent =
      state.status === "idle"
        ? "等待开启任务"
        : `${complete} / ${visible} 项任务已完成`;
  }
  for (const action of actions) {
    const id = action.eventId ?? "";
    const value = action.value ?? "1";
    const negative = id.includes("remove") || BigInt(action.delta) < 0n;
    const isTime = id.startsWith("time-"),
      isMultiply = id.includes("multiply");
    const isClear = id === "release" || id === "score-reset";
    const delta = BigInt(action.after) - BigInt(action.before);
    if (sewing && (delta !== 0n || id === "release")) {
      const soft = state.settings.intensity === "soft";
      if (delta > 0n) {
        for (const x of [0.2, 0.5, 0.8])
          effects.burst(
            innerWidth * x,
            innerHeight * 0.3,
            accent(),
            soft ? 12 : 90,
            true,
          );
        impact("supply");
      } else {
        needleBurst(soft ? 20 : 160, "#d1f5ff");
        impact("cut");
      }
      toast(
        id === "release"
          ? "一键完工"
          : id === "stitch-multiply"
            ? "订单翻倍"
            : delta > 0n
              ? "追加订单"
              : "加速缝制",
        id === "release"
          ? "全部收工"
          : `${delta > 0n ? "+" : "−"}${format((delta < 0n ? -delta : delta).toString())}块`,
        delta < 0n,
      );
      continue;
    }
    toast(
      action.eventName ?? "礼物已触发",
      isClear
        ? id === "release"
          ? "下班啦"
          : "归零"
        : `${isMultiply ? "×" : negative ? "−" : "+"}${format(value)}${isTime && !isMultiply ? "秒" : ""}`,
      negative,
    );
    const amount = state.settings.intensity === "soft" ? 25 : 100;
    const color = negative ? "#b8eaff" : accent();
    if (sewing && !isTime) needleBurst(amount, color);
    else
      burstAt(
        root.querySelector(
          sewing ? ".timer-card" : ".score-meter:not([hidden])",
        ) ?? root.querySelector(".task-board")!,
        amount,
        color,
        sewing,
      );
    if (sewing && isTime) continue;
    impact(
      id === "release"
        ? "release"
        : id === "overdrive"
          ? "overdrive"
          : negative
            ? "cut"
            : "stitch",
    );
  }
  lastRound = state.game.round?.id ?? null;
  updateTimer();
});
function updateTimer() {
  if (!sewing || !current) return;
  const seconds = Math.max(
    0,
    Math.ceil(
      (current.variables?.seconds ??
        Number(current.settings.duration ?? 1800)) -
        (current.status === "running" && current.game.round?.status !== "won"
          ? (performance.now() - stateAt) / 1000
          : 0),
    ),
  );
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor(seconds / 60) % 60;
  root.querySelector("#timer")!.textContent =
    `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
const timerInterval = setInterval(updateTimer, 200);
const workInterval = sewing ? setInterval(renderWork, 50) : undefined;
const needleInterval = setInterval(() => {
  if (current && motion?.sample(performance.now()).work === "sewing")
    needleBurst(current.settings.intensity === "soft" ? 1 : 3);
}, 150);
window.addEventListener(
  "pagehide",
  () => {
    current = null;
    unsubscribe();
    clearInterval(timerInterval);
    clearInterval(workInterval);
    clearInterval(needleInterval);
    clearTimeout(toastTimer);
    clearTimeout(impactTimer);
    cloth?.dispose();
    sound?.dispose();
  },
  { once: true },
);
