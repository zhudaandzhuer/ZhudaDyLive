import React from 'react';
import type { CollectorEvent, StudioSnapshot } from '@zhuda/contracts';
import { systemText } from '@zhuda/contracts';
import { Icon, date, number, collectorLabels } from './ui';

export type ObservationView = 'status' | 'messages' | 'gifts' | 'errors';
const messageNames: Record<string, string> = {
  WebcastChatMessage: '弹幕',
  WebcastGiftMessage: '礼物',
  WebcastMemberMessage: '进场',
  WebcastLikeMessage: '按赞',
  WebcastSocialMessage: '关注／分享',
  WebcastControlMessage: '直播状态',
  WebcastRoomUserSeqMessage: '观众人数',
  WebcastRoomStatsMessage: '直播统计',
  WebcastFansclubMessage: '粉丝团',
  WebcastScreenChatMessage: '醒目留言',
};

function EventTable({ events, empty }: { events: CollectorEvent[]; empty: string }) {
  return events.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>状态</th>
            <th>直播间</th>
            <th>详细信息</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{date(event.receivedAt)}</td>
              <td>
                <span className={`event-level ${event.level}`}>
                  {event.level === 'info'
                    ? collectorLabels[event.state]
                    : event.level === 'warning'
                      ? '连接中断'
                      : '异常'}
                </span>
              </td>
              <td>{event.webId || '—'}</td>
              <td>{systemText(event.message)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="empty">{empty}</p>
  );
}

export function ObservationPanel({
  snapshot,
  view,
  onView,
}: {
  snapshot: StudioSnapshot;
  view: ObservationView;
  onView: (view: ObservationView) => void;
}) {
  const status = snapshot.collector;
  const observations = snapshot.observations;
  const messages = observations?.messages ?? [];
  const events = observations?.events ?? [];
  const errors = observations?.errors ?? [];
  const gifts = snapshot.gifts.filter(
    (gift) =>
      gift.source === 'live' &&
      (observations?.runId ? gift.runId === observations.runId : gift.webId === status.webId),
  );
  const cards = [
    ['status', '状态', collectorLabels[status.state]],
    ['messages', '消息', number(status.messageCount)],
    ['gifts', '礼物', number(status.giftCount)],
    ['errors', '异常', number(observations?.errorCount ?? status.parseErrors)],
  ] as const;
  const headings: Record<ObservationView, [string, string]> = {
    status: ['状态详情', '目前连接信息与最近 100 笔连接纪录'],
    messages: ['消息明细', '本次连接的接收纪录 · 最近 100 笔'],
    gifts: ['礼物明细', '本次连接 · 最近 100 笔 · 数量依协议推算'],
    errors: ['异常明细', '本次打开工作台的异常纪录 · 最近 100 笔'],
  };
  return (
    <>
      <div className="stat-grid" role="group" aria-label="观测明细切换">
        {cards.map(([id, label, value]) => (
          <button
            key={id}
            id={`metric-${id}`}
            className={`panel stat${view === id ? ' selected' : ''}`}
            aria-pressed={view === id}
            aria-controls="observation-details"
            onClick={() => onView(id)}
          >
            <span>
              {label}
              <Icon name="arrow" size={13} />
            </span>
            <strong>{value}</strong>
          </button>
        ))}
      </div>
      <section id="observation-details" className="panel ledger" aria-labelledby={`metric-${view}`}>
        <div className="panel-heading">
          <h3>{headings[view][0]}</h3>
          <span className="muted-text">{headings[view][1]}</span>
        </div>
        {view === 'status' && (
          <>
            <dl className="connection-details">
              {[
                ['直播间', status.webId || '尚未指定'],
                ['登录状态', status.loggedIn ? '已登录抖音' : '尚未登录'],
                ['最近消息', status.lastMessageAt ? date(status.lastMessageAt) : '尚未收到'],
                ['最近礼物', status.lastGiftAt ? date(status.lastGiftAt) : '尚未收到'],
                ['数据完整性', status.partial ? '曾发生中断，部分数据待核对' : '目前未标记中断'],
                ['连接说明', status.message],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <h4 className="detail-subheading">连接纪录</h4>
            <EventTable
              events={events}
              empty="尚无连接记录，请在上方输入直播间号码或网址并连接。"
            />
          </>
        )}
        {view === 'messages' &&
          (messages.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>接收时间</th>
                    <th>消息类型</th>
                    <th>消息编号</th>
                    <th>大小</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((message) => (
                    <tr key={message.id}>
                      <td>{date(message.receivedAt)}</td>
                      <td title={message.method}>
                        {messageNames[message.method] || message.method || '其他消息'}
                      </td>
                      <td>{message.messageId || '—'}</td>
                      <td>{number(message.bytes)} B</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">尚未收到消息，连接直播间后会显示接收纪录。</p>
          ))}
        {view === 'gifts' && (
          <>
            {status.partial && (
              <p className="warning-note">曾发生连接或解析中断，本次观测可能不完整。</p>
            )}
            {gifts.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>接收时间</th>
                      <th>送礼者</th>
                      <th>礼物</th>
                      <th>推算添加</th>
                      <th>标记</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gifts.map((gift) => (
                      <tr key={gift.seq}>
                        <td>{date(gift.receivedAt)}</td>
                        <td>{gift.senderName || '未知观众'}</td>
                        <td>{gift.giftName || gift.giftId || '未知礼物'}</td>
                        <td className="quantity">
                          {gift.delta === null ? '待核对' : '+' + number(gift.delta)}
                        </td>
                        <td title={gift.note}>
                          {
                            {
                              inferred: '协议推算',
                              partial: '中途观测',
                              duplicate: '已排除重送',
                              ambiguous: '待核对',
                              parse_error: '解析失败',
                            }[gift.quality]
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">等待本次连接的第一笔礼物。试送纪录不会混入直播观测。</p>
            )}
          </>
        )}
        {view === 'errors' && <EventTable events={errors} empty="目前没有异常纪录。" />}
      </section>
    </>
  );
}
