import React, { useEffect, useState } from 'react';
import { systemText, type SceneCommand, type SceneLayerView } from '@zhuda/contracts';

export function SceneTestPanel({
  view,
  busy,
  onCommand,
}: {
  view: SceneLayerView;
  busy: boolean;
  onCommand: (command: SceneCommand) => Promise<boolean>;
}) {
  const { source, layer, runtime } = view;
  const [gift, setGift] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [actionId, setActionId] = useState('');
  const [amount, setAmount] = useState('1');
  const [result, setResult] = useState('');
  const selectedGift = layer.rules.find((r) => r.giftId === gift) ?? layer.rules[0];
  const selectedAction = source?.events.find((e) => e.id === actionId) ?? source?.events[0];
  useEffect(() => {
    setGift(layer.rules[0]?.giftId ?? '');
    setQuantity('1');
    setActionId(source?.events[0]?.id ?? '');
    setAmount(String(source?.events[0]?.default ?? 1));
    setResult('');
  }, [layer.id, layer.pluginVersion, runtime.game.round?.id]);
  if (!source || (!source.events.length && !source.observations?.length)) return null;
  const ready = runtime.mode === 'demo' && runtime.status === 'running' && view.available;
  const disabled = busy || !ready;
  const validQuantity = /^[1-9][0-9]{0,5}$/.test(quantity);
  const validAmount =
    !!selectedAction &&
    amount.trim() !== '' &&
    Number.isInteger(Number(amount)) &&
    Number(amount) >= selectedAction.min &&
    Number(amount) <= selectedAction.max;
  const hint = !view.available
    ? '来源不可用，请先启用插件。'
    : runtime.mode === 'live' && ['running', 'paused'].includes(runtime.status)
      ? '正式交互中，请先停止，再开始试玩。'
      : runtime.status === 'paused'
        ? '点击上方“继续试玩”，即可测试礼物和动作。'
        : !ready
          ? '点击上方“开始试玩”，即可测试礼物和动作。'
          : '仅测试当前图层，按已配置的礼物映射触发。';
  async function test(command: SceneCommand, message: string) {
    setResult('');
    if (await onCommand(command)) setResult(message);
  }
  return (
    <section className="scene-simulation" aria-label="试玩测试" data-scene-test={layer.id}>
      <h4>试玩测试</h4>
      <p className="scene-test-hint">{hint}</p>
      {!!source.events.length && (
        <>
          <h4>试送礼物</h4>
          {layer.rules.length ? (
            <>
              <select
                aria-label="试送礼物"
                disabled={disabled}
                value={selectedGift?.giftId ?? ''}
                onChange={(e) => setGift(e.target.value)}
              >
                {layer.rules.map((r) => {
                  const event = source.events.find((e) => e.id === r.eventId);
                  return (
                    <option key={r.giftId} value={r.giftId}>
                      {r.giftName} · {systemText(event?.label ?? '')}{' '}
                      {r.amount ?? Math.abs(r.delta)}
                      {systemText(event?.unit ?? '')}
                    </option>
                  );
                })}
              </select>
              <div>
                <label className="scene-test-number">
                  <span>礼物数量</span>
                  <input
                    aria-label="礼物数量"
                    type="number"
                    min="1"
                    max="999999"
                    step="1"
                    disabled={disabled}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={disabled || !selectedGift || !validQuantity}
                  onClick={() =>
                    void test(
                      {
                        action: 'simulate',
                        id: layer.id,
                        giftId: selectedGift!.giftId,
                        quantity,
                        requestId: crypto.randomUUID(),
                      },
                      `已试送 ${selectedGift!.giftName} × ${quantity}`,
                    )
                  }
                >
                  试送
                </button>
              </div>
            </>
          ) : (
            <p className="scene-test-hint">请先在“礼物事件设置”中添加映射。</p>
          )}
          <h4>直接预览动作</h4>
          <select
            aria-label="预览动作"
            disabled={disabled}
            value={selectedAction?.id ?? ''}
            onChange={(e) => {
              setActionId(e.target.value);
              setAmount(String(source.events.find((x) => x.id === e.target.value)?.default ?? 1));
            }}
          >
            {source.events.map((e) => (
              <option key={e.id} value={e.id}>
                {systemText(e.label)}
              </option>
            ))}
          </select>
          <div>
            <label className="scene-test-number">
              <span>
                {systemText(selectedAction?.amountLabel ?? '动作数量')}
                {selectedAction?.unit ? `（${systemText(selectedAction.unit)}）` : ''}
              </span>
              <input
                aria-label="动作数量"
                type="number"
                min={selectedAction?.min}
                max={selectedAction?.max}
                step="1"
                disabled={disabled}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <button
              className="button secondary"
              disabled={disabled || !validAmount}
              onClick={() =>
                void test(
                  {
                    action: 'trigger',
                    id: layer.id,
                    eventId: selectedAction!.id,
                    amount: Number(amount),
                    requestId: crypto.randomUUID(),
                  },
                  `已预览 ${systemText(selectedAction!.label)}`,
                )
              }
            >
              预览
            </button>
          </div>
        </>
      )}
      {!!source.observations?.length && (
        <>
          <h4>观测试玩</h4>
          <div className="scene-test-observations">
            {Array.from(new Set(source.observations.map((o) => o.kind))).map((kind) => {
              const label =
                kind === 'like'
                  ? '点赞 +100'
                  : kind === 'follow'
                    ? '关注 +1'
                    : kind === 'gift-sender'
                      ? '送礼人数 +1'
                      : '礼物 +1';
              return (
                <button
                  key={kind}
                  className="button secondary"
                  disabled={disabled}
                  onClick={() =>
                    void test(
                      {
                        action: 'simulateObservation',
                        id: layer.id,
                        kind,
                        quantity: kind === 'like' ? 100 : 1,
                        requestId: crypto.randomUUID(),
                      },
                      `已模拟 ${label}`,
                    )
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </>
      )}
      <p className="scene-test-result" role="status">
        {result}
      </p>
    </section>
  );
}
