import React, { useEffect, useRef, useState } from 'react';
import type {
  SceneCommand,
  SceneLayer,
  SceneSnapshot,
  StudioSnapshot,
  SceneParameter,
  SceneRuntime,
} from '@zhuda/contracts';
import { layerViewport, resizeLayerSize, scaleLayerSize } from './layer-sizing';
import { useLayerListDrag } from './layer-list-drag';
import { SceneLibrary } from './SceneLibrary';
import { SceneStage } from './SceneStage';
import { sceneParameters, systemText } from '@zhuda/contracts';
import { GiftRulesEditor } from './GiftRulesEditor';
import { Icon } from './ui';
import { SceneSourceIcon } from './SceneSourceIcon';
import { MobilePreviewDialog } from './MobilePreviewDialog';
const states = {
  idle: '尚未启动',
  running: '运行中',
  paused: '已暂停',
  stopped: '已停止',
  won: '挑战成功',
};
const runtimeLabel = (runtime: SceneRuntime) =>
  runtime.status === 'running' && !runtime.game.round
    ? '等待全局礼物'
    : runtime.status === 'running' && runtime.game.round?.status === 'won'
      ? '等待新礼物'
      : states[runtime.status];
function Field({
  label,
  value,
  onSave,
  type = 'number',
  min,
  max,
  step,
  disabled = false,
  live = false,
}: {
  label: string;
  value: string | number;
  onSave: (value: string) => void;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  live?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  return (
    <label className="scene-field">
      <span>{label}</span>
      <input
        type={type}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onFocus={() => {
          focused.current = true;
          cancelled.current = false;
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onInput={
          type === 'color' || live
            ? (event) => {
                const value = event.currentTarget.value;
                setDraft(value);
                if (
                  type !== 'number' ||
                  (value.trim() &&
                    Number.isFinite(Number(value)) &&
                    Number(value) >= (min ?? -Infinity) &&
                    Number(value) <= (max ?? Infinity))
                )
                  onSave(value);
              }
            : undefined
        }
        onBlur={() => {
          focused.current = false;
          if (!cancelled.current && type !== 'color' && draft !== String(value)) {
            onSave(draft);
          }
          setDraft(String(value));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            cancelled.current = true;
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
export function SceneEditor({
  snapshot,
  busy,
  onCommand,
  onStore,
  insertPlugin,
  onInserted,
}: {
  snapshot: StudioSnapshot;
  busy: boolean;
  onCommand: (command: SceneCommand) => Promise<boolean>;
  onStore: () => void;
  insertPlugin: string | null;
  onInserted: () => void;
}) {
  const scene = snapshot.scene;
  const previousLayers = useRef<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [canvasMode, setCanvasMode] = useState<'build' | 'preview'>('build');
  const [mobilePreview, setMobilePreview] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  function openSources(pluginId: string | null = null) {
    setSourceFilter(pluginId);
    setSources(true);
  }
  const [sources, setSources] = useState(false),
    [configure, setConfigure] = useState(false),
    [rules, setRules] = useState(false);
  const [draft, setDraft] = useState<SceneLayer | null>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: string;
    x: number;
    y: number;
    layer: SceneLayer;
    resize: boolean;
    revision: number;
  } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const listDrag = useLayerListDrag(scene?.document, busy, onCommand);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [!!scene]);
  useEffect(() => {
    if (insertPlugin) {
      openSources(insertPlugin);
      onInserted();
    }
  }, [insertPlugin, onInserted]);
  useEffect(() => {
    const ids = scene?.document.layers.map((l) => l.id) ?? [];
    const added = ids.filter((id) => !previousLayers.current.includes(id));
    if (added.length) {
      const content = scene?.layers.find(
        (v) => added.includes(v.layer.id) && !['status', 'view'].includes(v.source?.kind ?? ''),
      );
      setSelected(content?.layer.id ?? added.at(-1)!);
    }
    previousLayers.current = ids;
  }, [scene?.document.revision]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        busy ||
        draft ||
        canvasMode !== 'build' ||
        target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')
      )
        return;
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        !['z', 'y'].includes(event.key.toLowerCase())
      )
        return;
      const action = event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo';
      const enabled = action === 'redo' ? scene?.history?.canRedo : scene?.history?.canUndo;
      event.preventDefault();
      if (enabled) void onCommand({ action });
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [busy, draft, canvasMode, scene?.history, onCommand]);
  const view = scene?.layers.find((v) => v.layer.id === selected),
    layer = draft ?? view?.layer;
  useEffect(() => {
    setRules(false);
  }, [selected, view?.runtime.game.round?.id]);
  useEffect(() => {
    setConfirmRemove(null);
    setContextMenu(null);
  }, [scene?.document.id]);
  useEffect(() => {
    const close = () => setContextMenu(null);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', keydown);
    };
  }, []);
  if (!scene)
    return (
      <section className="panel">
        <h2>正在准备场景工作站</h2>
        <p>加载场景与插件来源…</p>
      </section>
    );
  const doc = scene.document;
  const interactive =
    !!view?.source && (view.source.runtime === 'interactive' || view.source.events.length > 0);
  const initial =
    layer?.initial ?? view?.runtime.game.round?.initial ?? view?.source?.counter?.initial ?? '1';
  const current = view?.runtime.game.round?.remaining ?? initial;
  const parameterGroups = new Map<string, SceneParameter[]>();
  for (const p of view?.source ? sceneParameters(view.source) : []) {
    const group = p.group ?? '来源内容';
    parameterGroups.set(group, [...(parameterGroups.get(group) ?? []), p]);
  }
  const removing = scene.layers.find((v) => v.layer.id === confirmRemove)?.layer;
  const hasControls = !!view?.source && (interactive || view.source.runtime === 'media');
  const statusPanel = scene.layers.find(
    (v) => v.source?.kind === 'status' && v.layer.binding?.targetLayerId === layer?.id,
  );
  const scale = Math.max(
    0.02,
    Math.min((size.width - 64) / doc.width, (size.height - 64) / doc.height, 1),
  );
  const visualScene = draft
    ? {
        ...scene,
        layers: scene.layers.map((v) => (v.layer.id === draft.id ? { ...v, layer: draft } : v)),
      }
    : scene;
  function selectCanvasMode(mode: 'build' | 'preview') {
    if (gesture.current) return;
    setCanvasMode(mode);
  }
  const available = (snapshot.plugins?.installed ?? [])
    .filter((p) => p.enabled)
    .flatMap((p) =>
      (p.item.manifest.sceneSources ?? [])
        .filter(
          (s) => !['instructions', 'status', 'view'].includes(s.kind ?? '') && !s.splitSources,
        )
        .map((s) => ({ plugin: p.item.manifest, source: s })),
    );
  async function patch(update: Partial<SceneLayer>) {
    if (!view) return false;
    return onCommand({ action: 'patch', id: view.layer.id, revision: doc.revision, patch: update });
  }
  const num = (key: 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity', value: string) => {
    if (!value.trim() || !Number.isFinite(Number(value))) return;
    const number = Number(value);
    if (layer?.contentSize && (key === 'width' || key === 'height'))
      void patch(scaleLayerSize(layer, number / layer[key]));
    else void patch({ [key]: number });
  };
  function begin(event: React.PointerEvent, resize: boolean, target = layer) {
    const layer = target;
    if (!layer || layer.locked || busy || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      id: layer.id,
      x: event.clientX,
      y: event.clientY,
      layer: { ...layer },
      resize,
      revision: doc.revision,
    };
    setDraft({ ...layer });
  }
  function move(event: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const dx = (event.clientX - g.x) / scale,
      dy = (event.clientY - g.y) / scale;
    const rad = (g.layer.rotation * Math.PI) / 180;
    const update = g.resize
      ? resizeLayerSize(
          g.layer,
          dx * Math.cos(rad) + dy * Math.sin(rad),
          -dx * Math.sin(rad) + dy * Math.cos(rad),
        )
      : {
          x: Math.max(-8192, Math.min(16384, g.layer.x + dx)),
          y: Math.max(-8192, Math.min(16384, g.layer.y + dy)),
        };
    setDraft({ ...g.layer, ...update });
  }
  async function finish(cancel = false) {
    const g = gesture.current;
    gesture.current = null;
    if (g && draft && !cancel)
      await onCommand({
        action: 'patch',
        id: g.id,
        revision: g.revision,
        patch: { x: draft.x, y: draft.y, width: draft.width, height: draft.height },
      });
    setDraft(null);
  }
  function parameter(p: SceneParameter) {
    const value = layer?.settings[p.key] ?? p.default;
    const save = (value: string | number | boolean) =>
      void onCommand({ action: 'settings', id: view!.layer.id, values: { [p.key]: value } });
    const locked = layer?.locked && !p.live;
    if (p.type === 'boolean')
      return (
        <label className="scene-check" key={p.key}>
          <input
            type="checkbox"
            checked={value === true}
            disabled={busy || locked}
            onChange={(e) => save(e.target.checked)}
          />
          {systemText(p.label)}
        </label>
      );
    if (p.type === 'select')
      return (
        <label className="scene-field" key={p.key}>
          <span>{systemText(p.label)}</span>
          <select
            value={String(value)}
            disabled={busy || locked}
            onChange={(e) => save(e.target.value)}
          >
            {p.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {systemText(o.label)}
              </option>
            ))}
          </select>
        </label>
      );
    if (p.type === 'image' || p.type === 'video')
      return (
        <div className="scene-media-field" key={p.key}>
          <span>{systemText(p.label)}</span>
          <button
            className="button secondary full"
            disabled={busy || locked}
            onClick={() => void onCommand({ action: 'importMedia', id: layer!.id, key: p.key })}
          >
            {value ? '更换本机素材' : '选择本机素材'} <Icon name="download" size={13} />
          </button>
          {!!value && (
            <button className="text-button" onClick={() => save('')} disabled={busy || locked}>
              清除素材
            </button>
          )}
        </div>
      );
    return (
      <Field
        key={p.key}
        label={systemText(p.label)}
        value={String(value)}
        type={p.type === 'number' ? 'number' : p.type === 'color' ? 'color' : 'text'}
        min={p.min}
        max={p.max}
        disabled={(p.type !== 'color' && !p.live && busy) || locked}
        live={p.live}
        onSave={(v) => save(p.type === 'number' ? Number(v) : v)}
      />
    );
  }
  return (
    <div className="scene-editor" data-revision={doc.revision}>
      {mobilePreview && <MobilePreviewDialog onClose={() => setMobilePreview(false)} />}
      <div className="scene-toolbar">
        <div>
          <span className="eyebrow">场景工作站</span>
          <SceneLibrary scene={scene} busy={busy} onCommand={onCommand} />
        </div>
        <button
          className="button secondary"
          aria-label="撤销场景编辑"
          disabled={busy || !!draft || !scene.history?.canUndo}
          onClick={() => void onCommand({ action: 'undo' })}
        >
          撤销
        </button>
        <button
          className="button secondary"
          aria-label="重做场景编辑"
          disabled={busy || !!draft || !scene.history?.canRedo}
          onClick={() => void onCommand({ action: 'redo' })}
        >
          重做
        </button>
        <button className="scene-size" onClick={() => setConfigure(true)}>
          {doc.width} × {doc.height} <span>⌄</span>
        </button>
        <span className="scene-saved">
          <i className="dot" />
          {draft ? '调整中…' : busy ? '处理中…' : '已自动保存'}
        </span>
      </div>
      {scene.warning && <p className="scene-warning">{systemText(scene.warning)}</p>}
      {view?.failure && (
        <div className="scene-warning" role="alert">
          <p>{view.failure.message}</p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void onCommand({ action: 'retrySource', id: view.layer.id })}
          >
            重新加载此来源
          </button>
        </div>
      )}
      <div className="scene-workbench">
        <aside className="scene-layers" data-tour="layers">
          <header>
            <button
              className="scene-add-source"
              data-tour="add-source"
              onClick={() => openSources()}
            >
              <span aria-hidden="true">＋</span>添加来源
            </button>
            <span>{doc.layers.length} / 32</span>
          </header>
          <div className="scene-layer-list" ref={listDrag.list}>
            {[...scene.layers].reverse().map((v) => (
              <div
                key={v.layer.id}
                data-layer-id={v.layer.id}
                className={[
                  'scene-layer-row',
                  selected === v.layer.id ? 'selected' : '',
                  listDrag.draggingId === v.layer.id ? 'dragging' : '',
                  listDrag.dropTarget?.id === v.layer.id
                    ? `drop-${listDrag.dropTarget.placement}`
                    : '',
                ].join(' ')}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelected(v.layer.id);
                  setDraft(null);
                  setContextMenu({
                    id: v.layer.id,
                    x: Math.min(event.clientX, window.innerWidth - 190),
                    y: Math.min(event.clientY, window.innerHeight - 110),
                  });
                }}
              >
                <button
                  className="scene-layer-select"
                  draggable={false}
                  title={`${v.layer.name} · 拖动调整层级，Alt + ↑/↓ 微调`}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onPointerDown={(event) => {
                    if (listDrag.start(v.layer.id, event)) {
                      setSelected(v.layer.id);
                      setDraft(null);
                    }
                  }}
                  onPointerMove={listDrag.move}
                  onPointerUp={listDrag.finish}
                  onPointerCancel={listDrag.cancel}
                  onLostPointerCapture={listDrag.cancel}
                  onKeyDown={(event) => {
                    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || busy)
                      return;
                    event.preventDefault();
                    void onCommand({
                      action: 'order',
                      id: v.layer.id,
                      direction: event.key === 'ArrowUp' ? 'up' : 'down',
                    });
                  }}
                  onClick={() => {
                    setSelected(v.layer.id);
                    setDraft(null);
                  }}
                >
                  <span className="scene-layer-grip">
                    <Icon name="grip" size={12} />
                  </span>
                  <span className="source-mini">
                    <SceneSourceIcon source={v.source} size={16} />
                  </span>
                  <span>
                    <b>{v.layer.name}</b>
                    <small>{!v.available ? '来源不可用' : runtimeLabel(v.runtime)}</small>
                  </span>
                </button>
                <button
                  className="scene-mini-button"
                  title={v.layer.visible ? '隐藏图层' : '显示图层'}
                  aria-label={`${v.layer.visible ? '隐藏' : '显示'} ${v.layer.name}`}
                  disabled={busy}
                  onClick={() =>
                    void onCommand({
                      action: 'patch',
                      id: v.layer.id,
                      revision: doc.revision,
                      patch: { visible: !v.layer.visible },
                    })
                  }
                >
                  {v.layer.visible ? '◉' : '○'}
                </button>
                <button
                  className="scene-mini-button"
                  title={v.layer.locked ? '解除锁定' : '锁定图层'}
                  aria-label={`${v.layer.locked ? '解锁' : '锁定'} ${v.layer.name}`}
                  disabled={busy}
                  onClick={() =>
                    void onCommand({
                      action: 'patch',
                      id: v.layer.id,
                      revision: doc.revision,
                      patch: { locked: !v.layer.locked },
                    })
                  }
                >
                  {v.layer.locked ? '▣' : '◇'}
                </button>
              </div>
            ))}
          </div>
        </aside>
        <div className="scene-canvas-column">
          <div className="scene-canvas-bar">
            <div className="scene-canvas-tabs" role="tablist" aria-label="场景模式">
              {(['build', 'preview'] as const).map((mode) => (
                <button
                  key={mode}
                  id={`scene-mode-${mode}`}
                  role="tab"
                  aria-selected={canvasMode === mode}
                  aria-controls="scene-canvas-panel"
                  tabIndex={canvasMode === mode ? 0 : -1}
                  data-tour={mode === 'preview' ? 'scene-preview' : undefined}
                  onClick={() => selectCanvasMode(mode)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const next =
                      event.key === 'Home'
                        ? 'build'
                        : event.key === 'End'
                          ? 'preview'
                          : mode === 'build'
                            ? 'preview'
                            : 'build';
                    const button = document.getElementById(
                      `scene-mode-${next}`,
                    ) as HTMLButtonElement;
                    button.focus();
                    button.click();
                  }}
                >
                  {mode === 'build' ? '场景搭建' : '场景测试'}
                </button>
              ))}
            </div>
            <div className="scene-canvas-actions">
              <button
                className="scene-output-toggle"
                id="scene-mobile-preview"
                onClick={() => setMobilePreview(true)}
              >
                手机预览
              </button>
              {(canvasMode === 'preview' || scene.outputOpen) && (
                <button
                  className="scene-output-toggle"
                  id="scene-output-toggle"
                  disabled={busy}
                  title={
                    scene.outputOpen
                      ? '关闭独立输出窗口；也可在输出窗口按 Esc'
                      : '打开供直播伴侣截取的独立窗口'
                  }
                  onClick={() => void onCommand({ action: 'output', open: !scene.outputOpen })}
                >
                  {scene.outputOpen ? '关闭输出窗口' : '打开输出窗口'}
                </button>
              )}
              <small>
                {Math.round(scale * 100)}% ·{' '}
                {doc.background === 'green'
                  ? '绿幕'
                  : doc.background === 'transparent'
                    ? '透明'
                    : '深色'}
              </small>
            </div>
          </div>
          <div
            className="scene-viewport"
            id="scene-canvas-panel"
            role="tabpanel"
            aria-labelledby={`scene-mode-${canvasMode}`}
            tabIndex={0}
            ref={viewport}
            onPointerDown={() => {
              if (canvasMode === 'build' && !gesture.current) setSelected(null);
            }}
          >
            <div
              className="scene-fit"
              style={{ width: doc.width * scale, height: doc.height * scale }}
            >
              <SceneStage
                scene={visualScene}
                scale={scale}
                editor={canvasMode === 'build'}
                sound={!scene.outputOpen}
              />
              {canvasMode === 'build' && (
                <div
                  className="scene-hit-stage"
                  style={{ width: doc.width, height: doc.height, transform: `scale(${scale})` }}
                >
                  {scene.layers
                    .filter((v) => v.layer.visible)
                    .map((v) => {
                      const l = draft?.id === v.layer.id ? draft : v.layer;
                      return (
                        <div
                          key={l.id}
                          data-layer-id={l.id}
                          className={
                            'scene-hit-layer ' +
                            (l.id === selected ? 'selected' : '') +
                            (l.locked ? ' locked' : '')
                          }
                          style={
                            {
                              left: l.x,
                              top: l.y,
                              width: l.width,
                              height: l.height,
                              transform: `rotate(${l.rotation}deg)`,
                              '--handle-size': `${10 / scale}px`,
                              '--outline-size': `${1 / scale}px`,
                            } as React.CSSProperties
                          }
                          onPointerDown={(e) => {
                            if (l.locked) return;
                            setSelected(l.id);
                            begin(e, false, l);
                            e.stopPropagation();
                          }}
                          onPointerMove={move}
                          onPointerUp={() => void finish()}
                          onPointerCancel={() => void finish(true)}
                        >
                          {l.id === selected && (
                            <>
                              <span
                                className="scene-selection-label"
                                style={{
                                  fontSize: 11 / scale,
                                  padding: `${3 / scale}px ${6 / scale}px`,
                                }}
                              >
                                {l.name}
                                {l.locked ? ' · 已锁定' : ''}
                              </span>
                              {!l.locked && (
                                <button
                                  className="scene-resize-handle"
                                  aria-label="调整图层大小"
                                  onPointerDown={(e) => begin(e, true)}
                                  onPointerMove={move}
                                  onPointerUp={(e) => {
                                    e.stopPropagation();
                                    void finish();
                                  }}
                                  onPointerCancel={() => void finish(true)}
                                />
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
        <aside className="scene-inspector" data-tour="inspector">
          <header>
            <b>图层设置</b>
            {view && (
              <span className={'status-pill ' + (view.runtime.status === 'running' ? 'on' : '')}>
                {hasControls ? runtimeLabel(view.runtime) : '静态来源'}
              </span>
            )}
          </header>
          {view && layer ? (
            <div className="scene-inspector-body" key={view.layer.id}>
              <Field
                label="图层名称"
                type="text"
                value={view.layer.name}
                disabled={busy}
                onSave={(name) => void patch({ name })}
              />
              {!view.available && (
                <p className="scene-warning">
                  {systemText(view.error ?? '')}
                  {['instructions', 'status', 'view'].includes(view.source?.kind ?? '')
                    ? ''
                    : '，可到插件区启用或重新安装。'}
                </p>
              )}
              <section>
                <h4>位置与尺寸</h4>
                <label className="scene-field">
                  <span>尺寸调整</span>
                  <select
                    aria-label="尺寸调整"
                    value={layer.contentSize ? 'scale' : 'layout'}
                    disabled={busy || layer.locked}
                    onChange={(e) =>
                      void patch({
                        contentSize:
                          e.target.value === 'scale'
                            ? { width: layer.width, height: layer.height }
                            : null,
                      })
                    }
                  >
                    <option value="scale">等比缩放</option>
                    <option value="layout">调整布局</option>
                  </select>
                </label>
                {layer.contentSize && (
                  <Field
                    label="缩放 %"
                    value={Math.round(layerViewport(layer).scale * 10000) / 100}
                    min={0.2}
                    max={51200}
                    step={1}
                    disabled={busy || layer.locked}
                    onSave={(value) => {
                      const factor = Number(value) / 100;
                      if (value.trim() && Number.isFinite(factor) && factor > 0)
                        void patch(scaleLayerSize(layer.contentSize!, factor));
                    }}
                  />
                )}
                <div className="scene-field-grid">
                  {(['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const).map((key, i) => (
                    <Field
                      key={key}
                      label={['X', 'Y', '宽度', '高度', '旋转 °', '不透明度'][i]!}
                      value={layer[key]}
                      min={
                        key === 'opacity' ? 0 : key === 'width' || key === 'height' ? 16 : undefined
                      }
                      max={key === 'opacity' ? 1 : undefined}
                      step={key === 'opacity' ? 0.05 : 1}
                      disabled={busy || layer.locked}
                      onSave={(value) => num(key, value)}
                    />
                  ))}
                </div>
                <div className="scene-inline-actions">
                  {view.source?.splitSources && (
                    <button
                      disabled={busy || layer.locked}
                      onClick={() =>
                        void onCommand({ action: 'split', id: layer.id, revision: doc.revision })
                      }
                    >
                      拆分为独立进度条
                    </button>
                  )}
                  <button
                    disabled={busy || layer.locked}
                    onClick={() =>
                      void patch({
                        x: 0,
                        y: 0,
                        ...(layer.contentSize
                          ? scaleLayerSize(
                              layer.contentSize,
                              Math.min(
                                doc.width / layer.contentSize.width,
                                doc.height / layer.contentSize.height,
                              ),
                            )
                          : { width: doc.width, height: doc.height }),
                        rotation: 0,
                      })
                    }
                  >
                    填满场景
                  </button>
                  <button
                    disabled={busy || layer.locked}
                    onClick={() =>
                      void patch({
                        x: (doc.width - layer.width) / 2,
                        y: (doc.height - layer.height) / 2,
                      })
                    }
                  >
                    置中
                  </button>
                </div>
              </section>
              {['instructions', 'status', 'view'].includes(view.source?.kind ?? '') && (
                <section>
                  <h4>绑定玩法</h4>
                  <select
                    aria-label={
                      ['status', 'view'].includes(view.source?.kind ?? '')
                        ? '状态面板绑定玩法'
                        : '说明绑定玩法'
                    }
                    value={layer.binding?.targetLayerId ?? ''}
                    disabled={busy || layer.locked}
                    onChange={(e) => void patch({ binding: { targetLayerId: e.target.value } })}
                  >
                    {!scene.layers.some((v) => v.layer.id === layer.binding?.targetLayerId) && (
                      <option value={layer.binding?.targetLayerId ?? ''}>原玩法已移除</option>
                    )}
                    {scene.layers
                      .filter((v) =>
                        ['status', 'view'].includes(view.source?.kind ?? '')
                          ? v.layer.pluginId === layer.pluginId &&
                            v.layer.sourceId === view.source?.targetSourceId
                          : v.source?.events.length &&
                            !['instructions', 'status', 'view'].includes(v.source.kind ?? ''),
                      )
                      .map((v) => (
                        <option key={v.layer.id} value={v.layer.id}>
                          {v.layer.name}
                        </option>
                      ))}
                  </select>
                  <small>
                    {['status', 'view'].includes(view.source?.kind ?? '')
                      ? '数量、进度和运行状态实时跟随绑定玩法，位置和缩放独立保存。'
                      : '礼物和动作会自动跟随该玩法的礼物事件设置。'}
                  </small>
                </section>
              )}
              {!!view.source?.themes.length && (
                <section>
                  <h4>主题</h4>
                  <div className="scene-theme-options">
                    {view.source.themes.map((theme) => (
                      <button
                        key={theme.id}
                        disabled={busy}
                        title={systemText(theme.description)}
                        className={layer.theme === theme.id ? 'selected' : ''}
                        onClick={() => void patch({ theme: theme.id })}
                      >
                        <i style={{ background: theme.accent }} />
                        {systemText(theme.name)}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {Array.from(parameterGroups, ([group, parameters]) => (
                <section key={group} data-parameter-group={group}>
                  <h4>{systemText(group)}</h4>
                  {parameters.map(parameter)}
                </section>
              ))}
              {view.source && hasControls && (
                <section className="scene-runtime">
                  <h4>{interactive ? '玩法状态' : '播放控制'}</h4>
                  {view.source.counter && (
                    <>
                      <div className="scene-counter">
                        <span>{systemText(view.source.counter.label)}</span>
                        <strong>{BigInt(current).toLocaleString()}</strong>
                      </div>
                      {interactive ? (
                        <Field
                          label="当前数量"
                          value={current}
                          min={0}
                          max={999999999}
                          disabled={
                            busy ||
                            !view.available ||
                            !['running', 'paused'].includes(view.runtime.status)
                          }
                          onSave={(value) => {
                            if (!/^(0|[1-9][0-9]{0,8})$/.test(value)) return;
                            void onCommand({ action: 'setCounter', id: layer.id, value });
                          }}
                        />
                      ) : (
                        <Field
                          label="起始数量"
                          value={initial}
                          min={1}
                          max={999999999}
                          disabled={busy || view.runtime.status === 'running'}
                          onSave={(nextInitial) => void patch({ initial: nextInitial })}
                        />
                      )}
                    </>
                  )}
                  {!interactive && (
                    <div className="scene-control-buttons">
                      {view.runtime.status === 'running' ? (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            void onCommand({ action: 'control', id: layer.id, state: 'pause' })
                          }
                        >
                          暂停
                        </button>
                      ) : view.runtime.status === 'paused' ? (
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void onCommand({ action: 'control', id: layer.id, state: 'resume' })
                          }
                        >
                          继续播放
                        </button>
                      ) : (
                        <>
                          <button
                            className="button"
                            disabled={busy}
                            onClick={() =>
                              void onCommand({
                                action: 'control',
                                id: layer.id,
                                state: 'start',
                                mode: 'demo',
                                initial: view.source?.counter ? initial : undefined,
                              })
                            }
                          >
                            {interactive ? '启动场景' : '播放'}
                          </button>
                          {interactive && (
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() =>
                                void onCommand({
                                  action: 'control',
                                  id: layer.id,
                                  state: 'start',
                                  mode: 'live',
                                  initial: view.source?.counter ? initial : undefined,
                                })
                              }
                            >
                              开始播放
                            </button>
                          )}
                        </>
                      )}
                      {['running', 'paused', 'won'].includes(view.runtime.status) && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void onCommand({ action: 'control', id: layer.id, state: 'stop' })
                          }
                        >
                          停止
                        </button>
                      )}
                    </div>
                  )}
                  {!interactive && <p className="scene-help">视频来源可在此单独播放和暂停。</p>}
                  {!!view.source.events.length && (
                    <>
                      <button
                        className="button secondary full"
                        data-tour="gift-settings"
                        disabled={busy || layer.locked}
                        onClick={() => setRules(true)}
                      >
                        礼物事件设置 <span>{layer.rules.length}</span>
                      </button>
                      <button
                        className="button secondary full"
                        disabled={busy || doc.layers.length >= 32}
                        onClick={() => void onCommand({ action: 'addInstructions', id: layer.id })}
                      >
                        添加玩法说明
                      </button>
                      {view.source.statusSourceId && (
                        <button
                          className="button secondary full"
                          disabled={busy || (!statusPanel && doc.layers.length >= 32)}
                          onClick={() =>
                            statusPanel
                              ? setSelected(statusPanel.layer.id)
                              : void onCommand({ action: 'addStatus', id: layer.id })
                          }
                        >
                          {statusPanel ? '编辑状态面板' : '添加状态面板'}
                        </button>
                      )}
                    </>
                  )}
                  {(
                    snapshot.plugins?.installed.find((p) => p.item.manifest.id === layer.pluginId)
                      ?.item.manifest.sceneSources ?? []
                  )
                    .filter((s) => s.kind === 'view' && s.targetSourceId === layer.sourceId)
                    .map((component) => (
                      <button
                        key={component.id}
                        className="button secondary full"
                        disabled={busy || doc.layers.length >= 32}
                        onClick={() =>
                          void onCommand({
                            action: 'addView',
                            id: layer.id,
                            sourceId: component.id,
                          })
                        }
                      >
                        添加{systemText(component.name)}
                      </button>
                    ))}
                </section>
              )}
              <section>
                <h4>图层来源</h4>
                <small className="scene-version">
                  {layer.pluginId} · v{layer.pluginVersion}
                </small>
                {snapshot.plugins?.installed.some(
                  (p) =>
                    p.item.manifest.id === layer.pluginId &&
                    p.item.manifest.version !== layer.pluginVersion,
                ) && (
                  <button
                    className="text-button"
                    disabled={
                      busy || (view.source?.kind !== 'status' && view.runtime.status === 'running')
                    }
                    onClick={() => void onCommand({ action: 'upgrade', id: layer.id })}
                  >
                    套用已安装的来源版本
                  </button>
                )}
              </section>
            </div>
          ) : (
            <div className="scene-inspector-empty">
              <Icon name="settings" size={28} />
              <h3>选择图层</h3>
              <p>
                在画面或图层列表点击来源
                <br />
                即可调整内容、外观与交互
              </p>
            </div>
          )}
        </aside>
        {contextMenu && scene.layers.some((entry) => entry.layer.id === contextMenu.id) && (
          <div
            className="scene-layer-context-menu"
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              role="menuitem"
              disabled={busy}
              onClick={() => {
                const id = contextMenu.id;
                setContextMenu(null);
                void onCommand({ action: 'duplicate', id });
              }}
            >
              复制图层
            </button>
            <button
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setConfirmRemove(contextMenu.id);
                setContextMenu(null);
              }}
            >
              删除图层
            </button>
          </div>
        )}
      </div>
      {sources && (
        <div className="modal-backdrop" onClick={() => setSources(false)}>
          <section
            className="source-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sources-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">添加来源</span>
                <h2 id="sources-title">加入场景来源</h2>
                <p>插件安装一次，每个图层各自设置与运行。</p>
              </div>
              <button
                className="icon-button"
                autoFocus
                aria-label="关闭来源选择"
                onClick={() => setSources(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </header>
            <div className="source-picker-content" aria-label="场景来源列表" tabIndex={0}>
              {[
                { id: 'basics', name: '基础场景' },
                { id: 'plugins', name: '插件' },
              ].map((group) => {
                const entries = available.filter(
                  ({ plugin }) =>
                    (!sourceFilter || plugin.id === sourceFilter) &&
                    (group.id === 'basics'
                      ? plugin.id === 'plugin.scene-basics'
                      : plugin.id !== 'plugin.scene-basics'),
                );
                if (!entries.length) return null;
                return (
                  <section
                    className="source-group"
                    key={group.id}
                    data-source-group={group.id}
                    aria-labelledby={`source-group-${group.id}`}
                  >
                    <h3 id={`source-group-${group.id}`}>
                      {group.name}
                      <span>{entries.length}</span>
                    </h3>
                    <div className="source-picker-grid">
                      {entries.map(({ plugin, source }) => (
                        <button
                          disabled={busy || doc.layers.length >= 32}
                          key={`${plugin.id}:${source.id}`}
                          className="source-option"
                          data-source={`${plugin.id}:${source.id}`}
                          onClick={async () => {
                            if (
                              await onCommand({
                                action: 'add',
                                pluginId: plugin.id,
                                sourceId: source.id,
                              })
                            )
                              setSources(false);
                          }}
                        >
                          <span className="source-option-mark">
                            <SceneSourceIcon source={source} />
                          </span>
                          <strong>{systemText(source.name)}</strong>
                          <p>{systemText(source.description)}</p>
                          <small>
                            {systemText(plugin.name)} · v{plugin.version}
                          </small>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
            <footer>
              <span>
                {sourceFilter ? (
                  <button className="text-button" onClick={() => setSourceFilter(null)}>
                    显示全部来源
                  </button>
                ) : (
                  '需要更多来源？'
                )}
              </span>
              <button
                className="text-button"
                onClick={() => {
                  setSources(false);
                  onStore();
                }}
              >
                打开本机插件区 ↗
              </button>
            </footer>
          </section>
        </div>
      )}
      {configure && (
        <SceneSettings
          scene={scene}
          busy={busy}
          onCommand={onCommand}
          onClose={() => setConfigure(false)}
        />
      )}
      {rules && view?.source && (
        <GiftRulesEditor
          name={view.layer.name}
          configuration={{
            product: view.layer.pluginId,
            packageVersion: view.layer.pluginVersion,
            events: view.source.events,
            rules: view.layer.rules,
            themes: view.source.themes,
            theme: view.layer.theme,
          }}
          catalog={snapshot.giftCatalog}
          onSave={(rules) => patch({ rules })}
          onClose={() => setRules(false)}
        />
      )}
      {removing && (
        <div className="modal-backdrop">
          <section
            className="launch-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-layer-title"
          >
            <h2 id="remove-layer-title">删除「{removing.name}」？</h2>
            <p>将移除此图层及其进度，插件仍可再次加入。</p>
            <div className="scene-control-buttons">
              <button className="button secondary" autoFocus onClick={() => setConfirmRemove(null)}>
                取消
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  if (await onCommand({ action: 'remove', sceneId: doc.id, id: removing.id })) {
                    setConfirmRemove(null);
                    setSelected((current) => (current === removing.id ? null : current));
                  }
                }}
              >
                删除图层
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function SceneSettings({
  scene,
  busy,
  onCommand,
  onClose,
}: {
  scene: SceneSnapshot;
  busy: boolean;
  onCommand: (c: SceneCommand) => Promise<boolean>;
  onClose: () => void;
}) {
  const doc = scene.document;
  const [name, setName] = useState(doc.name),
    [width, setWidth] = useState(String(doc.width)),
    [height, setHeight] = useState(String(doc.height)),
    [background, setBackground] = useState(doc.background);
  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <form
        className="launch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scene-config-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await onCommand({
              action: 'configure',
              name,
              width: Number(width),
              height: Number(height),
              background,
              revision: doc.revision,
            })
          )
            onClose();
        }}
      >
        <button type="button" className="modal-close" aria-label="关闭场景设置" onClick={onClose}>
          ×
        </button>
        <span className="eyebrow">场景设置</span>
        <h2 id="scene-config-title">场景设置</h2>
        <label>
          场景名称
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
          />
        </label>
        <div className="scene-control-buttons">
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setWidth('1080');
              setHeight('1920');
            }}
          >
            直版 9:16
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setWidth('1920');
              setHeight('1080');
            }}
          >
            横版 16:9
          </button>
        </div>
        <div className="scene-field-grid">
          <label>
            宽度
            <input
              type="number"
              min={240}
              max={8192}
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              required
            />
          </label>
          <label>
            高度
            <input
              type="number"
              min={240}
              max={8192}
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              required
            />
          </label>
        </div>
        <label>
          输出背景
          <select
            value={background}
            onChange={(e) => setBackground(e.target.value as typeof background)}
          >
            <option value="green">绿幕 #00FF00</option>
            <option value="transparent">透明</option>
            <option value="dark">深色</option>
          </select>
        </label>
        <p>尺寸改变后，图层保留原位置与大小，可用「填满场景」快速适配。</p>
        <button className="button full" disabled={busy} type="submit">
          保存场景设置
        </button>
      </form>
    </div>
  );
}
