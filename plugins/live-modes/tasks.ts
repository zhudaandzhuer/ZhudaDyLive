import { scene } from "../../streamingClient/packages/plugin-sdk/src/index";
import { ActionCursor } from "../../streamingClient/games/shared/actions";
import { LiveEffects } from "./effects";
import { taskMetrics } from "./task-metrics";

const root = document.getElementById("mode")!;
const source = document.body.dataset.source;
const metrics =
  source === "tasks" ? taskMetrics : taskMetrics.filter((m) => m.id === source);
root.innerHTML = `<div class="progress-objects">${metrics
  .map(
    (m) => `
  <article class="task-meter" data-metric="${m.key}" data-goal="${m.goal}">
    <div class="meter-heading"><div class="meter-label"><span class="meter-icon" aria-hidden="true">${m.icon}</span><h2>${m.label}</h2></div>
      <div class="meter-number"><strong>0</strong><small> / <span>${m.initialGoal}</span></small></div></div>
    <div class="meter-track" role="progressbar" aria-label="${m.label}" aria-valuemin="0"><div class="meter-fill"></div><span class="percent">0%</span><span class="check" aria-label="目标达成">✓</span></div>
  </article>`,
  )
  .join("")}</div><canvas class="particles"></canvas>`;
const effects = new LiveEffects(root.querySelector("canvas")!);
const cursor = new ActionCursor();
let round: string | null = null;
const values = new Map<string, number>();
const completed = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const format = (value: number) => Math.floor(value).toLocaleString("zh-CN");
function celebrate(meter: HTMLElement, color: string) {
  const r = meter.querySelector(".meter-track")!.getBoundingClientRect();
  for (const x of [0.25, 0.65, 0.9])
    effects.burst(r.left + r.width * x, r.top + r.height / 2, color, 28);
}
const unsubscribe = scene.subscribe((state) => {
  const sameRound = round === (state.game.round?.id ?? null);
  if (!sameRound) {
    values.clear();
    completed.clear();
  }
  round = state.game.round?.id ?? null;
  const color = String(state.settings.accent ?? "#ff9cc8");
  root.style.setProperty("--accent", color);
  root.style.setProperty("--text", String(state.settings.color ?? "#ffffff"));
  root.dataset.status = state.status;
  root.dataset.theme = state.theme;
  const actions = cursor.consume(state.game);
  for (const metric of metrics) {
    const meter = root.querySelector<HTMLElement>(
      `[data-metric="${metric.key}"]`,
    )!;
    const label = String(state.settings[metric.title] ?? metric.label);
    const value = Math.max(0, state.variables?.[metric.key] ?? 0);
    const goal = Math.max(
      1,
      Number(state.settings[metric.goal] ?? metric.initialGoal),
    );
    const percent = Math.max(0, Math.min(100, (value / goal) * 100));
    const done = value >= goal;
    meter.hidden =
      metric.key === "score" && state.settings.scoreVisible === false;
    meter.querySelector("h2")!.textContent = label;
    meter.querySelector(".meter-number strong")!.textContent = format(value);
    meter.querySelector(".meter-number small span")!.textContent = format(goal);
    meter.dataset.numberSize =
      format(value).length + format(goal).length > 19 ? "compact" : "normal";
    meter.querySelector<HTMLElement>(".meter-fill")!.style.width =
      `${percent}%`;
    const percentNode = meter.querySelector<HTMLElement>(".percent")!;
    percentNode.textContent = `${Math.floor(percent)}%`;
    percentNode.hidden = state.settings.showPercent === false;
    const track = meter.querySelector(".meter-track")!;
    track.setAttribute("aria-label", label);
    track.setAttribute("aria-valuenow", String(Math.min(value, goal)));
    track.setAttribute("aria-valuemax", String(goal));
    track.setAttribute(
      "aria-valuetext",
      `${format(value)} / ${format(goal)}，${done ? "目标达成" : Math.floor(percent) + "%"}`,
    );
    meter.dataset.done = String(done);
    if (
      sameRound &&
      state.status === "running" &&
      state.settings.celebration !== false &&
      !meter.hidden &&
      ((done && !completed.has(metric.key)) ||
        actions.some((a) => a.eventId === "celebrate"))
    )
      celebrate(meter, color);
    if (done) completed.add(metric.key);
    else completed.delete(metric.key);
    if (
      sameRound &&
      values.has(metric.key) &&
      values.get(metric.key) !== value
    ) {
      clearTimeout(timers.get(metric.key));
      meter.classList.remove("changed");
      void meter.offsetWidth;
      meter.classList.add("changed");
      timers.set(
        metric.key,
        setTimeout(() => meter.classList.remove("changed"), 650),
      );
    }
    values.set(metric.key, value);
  }
});
window.addEventListener(
  "pagehide",
  () => {
    unsubscribe();
    for (const timer of timers.values()) clearTimeout(timer);
  },
  { once: true },
);
