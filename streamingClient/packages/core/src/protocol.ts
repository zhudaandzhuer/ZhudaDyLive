import protobuf from 'protobufjs';
import { gunzipSync } from 'node:zlib';
import type { DecodedGift } from '@zhuda/contracts';
import { sha256 } from './crypto';

// Wire numbers adapted from douyinlive-proto v0.1.3 (MIT); unknown fields are skipped.
// Keep uint64 as strings and retain field presence. See THIRD_PARTY_NOTICES.md.
export const protocolRoot = protobuf.parse(`syntax = "proto3";
message Common { string method=1; uint64 msgId=2; uint64 roomId=3; uint64 createTime=4; }
message User { uint64 id=1; string nickname=3; }
message Image { repeated string urlList=1; }
message Gift { Image image=1; uint64 id=5; bool combo=10; int32 diamondCount=12; string name=16; }
message GiftMessage {
 Common common=1; uint64 giftId=2; uint64 fanTicketCount=3; uint64 groupCount=4;
 uint64 repeatCount=5; uint64 comboCount=6; User user=7; User toUser=8; int32 repeatEnd=9;
 uint64 groupId=11; Gift gift=15; uint64 totalCount=29; repeated uint64 toUserIds=32; uint64 count=44;
}
message PushHeader { string key=1; string value=2; }
message PushFrame { uint64 seqId=1; uint64 logId=2; repeated PushHeader headers=5; string payloadEncoding=6; string payloadType=7; bytes payload=8; }
message Message { string method=1; bytes payload=2; uint64 msgId=3; }
message Response { repeated Message messages=1; string cursor=2; string internalExt=5; bool needAck=9; }
message ControlMessage { Common common=1; uint64 action=2; }
message LikeMessage { Common common=1; uint64 count=2; uint64 total=3; User user=5; }
message SocialMessage { Common common=1; User user=2; uint64 shareType=3; uint64 action=4; uint64 followCount=6; }
`).root;

// Only this boundary uses dynamic protobuf objects; application events are typed.
type Wire = Record<string, any>;
function decode(name: string, bytes: Uint8Array): Wire {
  const type = protocolRoot.lookupType(name);
  return type.toObject(type.decode(bytes), {
    longs: String,
    defaults: false,
    bytes: Buffer,
  }) as Wire;
}
const num = (value: unknown) => (value == null || value === '0' ? '' : String(value));
export interface IncomingMessage {
  method: string;
  messageId: string;
  payload: Uint8Array;
}
export interface GiftContext {
  runId: string;
  source: 'live' | 'demo';
  webId: string;
  roomId?: string;
  messageId?: string;
  receivedAt?: string;
}

export function decodeResponse(bytes: Uint8Array): IncomingMessage[] {
  if (bytes.length > 8 * 1024 * 1024) throw new Error('直播封包超过大小限制');
  const response = decode('Response', bytes);
  return (response.messages ?? []).map((m: Wire) => ({
    method: String(m.method ?? ''),
    messageId: num(m.msgId),
    payload: new Uint8Array(m.payload ?? []),
  }));
}
export function decodePush(bytes: Uint8Array): IncomingMessage[] {
  if (bytes.length > 2 * 1024 * 1024) throw new Error('直播封包超过大小限制');
  const push = decode('PushFrame', bytes);
  let payload = Buffer.from(push.payload ?? []);
  if (!payload.length || (push.payloadType && push.payloadType !== 'msg')) return [];
  if (push.payloadEncoding === 'gzip' || (payload[0] === 0x1f && payload[1] === 0x8b))
    payload = gunzipSync(payload, { maxOutputLength: 8 * 1024 * 1024 });
  return decodeResponse(payload);
}
export function isLiveEnd(payload: Uint8Array): boolean {
  return decode('ControlMessage', payload).action === '3';
}

// Normalize deltas only: room-wide totals include events before this round and
// must never be counted as a fresh like/follow increment.
export function decodeMetric(message: IncomingMessage): Record<string, string | number> | null {
  if (!['WebcastLikeMessage', 'WebcastSocialMessage'].includes(message.method)) return null;
  try {
    if (!message.payload.length || message.payload.length > 1024 * 1024) return null;
    const like = message.method === 'WebcastLikeMessage';
    const wire = decode(like ? 'LikeMessage' : 'SocialMessage', message.payload);
    const messageId = message.messageId || num(wire.common?.msgId);
    const senderId = num(wire.user?.id);
    if (!messageId || !senderId) return null;
    if (!like && (wire.action !== '1' || num(wire.shareType))) return null;
    const count = like ? Number(wire.count ?? 0) : 1;
    if (!Number.isSafeInteger(count) || count <= 0 || count > 1_000_000_000) return null;
    return {
      metric: like ? 'like' : 'follow',
      quantity: count,
      senderId,
      senderName: String(wire.user?.nickname ?? ''),
      messageId,
    };
  } catch {
    return null;
  }
}

