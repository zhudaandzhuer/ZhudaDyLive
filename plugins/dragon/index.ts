import { scene } from "../../streamingClient/packages/plugin-sdk/src/index";
import type { SceneFrameState } from "../../streamingClient/packages/contracts/src/index";
import { sequenceAt } from "./sequences";
import { DuelFilms } from "./video-player";
import { StatFeedback } from "./stat-feedback";
import { battlePresentation, applyBattleSkin } from "./presentation";

const root = document.querySelector<HTMLElement>("#arena")!;
const number = (n: number) =>
  n >= 100000
    ? `${(n / 10000).toFixed(1)}万`
    : Math.round(n).toLocaleString("zh-CN");
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let state: SceneFrameState | null = null;
let received = performance.now();
let roundId = "";
let lastActionSeq = 0;
const feedback = new StatFeedback(root, number);
const guide = document.body.dataset.instructions === "true";
if (!guide) {
  root.style.setProperty("--media-aspect", battlePresentation.mediaAspectRatio);
  root.innerHTML = `
  <section class="battle-stage" aria-label="战斗画面">
    <div class="world"><img class="poster" src="${battlePresentation.poster}" alt="猪大与恶龙在仙山对峙"></div>
  </section>
  <section class="scoreboard" aria-label="双方数值">
    <div class="countdown" role="timer" aria-label="下一次交锋倒计时"><svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="73"/><circle id="clock-ring" cx="80" cy="80" r="73"/></svg><strong id="seconds">20</strong></div>
    <div class="teams">${(["hero", "dragon"] as const)
      .map((side) => {
        const team = battlePresentation.teams[side];
        return `<article class="team ${side}"><img class="team-art" src="${team.art}" alt="" aria-hidden="true"><header><div><span>${team.camp}</span><h2>${team.name}</h2></div></header><div class="health-caption" data-stat="${side}Health"><span>生命</span><b id="${side}-hp"><span id="${side}-hp-current"></span> / <span id="${side}-hp-max"></span></b></div><div class="health-track" role="progressbar" aria-label="${team.name}生命"><div id="${side}-bar"></div></div><div class="attributes">${[
          ["Attack", "攻击", "✦"],
          ["Defense", "防御", "◇"],
          ["Speed", "速度", "↗"],
        ]
          .map(
            ([stat, label, icon]) =>
              `<div data-stat="${side}${stat}"><small>${icon} ${label}</small><b id="${side}-${stat}"></b><em id="${side}-${stat}-boost"></em></div>`,
          )
          .join("")}</div></article>`;
      })
      .join("")}</div>
  </section>`;
}
const set = (id: string, text: string) => {
  const el = document.getElementById(id)!;
  if (el.textContent !== text) el.textContent = text;
};
function renderGuide(s: SceneFrameState) {
  const mappings = s.instructions?.mappings ?? [];
  root.innerHTML = `<section class="instructions"><span class="chapter">ZHUDA × DRAGON</span><h1>选一方，积蓄力量</h1><p>送礼提升属性，倒计时后自动交锋</p><div class="mapping-columns">${(
    ["hero", "dragon"] as const
  )
    .map(
      (side) =>
        `<article class="mapping-camp ${side}"><h2>${side === "hero" ? "守护猪大" : "支持恶龙"}</h2>${
          mappings
            .filter((m) => m.eventId.startsWith(side + "-"))
            .map(
              (m) =>
                `<div class="mapping">${m.icon ? `<img src="${escape(m.icon)}" alt="">` : ""}<div><b>${escape(m.giftName)}</b><span>${escape(m.label)} +${number(m.amount)}${escape(m.unit)}</span></div></div>`,
            )
            .join("") || "<p>请在礼物事件设置中添加映射</p>"
        }</article>`,
    )
    .join(
      "",
    )}</div><footer>生命礼物增加上限并回血 · 攻防速度加成在交战后部分保留</footer></section>`;
}
const films =
  guide || !battlePresentation.filmsEnabled
    ? null
    : new DuelFilms(document.querySelector<HTMLElement>(".world")!, root);
