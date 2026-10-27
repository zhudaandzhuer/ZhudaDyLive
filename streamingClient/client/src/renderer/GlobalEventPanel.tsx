import React, { useEffect, useMemo, useState } from 'react';
import {
  displayHotkey,
  hotkeyFromKeyEvent,
  normalizeHotkey,
  platformHotkey,
  systemText,
  type GlobalHotkey,
  type GiftCatalogSnapshot,
  type SceneCommand,
  type SceneSnapshot,
} from '@zhuda/contracts';
import { Icon } from './ui';

type Props = {
  scene: SceneSnapshot;
  gifts: GiftCatalogSnapshot;
  platform: string;
  busy: boolean;
  onCommand: (command: SceneCommand) => Promise<boolean>;
};

function mappings(scene: SceneSnapshot, gifts: GiftCatalogSnapshot) {
  const names = new Map(gifts.gifts.map((gift) => [gift.id, gift.name]));
  const rows = new Map<string, { id: string; name: string; labels: string[] }>();
  for (const view of scene.layers) {
    if (!view.source || ['instructions', 'status', 'view'].includes(view.source.kind ?? ''))
      continue;
    for (const rule of view.layer.rules) {
      const event = view.source.events.find((item) => item.id === rule.eventId);
      const row = rows.get(rule.giftId) ?? {
        id: rule.giftId,
        name: names.get(rule.giftId) ?? rule.giftName,
        labels: [],
      };
      const label =
        `${systemText(event?.label ?? '')} ${rule.amount ?? Math.abs(rule.delta)}`.trim();
      if (label && !row.labels.includes(label)) row.labels.push(label);
      rows.set(rule.giftId, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans'));
}

export function GlobalEventPanel({ scene, gifts, platform, busy, onCommand }: Props) {
  const choices = useMemo(() => mappings(scene, gifts), [scene, gifts]);
  const [giftId, setGiftId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [result, setResult] = useState('');
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState<string | null>(null);
  const [captureReady, setCaptureReady] = useState(false);
  const [bindings, setBindings] = useState<GlobalHotkey[]>(() =>
    structuredClone(scene.document.globalHotkeys ?? []),
  );
  const activeGift = choices.find((choice) => choice.id === giftId) ?? choices[0];
  const selectedGift = activeGift?.id ?? '';
  const validQuantity = /^[1-9][0-9]{0,5}$/.test(quantity);
  const update = (id: string, patch: Partial<GlobalHotkey>) =>
    setBindings((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  useEffect(() => {
    let alive = true;
    setRecording(null);
    setCaptureReady(false);
    if (!editing) return;
    const suspend = () => {
      setCaptureReady(false);
      void window.studio.setHotkeyCapture(true).then(
        () => {
          if (alive) setCaptureReady(true);
        },
        () => {
          if (alive) setResult('热键录制无法开启，请关闭后重试');
        },
      );
    };
    const release = () => {
      setCaptureReady(false);
      setRecording(null);
      void window.studio.setHotkeyCapture(false);
    };
    suspend();
    window.addEventListener('focus', suspend);
    window.addEventListener('blur', release);
    return () => {
      alive = false;
      window.removeEventListener('focus', suspend);
      window.removeEventListener('blur', release);
      void window.studio.setHotkeyCapture(false);
    };
  }, [editing]);
  function recordHotkey(e: React.KeyboardEvent<HTMLInputElement>, id: string) {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      setRecording(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!captureReady || e.repeat || e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      setRecording(null);
      e.currentTarget.blur();
      return;
    }
    try {
      const accelerator = hotkeyFromKeyEvent(e, platform);
      if (!accelerator) return;
      update(id, { accelerator });
      setRecording(null);
      setResult('');
      e.currentTarget.blur();
    } catch (error) {
      setResult((error as Error).message);
    }
  }
  const saveBindings = async () => {
    const duplicate = new Set<string>();
    for (const binding of bindings) {
      try {
        normalizeHotkey(binding.accelerator);
      } catch {
        setResult('请为每个全局热键录制有效组合');
        return;
      }
      const key = platformHotkey(binding.accelerator, platform);
      if (binding.enabled && duplicate.has(key)) {
        setResult(`热键 ${displayHotkey(binding.accelerator, platform)} 重复`);
        return;
      }
      if (binding.enabled) duplicate.add(key);
      if (
        !Number.isInteger(binding.quantity) ||
        binding.quantity < 1 ||
        binding.quantity > 999999
      ) {
        setResult('礼物数量须为 1–999,999');
        return;
      }
      if (!choices.some((choice) => choice.id === binding.giftId)) {
        setResult('热键绑定的礼物已不在当前场景中');
        return;
      }
    }
    if (
      await onCommand({
        action: 'globalHotkeys',
        sceneId: scene.document.id,
        revision: scene.document.revision,
        bindings,
      })
    ) {
      setEditing(false);
      setResult('全局热键已保存');
    }
  };
  return (
    <section className="global-event-panel" aria-label="全局事件测试">
      <div className="global-event-heading">
        <div>
          <h4>全局事件测试</h4>
          <p className="scene-test-hint">发送一次礼物事件，场景内所有玩法按各自映射一起响应。</p>
        </div>
        <span className="status-pill on">全局</span>
      </div>
      {!choices.length ? (
        <p className="scene-test-hint">场景中还没有配置礼物映射。</p>
      ) : (
        <>
          <div className="global-event-fields">
            <label>
              <span>礼物</span>
              <select
                aria-label="全局测试礼物"
                value={selectedGift}
                disabled={busy}
                onChange={(event) => setGiftId(event.target.value)}
              >
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.name} · {choice.labels.join(' / ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>数量</span>
              <input
                aria-label="全局测试数量"
                type="number"
                min="1"
                max="999999"
                value={quantity}
                disabled={busy}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <button
              className="button"
              disabled={busy || !selectedGift || !validQuantity}
              onClick={async () => {
                if (
                  await onCommand({
                    action: 'globalGift',
                    sceneId: scene.document.id,
                    giftId: selectedGift,
                    quantity,
                    requestId: crypto.randomUUID(),
                  })
                )
                  setResult(`已发送 ${activeGift?.name ?? selectedGift} × ${quantity}`);
              }}
            >
              发送事件
            </button>
          </div>
          <button
            className="button secondary full"
            disabled={busy}
            aria-expanded={editing}
            onClick={() => {
              if (!editing) setBindings(structuredClone(scene.document.globalHotkeys ?? []));
              setResult('');
              setEditing(!editing);
            }}
          >
            全局热键设置{' '}
            <span>{scene.document.globalHotkeys?.filter((h) => h.enabled).length ?? 0}</span>
          </button>
          {editing && (
            <div className="global-hotkey-editor">
              {bindings.map((binding, index) => (
                <article key={binding.id} className="global-hotkey-row">
                  <div className="global-hotkey-heading">
                    <label className="scene-check">
                      <input
                        type="checkbox"
                        checked={binding.enabled}
                        disabled={busy}
                        onChange={(event) => update(binding.id, { enabled: event.target.checked })}
                      />
                      热键 {index + 1}
                    </label>
                    <button
                      className="text-button scene-danger"
                      aria-label={`移除全局热键 ${index + 1}`}
                      title="移除热键"
                      disabled={busy}
                      onClick={() =>
                        setBindings((current) => current.filter((entry) => entry.id !== binding.id))
                      }
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  <label className="global-hotkey-record">
                    <span>按键</span>
                    <input
                      className="global-hotkey-accelerator"
                      aria-label={`全局热键 ${index + 1}`}
                      readOnly
                      value={
                        recording === binding.id
                          ? '请按下组合键…'
                          : displayHotkey(binding.accelerator, platform)
                      }
                      placeholder="点击后按下组合键"
                      disabled={busy || !captureReady}
                      onFocus={() => setRecording(binding.id)}
                      onBlur={() => setRecording(null)}
                      onKeyDown={(event) => recordHotkey(event, binding.id)}
                    />
                  </label>
                  <label className="global-hotkey-gift">
                    <span>礼物</span>
                    <select
                      aria-label={`全局热键礼物 ${index + 1}`}
                      value={binding.giftId}
                      disabled={busy}
                      onChange={(event) => update(binding.id, { giftId: event.target.value })}
                    >
                      {choices.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="global-hotkey-quantity">
                    <span>数量</span>
                    <input
                      aria-label={`全局热键数量 ${index + 1}`}
                      type="number"
                      min="1"
                      max="999999"
                      value={Number.isFinite(binding.quantity) ? binding.quantity : ''}
                      disabled={busy}
                      onChange={(event) =>
                        update(binding.id, {
                          quantity: event.target.value === '' ? NaN : Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </article>
              ))}
              <div className="scene-control-buttons">
                <button
                  className="button secondary"
                  disabled={busy || bindings.length >= 32 || !choices.length}
                  onClick={() =>
                    setBindings((current) => [
                      ...current,
                      {
                        id: crypto.randomUUID(),
                        accelerator: '',
                        giftId: choices[0]!.id,
                        quantity: 1,
                        enabled: true,
                      },
                    ])
                  }
                >
                  添加全局热键
                </button>
                <button
                  className="button"
                  disabled={busy || !captureReady}
                  onClick={() => void saveBindings()}
                >
                  保存热键
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  取消
                </button>
              </div>
            </div>
          )}
          {!editing && !!scene.document.globalHotkeys?.length && (
            <ul className="scene-hotkey-statuses">
              {scene.document.globalHotkeys.map((binding) => {
                const status = scene.hotkeys?.find(
                  (entry) => entry.scope === 'global' && entry.hotkeyId === binding.id,
                );
                return (
                  <li key={binding.id} data-hotkey-state={status?.state ?? 'waiting'}>
                    <div>
                      <kbd>{displayHotkey(binding.accelerator, platform)}</kbd>
                      <span>
                        {choices.find((choice) => choice.id === binding.giftId)?.name} ×{' '}
                        {binding.quantity}
                      </span>
                    </div>
                    <small>
                      {status?.message ?? '等待注册'}
                      {status?.lastResult ? ` · ${status.lastResult}` : ''}
                    </small>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <p className="scene-test-result" role="status">
        {result}
      </p>
    </section>
  );
}