export function decodeGift(payload: Uint8Array, ctx: GiftContext): DecodedGift {
  const event: DecodedGift = {
    id: '',
    runId: ctx.runId,
    source: ctx.source,
    webId: ctx.webId,
    roomId: ctx.roomId ?? '',
    messageId: ctx.messageId ?? '',
    receivedAt: ctx.receivedAt ?? new Date().toISOString(),
    senderId: '',
    senderName: '',
    recipientId: '',
    giftId: '',
    giftName: '',
    groupId: '',
    rawCounts: {},
    cumulative: null,
    delta: null,
    quality: 'ambiguous',
    note: '数量字段尚无可靠换算规则',
    final: null,
  };
  try {
    if (!payload.length || payload.length > 1024 * 1024) throw new Error('invalid gift size');
    const m = decode('GiftMessage', payload);
    event.roomId ||= num(m.common?.roomId);
    event.messageId ||= num(m.common?.msgId);
    event.senderId = num(m.user?.id);
    event.senderName = String(m.user?.nickname ?? '');
    event.recipientId = num(m.toUser?.id);
    event.giftId = num(m.giftId) || num(m.gift?.id);
    event.giftName = String(m.gift?.name ?? '');
    event.groupId = num(m.groupId);
    for (const [key, name] of Object.entries({
      fanTicketCount: 'fan_ticket_count',
      groupCount: 'group_count',
      repeatCount: 'repeat_count',
      comboCount: 'combo_count',
      groupId: 'group_id',
      totalCount: 'total_count',
      count: 'count',
      repeatEnd: 'repeat_end',
    })) {
      if (Object.hasOwn(m, key)) event.rawCounts[name] = String(m[key]);
    }
    if (Object.hasOwn(m, 'repeatEnd')) event.final = m.repeatEnd === 1;
    if (event.roomId && event.messageId)
      event.id = sha256(
        JSON.stringify([
          event.source,
          event.roomId,
          event.messageId,
          event.senderId,
          event.recipientId,
          event.giftId,
          event.rawCounts,
        ]),
      );
    if (!event.id || !event.senderId || !event.giftId || !event.giftName) {
      event.note = '缺少可靠识别或礼物字段，保留观测';
      return event;
    }
    if ((m.toUserIds?.length ?? 0) > 1) {
      event.note = '多人赠送，暂不换算';
      return event;
    }
    const repeat = BigInt(m.repeatCount ?? 0),
      group = BigInt(m.groupCount ?? 0),
      combo = BigInt(m.comboCount ?? 0);
    if (group > 1n) {
      if (!event.groupId || repeat < group) {
        event.note = '批量字段缺失或不一致';
        return event;
      }
      event.startsCombo = combo === 1n && repeat === group && m.repeatEnd !== 1;
    }
    if (event.groupId && repeat > 0n && (m.gift?.combo || repeat > 1n || m.repeatEnd === 1)) {
      event.countMode = 'cumulative';
      event.count = repeat.toString();
      event.cumulative = event.count;
      event.comboKey = sha256(
        JSON.stringify([
          event.source,
          event.roomId,
          event.senderId,
          event.recipientId,
          event.giftId,
          event.groupId,
        ]),
      );
    } else if (!m.gift?.combo && repeat <= 1n && combo <= 1n) {
      const count = BigInt(m.count ?? (repeat === 1n ? 1 : 0));
      if (count > 0n) {
        event.countMode = 'single';
        event.count = count.toString();
        event.comboKey = sha256(
          JSON.stringify([
            event.source,
            event.roomId,
            'single',
            event.messageId,
            event.senderId,
            event.recipientId,
            event.giftId,
          ]),
        );
      }
    }
    if (event.countMode) {
      event.quality = 'inferred';
      event.note = '按协议字段推算添加件数';
    }
  } catch {
    event.quality = 'parse_error';
    event.note = '礼物 Protobuf 无法解析，原封包已保留';
  }
  return event;
}
