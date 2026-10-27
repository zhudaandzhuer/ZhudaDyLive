import type { ArenaPlayer } from "./engine";
import type { ArenaViewState, ArenaInputStatus, ArenaGiftOption } from "./host";
import { attacksPerSecond, rankPlayers, SURVIVAL_ROUND_MS } from "./engine";
import { colors, scenery, worldArtwork } from "./artwork";

if (location.pathname === "/output") document.body.classList.add("output");
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const ns = "http://www.w3.org/2000/svg";
const svg = (tag: string, attributes: Record<string, string | number> = {}) => {
  const element = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, String(value));
  return element;
};
const world = document.getElementById("world") as unknown as SVGSVGElement;
world.innerHTML = worldArtwork;
const terrain = svg("g");
for (const item of scenery)
  terrain.append(
    svg("use", {
      href: `#${item.type}`,
      x: item.x - item.width / 2,
      y: item.y - item.height + 15,
      width: item.width,
      height: item.height,
    }),
  );
world.append(terrain);
const units = svg("g");
const particles = svg("g");
world.append(units, particles);
const nodes = new Map<
  string,
  { root: SVGElement; body: SVGElement; hp: SVGElement; name: SVGElement }
>();
const rows = new Map<string, HTMLElement>();
const miniNodes = new Map<string, SVGElement>();
let state: ArenaViewState | null = null;
let previous: ArenaViewState | null = null;
let receivedAt = performance.now();
let selectedId = "";
let effectCursor = 0;
let camera = { x: 1280, y: 1280 };
let lastFrame = performance.now();
let frames = 0;
let fpsAt = lastFrame;
const cameraSize = 680;
const bubbles: {
  node: SVGElement;
  born: number;
  x: number;
  y: number;
  life: number;
}[] = [];

