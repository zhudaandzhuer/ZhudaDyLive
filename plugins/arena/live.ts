import { createHash } from "node:crypto";
import type { GiftEvent } from "../../streamingClient/packages/contracts/src/index";
import { ArenaWorld, type ArenaGift } from "./engine";

export interface ArenaLiveSource {
  state: string;
  webId: string;
  runId: string;
  sequence: string;
}
export interface ArenaLiveBinding {
  webId: string;
  runId: string;
  startSeq: string;
  startedAt: string;
  joinGiftId: string;
  focusGiftId: string;
}
export interface ArenaLiveReceipt {
  accepted: boolean;
  code: string;
  message: string;
  kind?: ArenaGift["kind"];
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const arenaViewerId = (senderId: string) => `live_${hash(senderId)}`;

/** Consumes only committed, normalized events. Never reads cookies or replays the gift journal. */
export class ArenaLiveSession {
  private sequence: bigint;
  private seen = new Set<string>();
  constructor(
    private world: ArenaWorld,
    readonly binding: ArenaLiveBinding,
  ) {
    if (
      !binding.webId ||
      !binding.runId ||
      !/^\d+$/.test(binding.startSeq) ||
      !Number.isFinite(Date.parse(binding.startedAt)) ||
      !/^\d{1,30}$/.test(binding.joinGiftId) ||
      !/^\d{1,30}$/.test(binding.focusGiftId) ||
      binding.joinGiftId === binding.focusGiftId
    )
      throw new Error("请选择不同的入场礼物和抢镜礼物");
    this.sequence = BigInt(binding.startSeq);
  }
  ingest(gift: GiftEvent, source: ArenaLiveSource): ArenaLiveReceipt {
    const skip = (code: string, message: string): ArenaLiveReceipt => ({
      accepted: false,
      code,
      message,
    });
    if (source.state !== "connected") return skip("connection", "直播未连接");
    if (
      source.webId !== this.binding.webId ||
      source.runId !== this.binding.runId ||
      gift.source !== "live" ||
      gift.webId !== this.binding.webId ||
      gift.runId !== this.binding.runId
    )
      return skip("room", "其他房间或连接批次的礼物已排除");
    if (
      !gift.seq ||
      !/^\d+$/.test(gift.seq) ||
      BigInt(gift.seq) <= this.sequence
    )
      return skip("old", "旧事件已排除");
    // A rejected event is consumed too: it cannot be replayed after the viewer joins later.
    this.sequence = BigInt(gift.seq);
    const receivedAt = Date.parse(gift.receivedAt);
    if (
      !Number.isFinite(receivedAt) ||
      receivedAt < Date.parse(this.binding.startedAt)
    )
      return skip("old", "接入前的礼物已排除");
    if (gift.quality !== "inferred" && gift.quality !== "partial")
      return skip("quality", "重复或无法确认的礼物已排除");
    if (
      !gift.delta ||
      !/^\d{1,16}$/.test(gift.delta) ||
      BigInt(gift.delta) === 0n
    )
      return skip("quantity", "没有新增礼物份数");
    if (BigInt(gift.delta) > 1000n)
      return skip("limit", "单次增量超过原型 1000 份上限，本次未生效");
    if (!gift.id || !gift.senderId.trim() || !gift.senderName.trim())
      return skip("identity", "缺少赠送者身份，无法生成角色");
    if (this.seen.has(gift.id)) return skip("duplicate", "该礼物事件已处理");
    if (this.seen.size >= 50_000)
      return skip("limit", "直播事件容量已满，请重新接入");
    this.seen.add(gift.id);
    const kind =
      gift.giftId === this.binding.joinGiftId
        ? "join"
        : gift.giftId === this.binding.focusGiftId
          ? "focus"
          : "buff";
    try {
      const result = this.world.gift({
        id: hash(JSON.stringify([gift.runId, gift.id])),
        senderId: arenaViewerId(gift.senderId),
        senderName: gift.senderName.trim().slice(0, 40),
        kind,
        quantity: Number(gift.delta),
      });
      return {
        ...result,
        code: result.accepted ? "applied" : "duplicate",
        kind,
      };
    } catch (error) {
      return skip("rule", (error as Error).message);
    }
  }
}
