import React, { useState } from 'react';
import {
  APP_VERSION,
  compareVersions,
  pluginPermissions,
  pluginCompatible,
  systemText,
  type PluginCatalogItem,
  type PluginCommand,
  type PluginSnapshot,
  type SceneSnapshot,
  type SceneCommand,
} from '@zhuda/contracts';
import { Icon, date } from './ui';
import { copyAgentDevelopmentPrompt } from './agent-prompt';

const categories = {
  stream: '直播交互',
  assets: '素材管理',
  productivity: '工作效率',
  tools: '工具',
};
export function PluginStore({
  snapshot,
  busy,
  onCommand,
  onOpen,
  onInsert,
  scene,
  onSceneCommand,
}: {
  snapshot: PluginSnapshot | undefined;
  busy: boolean;
  onCommand: (command: PluginCommand) => Promise<boolean>;
  onOpen: (id: string) => void;
  onInsert: (id: string) => void;
  scene?: SceneSnapshot;
  onSceneCommand: (command: SceneCommand) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState('all'),
    [search, setSearch] = useState('');
  const [review, setReview] = useState<PluginCatalogItem | null>(null);
  const [agentPromptStatus, setAgentPromptStatus] = useState('');
  const pendingLayers = (id: string, version: string) =>
    scene?.layers.filter(
      (view) =>
        view.layer.pluginId === id && compareVersions(version, view.layer.pluginVersion) > 0,
    ) ?? [];
  const applySources = async (id: string, version: string) => {
    for (const view of pendingLayers(id, version)) {
      if (
        (view.source?.kind === 'status' || view.runtime.status !== 'running') &&
        !(await onSceneCommand({ action: 'upgrade', id: view.layer.id }))
      )
        break;
    }
  };
  const install = async (item: PluginCatalogItem) => {
    const existing = snapshot?.installed.find(
      (entry) => entry.item.manifest.id === item.manifest.id,
    );
    const okay = await onCommand({
      action: existing ? 'update' : 'install',
      id: item.manifest.id,
      version: item.manifest.version,
      permissions: item.manifest.permissions,
    });
    if (okay && existing?.enabled) await applySources(item.manifest.id, item.manifest.version);
    return okay;
  };
  if (!snapshot)
    return (
      <section className="panel plugin-empty">
        <Icon name="plugin" size={32} />
        <h2>插件系统已准备就绪</h2>
        <p>把插件 ZIP 放进本机插件目录，工作台会自动识别。</p>
      </section>
    );
  const rows = new Map(snapshot.catalog.map((listing) => [listing.item.manifest.id, listing]));
  for (const installed of snapshot.installed)
    if (!rows.has(installed.item.manifest.id))
      rows.set(installed.item.manifest.id, {
        item: installed.item,
        installed,
        compatible: pluginCompatible(installed.item.manifest, APP_VERSION),
        updateAvailable: false,
      });
  const items = [...rows.values()].filter(
    ({ item, installed }) =>
      (filter === 'all' ||
        (filter === 'installed'
          ? !!installed
          : filter === 'updates'
            ? rows.get(item.manifest.id)?.updateAvailable
            : item.manifest.category === filter)) &&
      systemText(`${item.manifest.name} ${item.manifest.description}`)
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
  );
  return (
    <div className="plugin-store">
      <section className="plugin-hero">
        <div>
          <span className="eyebrow">本机插件</span>
          <h2>你的工作台，由你扩充。</h2>
          <p>把 ZIP 放入插件区，自动安装并按版本更新，不依赖网络服务。</p>
        </div>
        <Icon name="plugin" size={64} />
      </section>
      <div className="plugin-toolbar">
        <input
          aria-label="搜索插件"
          placeholder="搜索插件名称或功能…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="button secondary"
          disabled={busy || snapshot.status === 'syncing'}
          onClick={() => void onCommand({ action: 'sync' })}
        >
          <Icon name="refresh" size={14} />
          {snapshot.status === 'syncing' ? '扫描中' : '扫描插件区'}
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void onCommand({ action: 'openFolder' })}
        >
          打开插件区
        </button>
      </div>
      <section className="plugin-agent-card" aria-label="Agent 开发入口">
        <div>
          <span className="eyebrow">README 开发入口</span>
          <h3>复制提示词给 Agent</h3>
          <p>复制项目 README 的开发提示词，然后粘贴给 Agent 开发插件或小游戏。</p>
        </div>
        <button
          className="button secondary"
          data-agent-prompt-copy
          onClick={() => {
            void copyAgentDevelopmentPrompt()
              .then(() => setAgentPromptStatus('已复制，请粘贴到 Agent'))
              .catch(() => setAgentPromptStatus('复制失败，请打开 README/AGENT.md 手动复制'));
          }}
        >
          <Icon name="copy" size={14} />
          {agentPromptStatus || '复制 README 提示词'}
        </button>
      </section>
      <div className="plugin-filters" aria-label="插件分类">
        {[
          ['all', '全部插件'],
          ['installed', `已安装 ${snapshot.installed.length}`],
          ['updates', `可更新 ${snapshot.catalog.filter((row) => row.updateAvailable).length}`],
          ...Object.entries(categories),
        ].map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? 'selected' : ''}
            aria-pressed={filter === id}
            onClick={() => setFilter(id!)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="plugin-sync-status" role="status">
        {snapshot.status === 'ready'
          ? '自动扫描本机 ZIP · 插件无需账号或联网'
          : '正在扫描本机插件区'}
        {snapshot.updatedAt && <span>最后扫描 {date(snapshot.updatedAt)}</span>}
      </p>
      {!!snapshot.unavailable?.length && (
        <div className="scene-warning" role="status">
          {snapshot.unavailable.map((item, index) => (
            <p key={`${item.id}:${index}`}>
              {systemText(item.name)} {item.version && `v${item.version}`}：{item.reason}
            </p>
          ))}
        </div>
      )}
      <div className="plugin-grid">
        {items.map(({ item, installed, compatible, updateAvailable }) => (
          <article
            data-plugin-id={item.manifest.id}
            className="panel plugin-card"
            key={item.manifest.id}
          >
            <div className="plugin-card-top">
              <div className={`plugin-mark ${item.manifest.category}`}>
                <Icon name="plugin" size={26} />
              </div>
              <span className="status-pill">{categories[item.manifest.category]}</span>
            </div>
            <div className="plugin-card-title">
              <h3>{systemText(item.manifest.name)}</h3>
            </div>
            <div className="plugin-version-info">
              <span>{installed ? `已安装 v${installed.item.manifest.version}` : '尚未安装'}</span>
              <span
                className={updateAvailable ? 'plugin-update-badge' : ''}
              >{`最新 v${installed && compareVersions(installed.item.manifest.version, item.manifest.version) > 0 ? installed.item.manifest.version : item.manifest.version}`}</span>
            </div>
            <small className="plugin-publisher">
              {systemText(item.manifest.publisher)} <Icon name="check" size={12} /> · 本机插件
            </small>
            <p className="plugin-description">{systemText(item.manifest.description)}</p>
            <div className="plugin-permissions">
              {item.manifest.permissions.length ? (
                item.manifest.permissions.map((p) => (
                  <span key={p}>{pluginPermissions[p].name}</span>
                ))
              ) : (
                <span>无额外权限</span>
              )}
            </div>
            <div className="plugin-card-actions">
              {installed ? (
                <>
                  {installed.enabled ? (
                    <button
                      className="button"
                      onClick={() =>
                        installed.item.manifest.sceneSources?.length
                          ? onInsert(item.manifest.id)
                          : onOpen(item.manifest.id)
                      }
                    >
                      {installed.item.manifest.sceneSources?.length ? '加入场景' : '打开'}{' '}
                      <Icon name="arrow" size={13} />
                    </button>
                  ) : (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void onCommand({ action: 'enable', id: item.manifest.id, enabled: true })
                      }
                    >
                      启用插件
                    </button>
                  )}
                  {installed.enabled &&
                    installed.item.manifest.sceneSources?.length &&
                    installed.item.manifest.workspace === true && (
                      <button className="button secondary" onClick={() => onOpen(item.manifest.id)}>
                        打开管理
                      </button>
                    )}
                  {updateAvailable && (
                    <button
                      className="button secondary"
                      disabled={busy || !compatible}
                      onClick={() =>
                        installed.item.manifest.permissions.length ===
                          item.manifest.permissions.length &&
                        item.manifest.permissions.every((permission) =>
                          installed.item.manifest.permissions.includes(permission),
                        )
                          ? void install(item)
                          : setReview(item)
                      }
                    >
                      更新至 v{item.manifest.version}
                    </button>
                  )}
                  {!updateAvailable && (
                    <button
                      className="text-button"
                      disabled={busy || snapshot.status === 'syncing'}
                      onClick={() => void onCommand({ action: 'sync' })}
                    >
                      检查更新
                    </button>
                  )}
                  {snapshot.rollback?.[item.manifest.id] && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            '恢复上次安装版本与更新前的插件数据？场景使用固定版本，暂停后可在来源属性中套用回退版本。',
                          )
                        )
                          void onCommand({ action: 'rollback', id: item.manifest.id });
                      }}
                    >
                      回退至 v{snapshot.rollback[item.manifest.id]}
                    </button>
                  )}
                  {installed.enabled && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void onCommand({ action: 'enable', id: item.manifest.id, enabled: false })
                      }
                    >
                      禁用
                    </button>
                  )}
                  <button
                    className="text-button plugin-remove"
                    disabled={busy}
                    onClick={() => void onCommand({ action: 'remove', id: item.manifest.id })}
                  >
                    移除
                  </button>
                </>
              ) : (
                <button
                  className="button"
                  disabled={busy || !compatible}
                  onClick={() => setReview(item)}
                >
                  <Icon name="download" size={14} />
                  安装插件
                </button>
              )}
              {!compatible && <small>请先更新工作台</small>}
            </div>
            {!!installed &&
              pendingLayers(item.manifest.id, installed.item.manifest.version).length > 0 && (
                <div className="plugin-scene-update">
                  <span>
                    {pendingLayers(item.manifest.id, installed.item.manifest.version).some(
                      (view) => view.source?.kind !== 'status' && view.runtime.status === 'running',
                    )
                      ? '运行中的旧版来源暂停后可应用新版'
                      : '场景来源可应用已安装的新版'}
                  </span>
                  <button
                    className="button secondary"
                    disabled={
                      busy ||
                      !installed.enabled ||
                      pendingLayers(item.manifest.id, installed.item.manifest.version).some(
                        (view) =>
                          view.source?.kind !== 'status' && view.runtime.status === 'running',
                      )
                    }
                    onClick={() =>
                      void applySources(item.manifest.id, installed.item.manifest.version)
                    }
                  >
                    应用到当前场景（
                    {pendingLayers(item.manifest.id, installed.item.manifest.version).length}）
                  </button>
                </div>
              )}
          </article>
        ))}
      </div>
      {!items.length && (
        <section className="panel plugin-empty">
          <Icon name="plugin" size={32} />
          <h3>
            {search
              ? '没有符合的插件'
              : filter === 'installed'
                ? '尚未安装插件'
                : filter === 'updates'
                  ? '所有插件均已是最新版本'
                  : '插件区还没有插件'}
          </h3>
          <p>{search ? '试试其他关键字。' : '把插件 ZIP 放进插件区后再扫描。'}</p>
        </section>
      )}
      {review && (
        <div className="modal-backdrop" onClick={() => !busy && setReview(null)}>
          <section
            className="launch-modal plugin-review"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugin-review-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !busy) setReview(null);
            }}
          >
            <button
              className="modal-close"
              aria-label="关闭安装确认"
              autoFocus
              disabled={busy}
              onClick={() => setReview(null)}
            >
              ×
            </button>
            <span className="eyebrow">
              {snapshot.installed.some((entry) => entry.item.manifest.id === review.manifest.id)
                ? '更新插件'
                : '安装插件'}
            </span>
            <h2 id="plugin-review-title">{systemText(review.manifest.name)}</h2>
            <p>
              安装 v{review.manifest.version} · {systemText(review.manifest.publisher)}
            </p>
            <h3>此插件需要以下权限</h3>
            <div className="plugin-review-permissions">
              {review.manifest.permissions.length ? (
                review.manifest.permissions.map((p) => (
                  <div key={p}>
                    <Icon name="check" size={16} />
                    <div>
                      <strong>{pluginPermissions[p].name}</strong>
                      <p>{pluginPermissions[p].description}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p>不需要额外权限。</p>
              )}
            </div>
            <p>插件会在工作台内打开；可随时禁用或移除，移除后会保留已保存的插件数据。</p>
            <button
              className="button full"
              disabled={busy}
              onClick={async () => {
                if (await install(review)) setReview(null);
              }}
            >
              {busy
                ? '正在安装与校验…'
                : snapshot.installed.some((entry) => entry.item.manifest.id === review.manifest.id)
                  ? '同意权限并更新'
                  : '同意权限并安装'}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
