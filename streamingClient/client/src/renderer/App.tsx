import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneCommand, PluginCommand, StudioCommand, StudioSnapshot } from '@zhuda/contracts';
import { parseRoom, systemText } from '@zhuda/contracts';
import { Icon, collectorLabels } from './ui';
import { SceneEditor } from './SceneEditor';
import { ObservationPanel, type ObservationView } from './ObservationPanel';
import { GuidedTour } from './GuidedTour';
import { PluginStore } from './PluginStore';
import { PluginView } from './PluginView';
import { SettingsQueue } from './settings-queue';
import { GlobalEventPanel } from './GlobalEventPanel';

const tabs = [
  ['live', 'live', '直播观测'],
  ['test', 'play', '测试设置'],
  ['plugins', 'plugin', '插件区'],
] as const;
type TabId = (typeof tabs)[number][0];
const errorText = (error: unknown) =>
  systemText(
    (error instanceof Error ? error.message : String(error)).replace(
      /^Error invoking remote method '[^']+': \w*Error: /,
      '',
    ),
  );

export default function App() {
  const [snapshot, updateSnapshot] = useState<StudioSnapshot | null>(null);
  const setSnapshot = useCallback((next: StudioSnapshot) => {
    updateSnapshot((previous) =>
      previous?.sequence !== undefined &&
      next.sequence !== undefined &&
      next.sequence < previous.sequence
        ? previous
        : next,
    );
  }, []);
  const [tutorial, setTutorial] = useState(false);
  const tutorialChecked = useRef(false);
  const [observationView, setObservationView] = useState<ObservationView>('status');
  const [activePlugin, setActivePlugin] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('live');
  const navigateTour = useCallback((target: 'scene' | 'live' | 'plugins') => {
    if (target === 'live' || target === 'plugins') setTab(target);
  }, []);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [accountMenu, setAccountMenu] = useState(false);
  const [room, setRoom] = useState('');
  const [connecting, setConnecting] = useState(false);
  const collectorPending = useRef(false);
  const [insertPlugin, setInsertPlugin] = useState<string | null>(null);
  const content = useRef<HTMLElement>(null);
  const settingsQueue = useRef<SettingsQueue | null>(null);
  if (!settingsQueue.current)
    settingsQueue.current = new SettingsQueue(async (sceneId, id, values) => {
      try {
        setSnapshot(await window.studio.sceneCommand({ action: 'settings', sceneId, id, values }));
        return true;
      } catch (error) {
        setError(errorText(error));
        return false;
      }
    });
  useEffect(() => {
    content.current?.scrollTo(0, 0);
  }, [tab]);
  useEffect(() => {
    if (snapshot?.collector.webId) setRoom(snapshot.collector.webId);
  }, [snapshot?.collector.webId]);
  useEffect(() => {
    if (!snapshot || tutorialChecked.current) return;
    tutorialChecked.current = true;
    if (!snapshot.tutorialDismissed) setTutorial(true);
  }, [snapshot]);
  useEffect(() => {
    if (!window.studio) {
      setError('请使用桌面工作台启动此界面。');
      return;
    }
    const stop = window.studio.subscribe(setSnapshot);
    window.studio
      .snapshot()
      .then(setSnapshot)
      .catch((e) => setError(errorText(e)));
    return stop;
  }, []);
  async function act(command: StudioCommand, message = '') {
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setSnapshot(await window.studio.command(command));
      if (message) setNotice(message);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function pluginAct(command: PluginCommand) {
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setSnapshot(await window.studio.pluginCommand(command));
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function openPlugin(id: string) {
    setActivePlugin(id);
    setTab('plugins');
  }
  const selectedPlugin = snapshot?.plugins?.installed.find(
    (entry) => entry.item.manifest.id === activePlugin && entry.enabled,
  );
  async function sceneAct(command: SceneCommand) {
    if (command.action === 'settings') {
      const sceneId = command.sceneId ?? snapshot?.scene?.document.id;
      return sceneId ? settingsQueue.current!.save(sceneId, command.id, command.values) : false;
    }
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setSnapshot(
        await window.studio.sceneCommand({
          ...command,
          sceneId: command.sceneId ?? snapshot?.scene?.document.id,
        }),
      );
      return true;
    } catch (error) {
      setError(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function controlCollector(type: 'login' | 'showCollector' | 'stopMonitor') {
    setError('');
    try {
      setSnapshot(await window.studio.command({ type }));
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function openAccount() {
    setError('');
    setNotice('');
    setAccountMenu(false);
    await controlCollector('login');
  }
  async function connectRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (collectorPending.current) return;
    setError('');
    setNotice('');
    try {
      parseRoom(room);
      if (!snapshot?.collector.loggedIn) throw new Error('请先登录抖音，再连接直播间。');
      collectorPending.current = true;
      setConnecting(true);
      setObservationView('status');
      setSnapshot(await window.studio.command({ type: 'monitor', room: room.trim() }));
    } catch (error) {
      setError(errorText(error));
    } finally {
      collectorPending.current = false;
      setConnecting(false);
    }
  }
  function manageConnection() {
    setAccountMenu(false);
    setTab('live');
    requestAnimationFrame(() => document.getElementById('live-room')?.focus());
  }
  if (!snapshot)
    return (
      <div className="app-loading">
        <Icon name="screen" size={30} />
        <h2>正在准备工作台</h2>
        <p role="status">{error || '正在读取本机配置…'}</p>
      </div>
    );
  const status = snapshot.collector;
  return (
    <>
      <div className="app-shell studio-shell">
        <header className="studio-header">
          <div className="studio-brand" aria-label="猪大直播工作台">
            <Icon name="screen" size={20} />
            猪大直播<span>工作台</span>
          </div>
          <div className="studio-header-status">
            <i className={status.state === 'connected' ? 'dot' : 'dot muted'} />
            {collectorLabels[status.state]}
            {status.webId && <span>{status.webId}</span>}
          </div>
          <div className="account-actions">
            <button
              id="account-menu-toggle"
              className="account-menu-toggle"
              aria-expanded={accountMenu}
              aria-controls="account-menu"
              onClick={() => setAccountMenu(!accountMenu)}
            >
              <Icon name="settings" size={15} />
              设置
            </button>
            {accountMenu && (
              <>
                <button
                  className="account-menu-dismiss"
                  aria-label="关闭账号菜单"
                  onClick={() => setAccountMenu(false)}
                />
                <div id="account-menu" className="account-menu">
                  <span>本机运行 · 插件从本地插件区加载</span>
                  <button onClick={() => void act({ type: 'exportDiagnostics' })}>
                    导出诊断报告
                  </button>
                  <button onClick={manageConnection}>
                    <Icon name="link" size={15} />
                    抖音账号与直播连接
                  </button>
                  <button
                    data-tour="replay"
                    onClick={() => {
                      setAccountMenu(false);
                      setTutorial(true);
                    }}
                  >
                    <Icon name="play" size={15} />
                    使用教学
                  </button>
                  <small>
                    v{snapshot.appVersion} · {snapshot.platform === 'darwin' ? 'macOS' : 'Windows'}
                    {snapshot.development ? ' · 开发版' : ''}
                  </small>
                </div>
              </>
            )}
          </div>
        </header>
        <div className="studio-body">
          <aside className="studio-side" aria-label="直播观测与插件">
            <nav className="studio-side-tabs" role="tablist" aria-label="工作台分页">
              {tabs.map(([id, icon, label], index) => (
                <button
                  key={id}
                  id={`tab-${id}`}
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls={`panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => {
                    setTab(id);
                    if (id === 'plugins') setActivePlugin(null);
                  }}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : (index + 1) % tabs.length;
                    setTab(tabs[next]![0]);
                    document.getElementById(`tab-${tabs[next]![0]}`)?.focus();
                  }}
                >
                  <Icon name={icon} size={16} />
                  {label}
                </button>
              ))}
            </nav>
            <section
              ref={content}
              className="studio-side-content"
              id={`panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
            >
              {tab === 'live' ? (
                <>
                  <div className="observation-heading">
                    <div>
                      <span className="eyebrow">直播数据</span>
                      <h2>直播观测</h2>
                    </div>
                    <button className="text-button" id="manage-connection" onClick={openAccount}>
                      {status.loggedIn ? '重新登录' : '登录抖音'}
                      <Icon name="arrow" size={12} />
                    </button>
                  </div>
                  <form className="live-connection-form" onSubmit={connectRoom}>
                    <label htmlFor="live-room">直播间号码／网址</label>
                    <input
                      id="live-room"
                      name="room"
                      type="text"
                      value={room}
                      onChange={(event) => setRoom(event.target.value)}
                      onFocus={() => {
                        void window.studio
                          .setHotkeyCapture(true)
                          .catch((error) => setError(errorText(error)));
                      }}
                      onBlur={() => {
                        void window.studio
                          .setHotkeyCapture(false)
                          .catch((error) => setError(errorText(error)));
                      }}
                      placeholder="直播间号码或完整直播网页链接"
                      maxLength={150}
                      autoComplete="off"
                      spellCheck={false}
                      required
                      aria-describedby="live-room-help"
                    />
                    <p id="live-room-help">
                      {status.loggedIn
                        ? '支持直播间号码或 https://live.douyin.com/ 开头的网页链接。'
                        : '请先点击上方“登录抖音”，扫码后连接直播间。'}
                    </p>
                    <button
                      id="connect-room"
                      type="submit"
                      className="button"
                      disabled={!status.loggedIn || !room.trim() || connecting}
                    >
                      <Icon name="link" size={15} />
                      {connecting ? '正在连接…' : '连接直播间'}
                    </button>
                  </form>
                  <ObservationPanel
                    snapshot={snapshot}
                    view={observationView}
                    onView={setObservationView}
                  />
                  {status.state !== 'idle' && (
                    <div className="observation-actions">
                      <button
                        className="text-button"
                        onClick={() => void controlCollector('showCollector')}
                      >
                        显示采集窗口
                      </button>
                      <button
                        className="text-button"
                        onClick={() => void controlCollector('stopMonitor')}
                      >
                        停止连接
                      </button>
                    </div>
                  )}
                </>
              ) : tab === 'test' ? (
                snapshot.scene ? (
                  <GlobalEventPanel
                    key={snapshot.scene.document.id}
                    scene={snapshot.scene}
                    gifts={snapshot.giftCatalog}
                    platform={snapshot.platform}
                    busy={busy}
                    onCommand={sceneAct}
                  />
                ) : (
                  <p className="empty">正在准备场景测试设置。</p>
                )
              ) : selectedPlugin ? (
                <PluginView
                  key={`${selectedPlugin.item.manifest.id}-${selectedPlugin.item.manifest.version}`}
                  plugin={selectedPlugin}
                  onBack={() => setActivePlugin(null)}
                />
              ) : (
                <PluginStore
                  snapshot={snapshot.plugins}
                  scene={snapshot.scene}
                  onSceneCommand={sceneAct}
                  busy={busy}
                  onCommand={pluginAct}
                  onOpen={openPlugin}
                  onInsert={(id) => setInsertPlugin(id)}
                />
              )}
            </section>
          </aside>
          <main className="studio-scene" aria-label="场景搭建与测试">
            <SceneEditor
              key={snapshot.scene?.document.id}
              snapshot={snapshot}
              busy={busy}
              onCommand={sceneAct}
              onStore={() => {
                setActivePlugin(null);
                setTab('plugins');
              }}
              insertPlugin={insertPlugin}
              onInserted={() => setInsertPlugin(null)}
            />
          </main>
        </div>
        {(error || notice) && (
          <div className={'toast studio-toast ' + (error ? 'error' : 'success')} role="status">
            <Icon name={error ? 'close' : 'check'} size={16} />
            <span>{error || notice}</span>
            <button
              aria-label="关闭提示"
              onClick={() => {
                setError('');
                setNotice('');
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>
      {tutorial && (
        <GuidedTour
          dismissed={snapshot.tutorialDismissed}
          onNavigate={navigateTour}
          onFinish={async (dismissed) => {
            if (!(await act({ type: 'tutorialPreference', dismissed }))) return false;
            setTutorial(false);
            return true;
          }}
        />
      )}
    </>
  );
}