function update(s: SceneFrameState) {
  const previous = state;
  state = s;
  received = performance.now();
  if (guide) {
    renderGuide(s);
    return;
  }
  applyBattleSkin(root, s.settings);
  const b = s.battle;
  const id = s.game.round?.id ?? "";
  const reset = !previous || id !== roundId;
  const actionSeq = Math.max(
    s.game.lastAction?.seq ?? 0,
    ...s.game.recent.map((a) => a.seq ?? 0),
  );
  const gains = new Map<string, number>();
  if (reset) {
    roundId = id;
    feedback.reset();
  } else {
    for (const action of s.game.recent) {
      if ((action.seq ?? 0) <= lastActionSeq || action.roundId !== id) continue;
      const match = /^(hero|dragon)-(health|attack|defense|speed)$/.exec(
        action.eventId ?? "",
      );
      if (!match) continue;
      const key = `${match[1]}${match[2]![0]!.toUpperCase()}${match[2]!.slice(1)}`;
      const amount = Number(action.value ?? 0);
      if (Number.isFinite(amount) && amount > 0)
        gains.set(key, (gains.get(key) ?? 0) + amount);
    }
  }
  lastActionSeq = actionSeq;
  const values = s.variables ?? {};
  for (const side of ["hero", "dragon"] as const) {
    const fighter = b?.[side] ?? {
      hp: Number(
        s.settings[`${side}Health`] ?? (side === "hero" ? 2400 : 3600),
      ),
      maxHp: Number(
        s.settings[`${side}Health`] ?? (side === "hero" ? 2400 : 3600),
      ),
    };
    const healthGain = reset
      ? 0
      : Math.max(
          0,
          fighter.maxHp - (previous?.battle?.[side].maxHp ?? fighter.maxHp),
        );
    feedback.set(
      `${side}Hp`,
      fighter.hp,
      (value) => set(`${side}-hp-current`, number(value)),
      healthGain > 0,
    );
    feedback.set(
      `${side}Health`,
      fighter.maxHp,
      (value) => set(`${side}-hp-max`, number(value)),
      healthGain > 0,
    );
    if (gains.has(`${side}Health`)) feedback.gain(`${side}Health`, healthGain);
    document.getElementById(`${side}-bar`)!.style.width =
      `${fighter.maxHp ? (fighter.hp / fighter.maxHp) * 100 : 0}%`;
    const track = document.getElementById(`${side}-bar`)!.parentElement!;
    track.setAttribute("aria-valuemax", String(fighter.maxHp));
    track.setAttribute("aria-valuenow", String(fighter.hp));
    track.setAttribute("aria-valuemin", "0");
    for (const stat of ["Attack", "Defense", "Speed"] as const) {
      const key = `${side}${stat}`;
      const value = values[key] ?? Number(s.settings[key] ?? 0);
      const base = Number(s.settings[key] ?? value);
      // A new clash consumes boosts before gifts are applied; its locked inputs identify that boundary.
      const consumed =
        b?.lastClash && b.lastClash.atMs !== previous?.battle?.lastClash?.atMs;
      const before = consumed
        ? base +
          Math.floor(
            Math.max(
              0,
              b.lastClash![side][
                stat.toLowerCase() as "attack" | "defense" | "speed"
              ] - base,
            ) * b.retention,
          )
        : (previous?.variables?.[key] ?? value);
      const gain = Math.min(gains.get(key) ?? 0, Math.max(0, value - before));
      feedback.set(
        key,
        value,
        (shown) => {
          set(`${side}-${stat}`, number(shown));
          const boost = Math.max(0, shown - base);
          set(`${side}-${stat}-boost`, boost ? `+${number(boost)}` : "基础");
        },
        gain > 0,
      );
      feedback.gain(key, gain);
    }
  }
  root.dataset.finished = String(b?.phase === "finished");
  films?.sync(sequenceAt(s, s.playbackTime * 1000));
}
function animate() {
  feedback.tick(performance.now());
  if (state && !guide) {
    const b = state.battle;
    const time =
      state.playbackTime * 1000 +
      (state.status === "running" ? performance.now() - received : 0);
    films?.sync(sequenceAt(state, time));
    const left = b ? Math.max(0, b.nextAtMs - time) : 20000;
    const clock = document.querySelector<HTMLElement>(".countdown")!;
    clock.hidden =
      !b ||
      b.phase !== "prepare" ||
      !["running", "paused"].includes(state.status);
    set("seconds", String(Math.ceil(left / 1000)).padStart(2, "0"));
    const ratio =
      b?.phase === "clash" ? left / b.clashMs : left / (b?.prepMs ?? 20000);
    document.getElementById("clock-ring")!.style.strokeDashoffset = String(
      459 * (1 - Math.max(0, Math.min(1, ratio))),
    );
    root.dataset.urgent = String(
      b?.phase === "prepare" && left <= 5000 && state.status === "running",
    );
    root.dataset.battling = String(
      b?.phase === "clash" && state.status === "running",
    );
  }
  requestAnimationFrame(animate);
}
scene.subscribe(update);
requestAnimationFrame(animate);
