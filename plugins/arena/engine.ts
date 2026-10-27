/** Prototype authority. Runs once in Node; renderers never resolve combat or gifts. */
export type ArenaStat = "strength" | "agility" | "maxHp";
export interface ArenaPlayer {
  id: string;
  name: string;
  life: number;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  strength: number;
  agility: number;
  bornAt: number;
  diedAt: number | null;
  nextAttack: number;
  attackAt: number;
  hitAt: number;
  color: number;
  kills: number;
}
export interface ArenaGift {
  id: string;
  senderId: string;
  senderName: string;
  kind: "join" | "focus" | "buff";
  quantity: number;
}
export interface ArenaEffect {
  id: number;
  playerId: string;
  at: number;
  text: string;
  kind: "join" | "buff" | "damage" | "death";
}
export interface ArenaSnapshot {
  version: 1;
  time: number;
  paused: boolean;
  size: number;
  capacity: number;
  players: ArenaPlayer[];
  leaderId: string | null;
  focus: { playerId: string; until: number; eventId: string } | null;
  effects: ArenaEffect[];
}
const STEP_MS = 100;
export const ARENA_SIZE = 2560;
export const SURVIVAL_ROUND_MS = 30_000;
export function attacksPerSecond(agility: number) {
  return 1 + (2 * agility) / (agility + 40);
}
export function rankPlayers(players: ArenaPlayer[], now: number) {
  return players
    .filter((p) => p.diedAt === null)
    .sort((a, b) =>
      now - a.bornAt === now - b.bornAt
        ? b.kills - a.kills || a.id.localeCompare(b.id)
        : a.bornAt - b.bornAt,
    );
}
export class ArenaWorld {
  time = 0;
  paused = false;
  readonly players = new Map<string, ArenaPlayer>();
  focus: ArenaSnapshot["focus"] = null;
  private effects: ArenaEffect[] = [];
  private sequence = 0;
  private requests = new Map<string, string>();
  private accumulator = 0;
  constructor(
    private seed = 20261018,
    readonly capacity = 64,
  ) {}
  private random() {
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  private effect(playerId: string, kind: ArenaEffect["kind"], text: string) {
    this.effects.push({
      id: ++this.sequence,
      playerId,
      kind,
      text,
      at: this.time,
    });
    this.effects = this.effects.slice(-160);
  }
  gift(gift: ArenaGift) {
    if (
      !/^[a-zA-Z0-9_-]{1,100}$/.test(gift.id) ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(gift.senderId) ||
      !gift.senderName.trim() ||
      gift.senderName.length > 40 ||
      !["join", "focus", "buff"].includes(gift.kind) ||
      !Number.isSafeInteger(gift.quantity) ||
      gift.quantity < 1 ||
      gift.quantity > 1000
    )
      throw new Error("礼物参数无效");
    const fingerprint = JSON.stringify(gift);
    const previous = this.requests.get(gift.id);
    if (previous) {
      if (previous !== fingerprint) throw new Error("相同事件编号的内容不一致");
      return { accepted: false, message: "该事件已处理" };
    }
    if (this.requests.size >= 50_000)
      throw new Error("原型事件容量已满，请重置试玩");
    let player = this.players.get(gift.senderId);
    if ((!player || player.diedAt !== null) && gift.kind !== "join")
      throw new Error("尚未入场或已阵亡，请先赠送入场礼物");
    if (gift.kind === "join" && (!player || player.diedAt !== null)) {
      if (
        rankPlayers([...this.players.values()], this.time).length >=
        this.capacity
      )
        throw new Error("原型同时存活上限为 64 人");
      if (!player && this.players.size >= 512)
        throw new Error("原型玩家记录已满，请重置试玩");
      const angle = this.random() * Math.PI * 2;
      const radius = 150 + this.random() * 730;
      player = {
        id: gift.senderId,
        name: gift.senderName,
        life: (player?.life ?? 0) + 1,
        x: ARENA_SIZE / 2 + Math.cos(angle) * radius,
        y: ARENA_SIZE / 2 + Math.sin(angle) * radius,
        facing: 1,
        hp: 1000,
        maxHp: 1000,
        strength: 18,
        agility: 0,
        bornAt: this.time,
        diedAt: null,
        nextAttack: this.time + 2500,
        attackAt: -10_000,
        hitAt: -10_000,
        color: Math.floor(this.random() * 8),
        kills: 0,
      };
      this.players.set(player.id, player);
      this.effect(player.id, "join", "入场");
    }
    player!.name = gift.senderName;
    const gains = { strength: 0, agility: 0, maxHp: 0 };
    // Simulation units, not real gift prices. Each unit adds exactly one random stat point.
    for (let i = 0; i < gift.quantity; i++) {
      const stat = (["strength", "agility", "maxHp"] as const)[
        Math.floor(this.random() * 3)
      ]!;
      player![stat]++;
      if (stat === "maxHp") player!.hp++;
      gains[stat]++;
    }
    this.effect(
      player!.id,
      "buff",
      Object.entries(gains)
        .filter(([, count]) => count > 0)
        .map(
          ([key, count]) =>
            `${{ strength: "力量", agility: "敏捷", maxHp: "生命" }[key]} +${count}`,
        )
        .join(" · "),
    );
    if (gift.kind === "focus")
      this.focus = {
        playerId: player!.id,
        until: this.time + 2000,
        eventId: gift.id,
      };
    this.requests.set(gift.id, fingerprint);
    return {
      accepted: true,
      message: `${player!.name}：${gift.kind === "focus" ? "抢镜 2 秒，并获得加点" : "礼物已生效"}`,
    };
  }
  advance(ms: number) {
    if (this.paused) return;
    if (!Number.isFinite(ms) || ms < 0 || ms > 60_000)
      throw new Error("模拟时间步长无效");
    this.accumulator += ms;
    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      this.time += STEP_MS;
      this.step();
    }
  }
  private step() {
    const alive = [...this.players.values()].filter((p) => p.diedAt === null);
    const previous = alive.map((p) => ({ ...p }));
    const hits: { from: ArenaPlayer; to: ArenaPlayer; damage: number }[] = [];
    for (const old of previous) {
      const player = this.players.get(old.id)!;
      if (this.time - old.bornAt < 2500) continue;
      let target: ArenaPlayer | undefined;
      let distance = Infinity;
      for (const candidate of previous) {
        if (candidate.id === old.id || this.time - candidate.bornAt < 2500)
          continue;
        const d = Math.hypot(candidate.x - old.x, candidate.y - old.y);
        if (d < distance || (d === distance && candidate.id < target!.id)) {
          distance = d;
          target = candidate;
        }
      }
      if (!target) continue;
      player.facing = target.x >= old.x ? 1 : -1;
      if (distance > 48) {
        const move = Math.min(distance - 43, 9.2);
        player.x = old.x + ((target.x - old.x) / distance) * move;
        player.y = old.y + ((target.y - old.y) / distance) * move;
      } else if (this.time >= old.nextAttack) {
        player.attackAt = this.time;
        player.nextAttack = this.time + 1000 / attacksPerSecond(old.agility);
        hits.push({
          from: player,
          to: this.players.get(target.id)!,
          damage: old.strength,
        });
      }
    }
    // Resolve all strikes from one tick together; array order cannot cancel a lethal reply.
    const incoming = new Map<string, number>();
    for (const hit of hits)
      incoming.set(hit.to.id, (incoming.get(hit.to.id) ?? 0) + hit.damage);
    for (const [id, damage] of incoming) {
      const player = this.players.get(id)!;
      player.hp = Math.max(0, player.hp - damage);
      player.hitAt = this.time;
      this.effect(id, "damage", `−${damage}`);
      if (player.hp === 0) {
        player.diedAt = this.time;
        const attackers = hits.filter((hit) => hit.to.id === id);
        attackers.sort(
          (a, b) => b.damage - a.damage || a.from.id.localeCompare(b.from.id),
        );
        attackers[0]!.from.kills++;
        this.effect(id, "death", "本次生存结束");
      }
    }
    if (
      this.focus &&
      (this.time >= this.focus.until ||
        this.players.get(this.focus.playerId)?.diedAt !== null)
    )
      this.focus = null;
    this.effects = this.effects.filter((e) => this.time - e.at < 4000);
  }
  snapshot(): ArenaSnapshot {
    const players = [...this.players.values()];
    return structuredClone({
      version: 1,
      time: this.time,
      paused: this.paused,
      size: ARENA_SIZE,
      capacity: this.capacity,
      players,
      leaderId: rankPlayers(players, this.time)[0]?.id ?? null,
      focus: this.focus,
      effects: this.effects,
    });
  }
}
