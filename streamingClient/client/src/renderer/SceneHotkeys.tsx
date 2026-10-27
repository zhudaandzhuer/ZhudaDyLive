import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  normalizeHotkey,
  platformHotkey,
  displayHotkey,
  hotkeyFromKeyEvent,
  systemText,
  type SceneCommand,
  type SceneHotkey,
  type SceneLayerView,
  type SceneSnapshot,
} from '@zhuda/contracts';

export function SceneHotkeyPanel({
  view,
  scene,
  platform,
  busy,
  onCommand,
}: {
  view: SceneLayerView;
  scene: SceneSnapshot;
  platform: string;
  busy: boolean;
  onCommand: (c: SceneCommand) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [eventId, setEventId] = useState('');
  const [amount, setAmount] = useState('1');
  const [result, setResult] = useState('');
  const events = view.source?.events ?? [];
  const event = events.find((e) => e.id === eventId) ?? events[0];
  useEffect(() => {
    setOpen(false);
    setEventId('');
    setAmount(String(events[0]?.default ?? 1));
    setResult('');
  }, [view.layer.id, view.layer.pluginVersion]);
  if (!events.length) return null;
  const valid =
    event &&
    amount.trim() !== '' &&
    Number.isInteger(Number(amount)) &&
    Number(amount) >= event.min &&
    Number(amount) <= event.max;
  return (
    <section className="scene-hotkeys" aria-label="手动补触发">
      <h4>手动补触发</h4>
      <select
        aria-label="补触发事件"
        value={event?.id ?? ''}
        disabled={busy}
        onChange={(e) => {
          setEventId(e.target.value);
          setAmount(String(events.find((v) => v.id === e.target.value)?.default ?? 1));
          setResult('');
        }}
      >
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {systemText(e.label)}
          </option>
        ))}
      </select>
      <div className="scene-hotkey-manual">
        <label>
          <span>
            {systemText(event?.amountLabel ?? '数量')}
            {event?.unit ? `（${systemText(event.unit)}）` : ''}
          </span>
          <input
            aria-label="补触发数量"
            type="number"
            min={event?.min}
            max={event?.max}
            step="1"
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <button
          className="button secondary"
          disabled={busy || !valid || !view.available || view.runtime.status !== 'running'}
          onClick={async () => {
            setResult('');
            if (
              await onCommand({
                action: 'manual',
                id: view.layer.id,
                eventId: event!.id,
                amount: Number(amount),
                requestId: crypto.randomUUID(),
              })
            )
              setResult(`已补触发 ${systemText(event!.label)} ${amount}${systemText(event!.unit)}`);
          }}
        >
          补触发
        </button>
      </div>
      <p className="scene-help">正式直播与试玩均可使用。启动玩法后，热键在其他应用中也能触发。</p>
      <button
        className="button secondary full"
        data-hotkey-settings={view.layer.id}
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        热键设置 <span>{view.layer.hotkeys?.filter((h) => h.enabled).length ?? 0}</span>
      </button>
      {!!view.layer.hotkeys?.length && (
        <ul className="scene-hotkey-statuses">
          {view.layer.hotkeys.map((h) => {
            const status = scene.hotkeys?.find(
              (s) => s.layerId === view.layer.id && s.hotkeyId === h.id,
            );
            return (
              <li key={h.id} data-hotkey-state={status?.state ?? 'waiting'}>
                <div>
                  <kbd>{displayHotkey(h.accelerator, platform)}</kbd>
                  <span>
                    {systemText(events.find((e) => e.id === h.eventId)?.label ?? h.eventId)} ·{' '}
                    {h.amount}
                  </span>
                </div>
                <small>
                  {status?.message ?? '启动玩法后生效'}
                  {status?.lastResult
                    ? ` · ${status.lastTriggeredAt ? new Date(status.lastTriggeredAt).toLocaleTimeString('zh-CN') + ' ' : ''}${status.lastResult}`
                    : ''}
                </small>
              </li>
            );
          })}
        </ul>
      )}
      <p className="scene-test-result" role="status">
        {result}
      </p>
      {open && (
        <HotkeyEditor
          key={view.layer.id}
          view={view}
          scene={scene}
          platform={platform}
          busy={busy}
          onCommand={onCommand}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

function HotkeyEditor({
  view,
  scene,
  platform,
  busy,
  onCommand,
  onClose,
}: {
  view: SceneLayerView;
  scene: SceneSnapshot;
  platform: string;
  busy: boolean;
  onCommand: (c: SceneCommand) => Promise<boolean>;
  onClose: () => void;
}) {
  const [bindings, setBindings] = useState<SceneHotkey[]>(() =>
    structuredClone(view.layer.hotkeys ?? []),
  );
  const [recording, setRecording] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const events = view.source!.events;
  useEffect(() => {
    let alive = true;
    const suspend = () => {
      setReady(false);
      void window.studio.setHotkeyCapture(true).then(
        () => {
          if (alive) setReady(true);
        },
        () => {
          if (alive) setError('热键录制无法开启，请关闭后重试');
        },
      );
    };
    const release = () => {
      setReady(false);
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
  }, []);
  const update = (id: string, patch: Partial<SceneHotkey>) =>
    setBindings((v) => v.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  function validate() {
    const used = new Map<string, string>();
    for (const layer of scene.document.layers.filter((l) => l.id !== view.layer.id))
      for (const h of layer.hotkeys ?? [])
        if (h.enabled) used.set(platformHotkey(h.accelerator, platform), layer.name);
    for (const h of bindings) {
      try {
        normalizeHotkey(h.accelerator);
      } catch {
        return '请为每一项录制有效热键';
      }
      const event = events.find((e) => e.id === h.eventId);
      if (!event || !Number.isInteger(h.amount) || h.amount < event.min || h.amount > event.max)
        return '事件数量超出支持范围';
      if (h.enabled) {
        const key = platformHotkey(h.accelerator, platform);
        if (used.has(key))
          return `热键 ${displayHotkey(h.accelerator, platform)} 与「${used.get(key)}」重复`;
        used.set(key, view.layer.name);
      }
    }
    return '';
  }
  const invalid = validate();
  function record(e: React.KeyboardEvent<HTMLInputElement>, id: string) {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      setRecording(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!ready || e.repeat || e.nativeEvent.isComposing) return;
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
      setError('');
      e.currentTarget.blur();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return createPortal(
    <div className="modal-backdrop">
      <section
        className="hotkey-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hotkey-title"
      >
        <header>
          <div>
            <h2 id="hotkey-title">{view.layer.name} · 热键设置</h2>
            <p>点击录制框，再按下组合键。配置期间暂停全部玩法热键。</p>
          </div>
          <button className="text-button" aria-label="关闭热键设置" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="hotkey-editor-list">
          {bindings.map((h, i) => {
            const event = events.find((e) => e.id === h.eventId);
            return (
              <article key={h.id} className="hotkey-editor-row">
                <div className="hotkey-row-heading">
                  <label>
                    <input
                      type="checkbox"
                      checked={h.enabled}
                      disabled={busy}
                      onChange={(e) => update(h.id, { enabled: e.target.checked })}
                    />
                    启用热键 {i + 1}
                  </label>
                  <button
                    className="text-button scene-danger"
                    disabled={busy}
                    onClick={() => setBindings((v) => v.filter((x) => x.id !== h.id))}
                  >
                    移除
                  </button>
                </div>
                <label className="hotkey-record">
                  <span>电脑热键</span>
                  <input
                    aria-label={`录制热键 ${i + 1}`}
                    readOnly
                    disabled={busy || !ready}
                    value={
                      recording === h.id ? '请按下组合键…' : displayHotkey(h.accelerator, platform)
                    }
                    placeholder="点击此处录制，例如 Ctrl+Alt+F6"
                    onFocus={() => setRecording(h.id)}
                    onBlur={() => setRecording(null)}
                    onKeyDown={(e) => record(e, h.id)}
                  />
                </label>
                <div className="hotkey-event-fields">
                  <label>
                    <span>触发事件</span>
                    <select
                      aria-label={`热键事件 ${i + 1}`}
                      value={h.eventId}
                      disabled={busy}
                      onChange={(e) =>
                        update(h.id, {
                          eventId: e.target.value,
                          amount: events.find((v) => v.id === e.target.value)!.default,
                        })
                      }
                    >
                      {events.map((e) => (
                        <option key={e.id} value={e.id}>
                          {systemText(e.label)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>
                      {systemText(event?.amountLabel ?? '数量')}
                      {event?.unit ? `（${systemText(event.unit)}）` : ''}
                    </span>
                    <input
                      aria-label={`热键数量 ${i + 1}`}
                      type="number"
                      min={event?.min}
                      max={event?.max}
                      step="1"
                      value={Number.isFinite(h.amount) ? h.amount : ''}
                      disabled={busy}
                      onChange={(e) =>
                        update(h.id, {
                          amount: e.target.value === '' ? NaN : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              </article>
            );
          })}
          {!bindings.length && (
            <p className="scene-help">尚未设置热键。为常用的加量、减量或特效事件添加组合键。</p>
          )}
          <button
            className="button secondary"
            disabled={busy || bindings.length >= 32}
            onClick={() =>
              setBindings((v) => [
                ...v,
                {
                  id: crypto.randomUUID(),
                  accelerator: '',
                  eventId: events[0]!.id,
                  amount: events[0]!.default,
                  enabled: true,
                },
              ])
            }
          >
            添加热键
          </button>
        </div>
        <footer>
          <p role="status">
            {error || invalid || '自动保存在当前场景。暂停或停止玩法后，热键不触发。'}
          </p>
          <div>
            <button className="button secondary" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button
              className="button"
              disabled={busy || !!invalid || !ready}
              onClick={async () => {
                if (
                  await onCommand({
                    action: 'hotkeys',
                    id: view.layer.id,
                    revision: scene.document.revision,
                    bindings,
                  })
                )
                  onClose();
              }}
            >
              保存热键
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
