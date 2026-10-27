import React, { useState } from 'react';
import type { SceneSnapshot, SceneCommand, SceneLibraryEntry } from '@zhuda/contracts';

export function SceneLibrary({
  scene,
  busy,
  onCommand,
}: {
  scene: SceneSnapshot;
  busy: boolean;
  onCommand: (command: SceneCommand) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<{
    action: 'sceneCreate' | 'sceneCopy' | 'sceneRename' | 'sceneDelete';
    target?: SceneLibraryEntry;
  } | null>(null);
  const [name, setName] = useState('');
  const begin = (action: NonNullable<typeof edit>['action'], target?: SceneLibraryEntry) => {
    setEdit({ action, target });
    setName(
      action === 'sceneCreate'
        ? ''
        : action === 'sceneCopy'
          ? `${scene.document.name.slice(0, 50)} 副本`
          : (target?.name ?? ''),
    );
  };
  return (
    <>
      <button
        className="scene-library-trigger"
        aria-label="打开场景库"
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          setEdit(null);
          setOpen(true);
        }}
      >
        <strong>{scene.document.name}</strong>
        <span>⌄</span>
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <section
            className="scene-library-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scene-library-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !busy) setOpen(false);
            }}
          >
            <header>
              <div>
                <span className="eyebrow">场景库</span>
                <h2 id="scene-library-title">我的直播场景</h2>
              </div>
              <button
                className="icon-button"
                autoFocus
                aria-label="关闭场景库"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="scene-library-actions">
              <button
                className="button"
                disabled={busy || scene.library.length >= 100}
                onClick={() => begin('sceneCreate')}
              >
                新建场景
              </button>
              <button
                className="button secondary"
                disabled={busy || scene.library.length >= 100}
                onClick={() => begin('sceneCopy')}
              >
                当前场景另存为
              </button>
            </div>
            <div className="scene-library-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void onCommand({ action: 'exportScene' })}
              >
                导出当前场景
              </button>
              <button
                className="button secondary"
                disabled={busy || scene.library.length >= 100}
                onClick={() => void onCommand({ action: 'importScene' })}
              >
                导入场景包
              </button>
            </div>
            <div className="scene-library-list">
              {scene.library.map((entry) => (
                <div
                  key={entry.id}
                  className="scene-library-row"
                  data-active={entry.id === scene.document.id}
                >
                  <button
                    className="scene-library-select"
                    disabled={busy || entry.id === scene.document.id}
                    onClick={async () => {
                      if (await onCommand({ action: 'sceneSwitch', id: entry.id })) setOpen(false);
                    }}
                  >
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.width} × {entry.height} · {entry.layerCount} 个图层
                      {entry.id === scene.document.id ? ' · 当前场景' : ''}
                    </small>
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    aria-label={`重命名${entry.name}`}
                    onClick={() => begin('sceneRename', entry)}
                  >
                    重命名
                  </button>
                  <button
                    className="text-button scene-danger"
                    disabled={busy || entry.id === scene.document.id}
                    aria-label={`删除${entry.name}`}
                    onClick={() => begin('sceneDelete', entry)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            {edit ? (
              <form
                className="scene-library-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const command: SceneCommand =
                    edit.action === 'sceneDelete'
                      ? { action: edit.action, id: edit.target!.id }
                      : edit.action === 'sceneRename'
                        ? { action: edit.action, id: edit.target!.id, name }
                        : { action: edit.action, name };
                  if (await onCommand(command)) setEdit(null);
                }}
              >
                {edit.action === 'sceneDelete' ? (
                  <p>删除「{edit.target?.name}」及其图层配置？本机素材和已安装插件会保留。</p>
                ) : (
                  <label>
                    {edit.action === 'sceneRename'
                      ? '重命名场景'
                      : edit.action === 'sceneCopy'
                        ? '另存为新场景'
                        : '新场景名称'}
                    <input
                      aria-label="场景库名称"
                      autoFocus
                      value={name}
                      maxLength={60}
                      required
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                )}
                <div className="scene-control-buttons">
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setEdit(null)}
                  >
                    取消
                  </button>
                  <button className="button" type="submit" disabled={busy}>
                    {edit.action === 'sceneDelete' ? '确认删除' : '保存'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="scene-library-hint">
                编辑会自动保存。切换场景后，请确认直播间并重新启动玩法。
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