function nodeFor(player: ArenaPlayer) {
  let node = nodes.get(player.id);
  if (node) return node;
  const root = svg("g", { class: "unit" });
  root.append(
    svg("ellipse", { class: "selection-ring", cx: 0, cy: 12, rx: 23, ry: 12 }),
    svg("ellipse", { class: "aura", cx: 0, cy: -6, rx: 26, ry: 34 }),
  );
  const body = svg("g", { class: "body" });
  body.append(
    svg("use", { href: "#fighter", x: -29, y: -55, width: 67, height: 77 }),
  );
  const name = svg("text", { y: -72, class: "fighter-name" });
  const hp = svg("rect", {
    x: -22,
    y: -64,
    width: 44,
    height: 4,
    rx: 2,
    class: "health-fill",
  });
  root.append(
    body,
    name,
    svg("rect", {
      x: -23,
      y: -65,
      width: 46,
      height: 6,
      rx: 3,
      class: "health-bg",
    }),
    hp,
  );
  units.append(root);
  node = { root, body, hp, name };
  nodes.set(player.id, node);
  return node;
}
function choose(id: string, syncInput = true) {
  selectedId = id;
  const actor = state?.players.find((p) => p.id === id);
  if (actor) {
    if (syncInput) $<HTMLInputElement>("sender-name").value = actor.name;
    $("selection").textContent =
      `${actor.name} · 力量 ${actor.strength} · 攻速 ${attacksPerSecond(actor.agility).toFixed(2)}/秒 · 生命 ${actor.hp}/${actor.maxHp}`;
  }
  const select = $<HTMLSelectElement>("sender");
  if (select) select.value = id;
}
function receive(next: ArenaViewState) {
  const changed = state && next.instanceId !== state.instanceId;
  if (changed || (state && next.time < state.time)) {
    showingLive = next.input.mode === "live";
    for (const bubble of bubbles) bubble.node.remove();
    bubbles.length = 0;
    effectCursor = 0;
    for (const node of nodes.values()) node.root.remove();
    for (const row of rows.values()) row.remove();
    for (const dot of miniNodes.values()) dot.remove();
    nodes.clear();
    rows.clear();
    miniNodes.clear();
    $<HTMLSelectElement>("sender").replaceChildren();
    selectedId = "";
    $("selection").textContent = "选择玩家查看属性";
    camera = { x: 1280, y: 1280 };
  }
  previous = changed ? null : state;
  state = next;
  updateInput(next.input);
  receivedAt = performance.now();
  const alive = rankPlayers(next.players, next.time);
  const targetId = next.focus?.playerId ?? next.leaderId;
  const target = next.players.find((p) => p.id === targetId);
  $("alive-count").textContent = `${alive.length} 人`;
  $("world-status").textContent =
    `${next.paused ? "已暂停" : "自动混战"} · ${Math.floor(next.time / 60000)
      .toString()
      .padStart(2, "0")}:${Math.floor((next.time / 1000) % 60)
      .toString()
      .padStart(2, "0")}`;
  $("camera-label").textContent = target
    ? `${next.focus ? "抢镜" : "生存第一"} · ${target.name}${next.focus ? ` · ${Math.max(0, (next.focus.until - next.time) / 1000).toFixed(1)}s` : ""}`
    : "等待玩家";
  $("empty").hidden = alive.length > 0;
  const select = $<HTMLSelectElement>("sender");
  for (const p of next.players) {
    let option = Array.from(select.options).find((o) => o.value === p.id);
    if (!option) {
      option = new Option(p.name, p.id);
      select.add(option);
    }
    option.textContent = `${p.name}${p.diedAt !== null ? "（已阵亡）" : ""}`;
  }
  if (!selectedId && alive[0]) choose(alive[0].id);
  else if (selectedId) choose(selectedId, false);
  for (const [index, p] of alive.entries()) {
    let row = rows.get(p.id);
    if (!row) {
      row = document.createElement("div");
      row.className = "player-row";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.innerHTML =
        '<span class="rank-number"></span><div class="player-info"><span class="player-name"></span><div class="player-meta"><span></span><span></span></div><div class="hp-track"><i></i></div><div class="player-stats"></div></div>';
      row.onclick = () => choose(p.id);
      row.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose(p.id);
        }
      };
      rows.set(p.id, row);
    }
    row.classList.toggle("camera", p.id === targetId);
    row.classList.toggle("selected", p.id === selectedId);
    row.setAttribute("aria-label", `选择 ${p.name} 试送礼物`);
    row.querySelector(".rank-number")!.textContent = (index + 1)
      .toString()
      .padStart(2, "0");
    row.querySelector(".player-name")!.textContent = p.name;
    const meta = row.querySelectorAll(".player-meta span");
    meta[0]!.textContent = `${Math.floor((next.time - p.bornAt) / SURVIVAL_ROUND_MS)} 轮`;
    meta[1]!.textContent = `${p.kills} 击败`;
    (row.querySelector(".hp-track i") as HTMLElement).style.width =
      `${(p.hp / p.maxHp) * 100}%`;
    row.querySelector(".player-stats")!.textContent =
      `力 ${p.strength} / 敏 ${p.agility} / 血 ${p.hp}`;
    // Only move a row if its rank actually changes; preserve scroll position and focused controls.
    const container = $("players");
    if (container.children[index] !== row)
      container.insertBefore(row, container.children[index] ?? null);
  }
  for (const [id, row] of rows)
    if (!alive.some((p) => p.id === id)) {
      row.remove();
      rows.delete(id);
    }
  const mini = document.getElementById("minimap-players")!;
  for (const p of alive) {
    let dot = miniNodes.get(p.id);
    if (!dot) {
      dot = svg("circle", { r: 24 });
      miniNodes.set(p.id, dot);
      mini.append(dot);
    }
    dot.setAttribute("cx", String(p.x));
    dot.setAttribute("cy", String(p.y));
    dot.setAttribute("fill", p.id === targetId ? "#fff4c5" : colors[p.color]!);
  }
  for (const [id, dot] of miniNodes)
    if (!alive.some((p) => p.id === id)) {
      dot.remove();
      miniNodes.delete(id);
    }
  for (const effect of next.effects) {
    if (effect.id <= effectCursor) continue;
    const p = next.players.find((actor) => actor.id === effect.playerId);
    // An opening/reconnecting viewer does not replay the world's old effects.
    if (
      p &&
      previous &&
      next.time - effect.at < 600 &&
      Math.hypot(p.x - camera.x, p.y - camera.y) < cameraSize
    ) {
      const node = svg("text", {
        class: `damage-number ${effect.kind === "buff" ? "buff-number" : ""}`,
      });
      node.textContent = effect.text;
      particles.append(node);
      bubbles.push({
        node,
        born: performance.now(),
        x: p.x,
        y: p.y - (effect.kind === "damage" ? 48 : 92),
        life: effect.kind === "damage" ? 900 : 1700,
      });
    }
    effectCursor = effect.id;
  }
  $("pause").textContent = next.paused ? "继续世界" : "暂停世界";
}
function render(now: number) {
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  if (state) {
    const targetId = state.focus?.playerId ?? state.leaderId;
    const target = state.players.find(
      (p) => p.id === targetId && p.diedAt === null,
    );
    const smoothing = 1 - Math.exp(-dt / 160);
    camera.x += ((target?.x ?? 1280) - camera.x) * smoothing;
    camera.y += ((target?.y ?? 1280) - camera.y) * smoothing;
    const x = Math.min(
      state.size - cameraSize,
      Math.max(0, camera.x - cameraSize / 2),
    );
    const y = Math.min(
      state.size - cameraSize,
      Math.max(0, camera.y - cameraSize / 2),
    );
    world.setAttribute("viewBox", `${x} ${y} ${cameraSize} ${cameraSize}`);
    const miniCamera = document.getElementById("minimap-camera")!;
    for (const [key, value] of Object.entries({
      x,
      y,
      width: cameraSize,
      height: cameraSize,
    }))
      miniCamera.setAttribute(key, String(value));
    const fraction = Math.min(1, (now - receivedAt) / 100);
    const visible = state.players
      .filter(
        (p) =>
          p.diedAt === null &&
          p.x > x - 90 &&
          p.x < x + cameraSize + 90 &&
          p.y > y - 90 &&
          p.y < y + cameraSize + 90,
      )
      .sort((a, b) => a.y - b.y);
    const oldPlayers = new Map(previous?.players.map((p) => [p.id, p]));
    const labels: { x: number; y: number; width: number }[] = [];
    for (const [index, p] of visible.entries()) {
      const old = oldPlayers.get(p.id);
      const sameLife = old && old.life === p.life;
      const px = sameLife ? old.x + (p.x - old.x) * fraction : p.x;
      const py = sameLife ? old.y + (p.y - old.y) * fraction : p.y;
      const node = nodeFor(p);
      const moving =
        sameLife && Math.hypot(p.x - old.x, p.y - old.y) > 1 && !state.paused;
      const bob = moving ? Math.sin(now / 90 + p.color) * 1.5 : 0;
      node.root.setAttribute(
        "transform",
        `translate(${px.toFixed(2)} ${py.toFixed(2)})`,
      );
      node.root.style.color = colors[p.color]!;
      node.root.classList.toggle("focused", p.id === targetId);
      node.root.classList.toggle("hit", state.time - p.hitAt < 180);
      node.root.classList.toggle("protected", state.time - p.bornAt < 2500);
      const swing = state.time - p.attackAt < 180 ? 5 : 0;
      node.body.setAttribute(
        "transform",
        `translate(${swing * p.facing} ${bob.toFixed(2)}) scale(${p.facing} 1)`,
      );
      node.hp.setAttribute("width", String((44 * p.hp) / p.maxHp));
      node.name.textContent = Array.from(p.name).slice(0, 9).join("");
      node.body.style.setProperty("--swing", swing ? "35deg" : "0deg");
      const labelWidth = Array.from(node.name.textContent).length * 22;
      let labelY = py - 76;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (
          !labels.some(
            (label) =>
              Math.abs(label.x - px) < (label.width + labelWidth) / 2 + 4 &&
              Math.abs(label.y - labelY) < 27,
          )
        )
          break;
        labelY -= 29;
      }
      labels.push({ x: px, y: labelY, width: labelWidth });
      node.name.setAttribute("y", String(labelY - py));
      if (units.children[index] !== node.root)
        units.insertBefore(node.root, units.children[index] ?? null);
    }
    const ids = new Set(visible.map((p) => p.id));
    for (const [id, node] of nodes)
      if (!ids.has(id)) {
        node.root.remove();
        nodes.delete(id);
      }
  }
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const bubble = bubbles[i]!;
    const progress = (now - bubble.born) / bubble.life;
    if (progress > 1) {
      bubble.node.remove();
      bubbles.splice(i, 1);
      continue;
    }
    bubble.node.setAttribute("x", String(bubble.x));
    bubble.node.setAttribute("y", String(bubble.y - progress * 35));
    bubble.node.setAttribute(
      "opacity",
      String(Math.min(1, (1 - progress) * 3)),
    );
  }
  frames++;
  if (now - fpsAt > 1000) {
    $("fps").textContent =
      `${Math.round((frames * 1000) / (now - fpsAt))} FPS · ${nodes.size} 个可见角色`;
    frames = 0;
    fpsAt = now;
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
const events = new EventSource("/events");
events.onmessage = (event) => {
  receive(JSON.parse(event.data));
  $("connection").textContent =
    state?.input.mode === "live" ? "真实直播世界" : "本机模拟世界";
};
events.onerror = () => {
  $("connection").textContent = "连接中断，正在重连";
};

let sessionToken: Promise<string> | null = null;
async function send(path: string, payload: unknown) {
  sessionToken ??= fetch("/session")
    .then((response) => response.json())
    .then((result) => result.token);
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Arena-Token": await sessionToken,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "操作失败");
  return result;
}
let showingLive = false;
let catalogLoaded = false;
let catalogPending = false;
let receiptKey = "";
async function loadCatalog() {
  if (catalogLoaded || catalogPending) return;
  catalogPending = true;
  try {
    const response = await fetch("/catalog");
    if (!response.ok) throw new Error("官方礼物目录加载失败");
    const catalog: ArenaGiftOption[] = await response.json();
    if (!catalog.length) return;
    for (const [id, suggested] of [
      ["join-gift", "人气票"],
      ["focus-gift", "小心心"],
    ]) {
      const select = $<HTMLSelectElement>(id!);
      const previousValue = select.value;
      const fragment = document.createDocumentFragment();
      fragment.append(new Option("请选择礼物", ""));
      for (const gift of catalog)
        fragment.append(new Option(`${gift.name} · ${gift.id}`, gift.id));
      select.replaceChildren(fragment);
      select.value =
        previousValue ||
        catalog.find((gift) => gift.name === suggested)?.id ||
        "";
    }
    catalogLoaded = true;
  } catch (error) {
    $("input-status").textContent = (error as Error).message;
  } finally {
    catalogPending = false;
  }
}
function updateInput(input: ArenaInputStatus) {
  if (input.mode === "live") showingLive = true;
  $("live-settings").hidden = !showingLive;
  $("simulation-tools").hidden = showingLive;
  $("live-mode").classList.toggle("active", showingLive);
  $("demo-mode").classList.toggle("active", !showingLive);
  $<HTMLButtonElement>("live-mode").disabled = !input.available;
  $<HTMLButtonElement>("attach-live").disabled = input.state !== "connected";
  $("attach-live").textContent = input.attached
    ? "重新接入当前直播间"
    : "接入当前直播间";
  $("input-status").textContent = !input.available
    ? "模拟试玩。真实礼物入口请从工作台启动。"
    : input.state !== "connected"
      ? "请在工作台连接直播间，游戏会自动等待"
      : input.mode === "live" && input.attached
        ? `直播间 ${input.webId} · 已接入真实礼物`
        : `直播间 ${input.webId} · 选择礼物后接入`;
  $("live-summary").textContent =
    input.mode === "live"
      ? `${input.message} · 生效 ${input.accepted} 笔 / 未生效 ${input.rejected} 笔`
      : "接入时会清空模拟玩家，只接收之后的新礼物。";
  void loadCatalog();
  const key = JSON.stringify(input.receipts);
  if (key !== receiptKey) {
    receiptKey = key;
    $("live-receipts").replaceChildren(
      ...input.receipts.map((receipt) => {
        const row = document.createElement("div");
        row.className = "live-receipt";
        const name = document.createElement("strong");
        name.textContent = `${receipt.name || "未知观众"} · ${receipt.gift || "未知礼物"} ×${receipt.quantity}`;
        const detail = document.createElement("span");
        detail.textContent = `${receipt.accepted ? "已生效" : "未生效"} · ${receipt.message}`;
        row.append(name, detail);
        return row;
      }),
    );
  }
}
$("live-mode").onclick = () => {
  showingLive = true;
  if (state) updateInput(state.input);
};
$("demo-mode").onclick = async () => {
  try {
    if (state?.input.mode === "live")
      await send("/control", { action: "demo" });
    showingLive = false;
    if (state) updateInput(state.input);
  } catch (error) {
    $("input-status").textContent = (error as Error).message;
  }
};
$("attach-live").onclick = async () => {
  try {
    await send("/control", {
      action: "live",
      joinGiftId: $<HTMLSelectElement>("join-gift").value,
      focusGiftId: $<HTMLSelectElement>("focus-gift").value,
    });
  } catch (error) {
    $("live-summary").textContent = (error as Error).message;
  }
};
function newPlayer() {
  selectedId = `player_${crypto.randomUUID().slice(0, 8)}`;
  const name = `新玩家${(state?.players.length ?? 0) + 1}`;
  const option = new Option(name, selectedId, true, true);
  $<HTMLSelectElement>("sender").add(option);
  $<HTMLInputElement>("sender-name").value = name;
}
$("new-player").onclick = newPlayer;
$<HTMLSelectElement>("sender").onchange = (event) =>
  choose((event.target as HTMLSelectElement).value);
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-gift]",
))
  button.onclick = async () => {
    try {
      if (!selectedId) newPlayer();
      const result = await send("/gift", {
        id: crypto.randomUUID(),
        senderId: selectedId,
        senderName: $<HTMLInputElement>("sender-name").value,
        kind: button.dataset.gift,
        quantity: Number($<HTMLInputElement>("quantity").value),
      });
      $("notice").textContent = result.message;
    } catch (error) {
      $("notice").textContent = (error as Error).message;
    }
  };
for (const [id, action] of [
  ["pause", "pause"],
  ["add-players", "add"],
  ["reset", "reset"],
])
  $(id!).onclick = async () => {
    try {
      await send("/control", { action });
    } catch (error) {
      $("notice").textContent = (error as Error).message;
    }
  };
