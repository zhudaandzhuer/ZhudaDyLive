import { randomUUID } from "node:crypto";
import type { GiftEvent } from "../../streamingClient/packages/contracts/src/index";
import { ArenaWorld, type ArenaGift, type ArenaSnapshot } from "./engine";
import {
  ArenaLiveSession,
  type ArenaLiveSource,
  type ArenaLiveReceipt,
} from "./live";

export interface ArenaGiftOption {
  id: string;
  name: string;
  diamonds: number | null;
}
export interface ArenaInputStatus {
  available: boolean;
  mode: "demo" | "live";
  state: string;
  webId: string;
  attached: boolean;
  message: string;
  joinGiftId: string;
  focusGiftId: string;
  accepted: number;
  rejected: number;
  receipts: {
    at: string;
    name: string;
    gift: string;
    quantity: string;
    accepted: boolean;
    message: string;
  }[];
}
export interface ArenaViewState extends ArenaSnapshot {
  instanceId: string;
  input: ArenaInputStatus;
}
interface HostOptions {
  source?: () => ArenaLiveSource;
  catalog?: () => ArenaGiftOption[];
  now?: () => number;
}
const names = [
  "小鹿",
  "阿布",
  "一只泡芙",
  "星河",
  "番茄队长",
  "白桃",
  "阿橘",
  "山野",
  "绵绵",
  "小鱼",
  "木木",
  "晚风",
  "咕噜",
  "七七",
  "阿团",
  "奶盖",
  "追风",
  "小熊",
  "青柠",
  "阿夏",
  "豆包",
  "可乐",
  "荔枝",
  "北辰",
];

/** One authority for every preview. Live gifts enter here after the SQLite commit. */
export class ArenaHost {
  private world = new ArenaWorld();
  private instanceId = randomUUID();
  private session: ArenaLiveSession | null = null;
  private mode: "demo" | "live" = "demo";
  private demoCount = 0;
  private paused = false;
  private message = "当前使用模拟礼物";
  private accepted = 0;
  private rejected = 0;
  private receipts: ArenaInputStatus["receipts"] = [];
  constructor(private options: HostOptions = {}) {
    this.addPlayers(24);
  }
  private source(): ArenaLiveSource {
    return (
      this.options.source?.() ?? {
        state: "idle",
        webId: "",
        runId: "",
        sequence: "0",
      }
    );
  }
  catalog() {
    return (this.options.catalog?.() ?? []).map(({ id, name, diamonds }) => ({
      id,
      name,
      diamonds,
    }));
  }
  private reset() {
    this.world = new ArenaWorld();
    this.instanceId = randomUUID();
    this.session = null;
    this.demoCount = 0;
    this.paused = false;
    this.accepted = this.rejected = 0;
    this.receipts = [];
  }
  private sync() {
    const source = this.source();
    if (this.mode === "live") {
      if (
        this.session &&
        (source.webId !== this.session.binding.webId ||
          source.runId !== this.session.binding.runId)
      ) {
        this.reset();
        this.message = "直播连接批次已变化，请重新接入；旧世界已清空";
      }
      this.world.paused =
        this.paused || !this.session || source.state !== "connected";
    } else this.world.paused = this.paused;
    return source;
  }
  private addPlayers(count: number) {
    for (
      let i = 0;
      i < count &&
      [...this.world.players.values()].filter((p) => p.diedAt === null).length <
        this.world.capacity;
      i++
    ) {
      const id = ++this.demoCount;
      this.world.gift({
        id: randomUUID(),
        senderId: `demo_${id}`,
        senderName:
          names[(id - 1) % names.length]! +
          (id > names.length ? String(Math.ceil(id / names.length)) : ""),
        kind: "join",
        quantity: 1 + ((id * 7) % 45),
      });
    }
  }
  control(data: { action: string; joinGiftId?: string; focusGiftId?: string }) {
    this.sync();
    switch (data.action) {
      case "live": {
        const source = this.source();
        if (!this.options.source) throw new Error("请从工作台启动直播试玩入口");
        if (source.state !== "connected" || !source.webId || !source.runId)
          throw new Error("请先在工作台连接直播间");
        const gifts = this.catalog();
        if (
          !gifts.some((g) => g.id === data.joinGiftId) ||
          !gifts.some((g) => g.id === data.focusGiftId)
        )
          throw new Error("请从官方礼物目录选择礼物");
        const binding = {
          webId: source.webId,
          runId: source.runId,
          startSeq: source.sequence,
          startedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
          joinGiftId: data.joinGiftId!,
          focusGiftId: data.focusGiftId!,
        };
        new ArenaLiveSession(new ArenaWorld(), binding);
        this.reset();
        this.mode = "live";
        this.session = new ArenaLiveSession(this.world, binding);
        this.message = "已接入真实直播，只处理接入后的新增礼物";
        break;
      }
      case "demo":
        this.reset();
        this.mode = "demo";
        this.addPlayers(24);
        this.message = "当前使用模拟礼物";
        break;
      case "pause":
        this.paused = !this.paused;
        break;
      case "reset":
        if (this.mode === "live")
          throw new Error("直播世界请使用重新接入，避免重放旧礼物");
        this.reset();
        this.addPlayers(24);
        break;
      case "add":
        if (this.mode === "live") throw new Error("直播模式不添加模拟玩家");
        this.addPlayers(8);
        break;
      default:
        throw new Error("未知操作");
    }
    this.sync();
    return { ok: true };
  }
  simulate(gift: ArenaGift) {
    this.sync();
    if (this.mode === "live") throw new Error("直播模式不接受模拟礼物");
    return this.world.gift(gift);
  }
  ingest(gift: GiftEvent): ArenaLiveReceipt | null {
    const source = this.sync();
    if (this.mode !== "live" || !this.session) return null;
    const result = this.session.ingest(gift, source);
    if (result.accepted) this.accepted++;
    else this.rejected++;
    this.receipts.unshift({
      at: gift.receivedAt,
      name: gift.senderName.slice(0, 40),
      gift: gift.giftName.slice(0, 60),
      quantity: gift.delta ?? "0",
      accepted: result.accepted,
      message: result.message,
    });
    this.receipts = this.receipts.slice(0, 12);
    return result;
  }
  advance(ms: number) {
    this.sync();
    this.world.advance(ms);
  }
  snapshot(): ArenaViewState {
    const source = this.sync();
    return {
      ...this.world.snapshot(),
      instanceId: this.instanceId,
      input: {
        available: !!this.options.source,
        mode: this.mode,
        state: source.state,
        webId: source.webId,
        attached: !!this.session,
        message: this.message,
        joinGiftId: this.session?.binding.joinGiftId ?? "",
        focusGiftId: this.session?.binding.focusGiftId ?? "",
        accepted: this.accepted,
        rejected: this.rejected,
        receipts: structuredClone(this.receipts),
      },
    };
  }
}
