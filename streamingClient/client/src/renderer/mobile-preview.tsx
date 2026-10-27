import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SceneSnapshot } from '@zhuda/contracts';
import { SceneStage } from './SceneStage';
import { SceneAudioOutput, type SceneAudioRequest } from './scene-audio';
import './style.css';
import './mobile-preview.css';

/** Translate host timestamps once per connection, including completion/effect deadlines. */
function phoneClock(scene: SceneSnapshot, offset: number): SceneSnapshot {
  const iso = (value: string) =>
    Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) + offset).toISOString() : value;
  const game = (value: SceneSnapshot['layers'][number]['runtime']['game']) => ({
    ...value,
    round: value.round ? { ...value.round, startedAt: iso(value.round.startedAt) } : null,
    recent: value.recent.map((action) => ({ ...action, at: iso(action.at) })),
    lastAction: value.lastAction ? { ...value.lastAction, at: iso(value.lastAction.at) } : null,
  });
  return {
    ...scene,
    layers: scene.layers.map((view) => ({
      ...view,
      runtime: {
        ...view.runtime,
        startedAt: iso(view.runtime.startedAt),
        completedAt:
          view.runtime.completedAt === undefined ? undefined : view.runtime.completedAt + offset,
        game: game(view.runtime.game),
        events: view.runtime.events.map((event) => ({ ...event, at: iso(event.at) })),
      },
    })),
  };
}

function MobileScenePreview() {
  const [scene, setScene] = useState<SceneSnapshot | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'ended'>('connecting');
  const [immersive, setImmersive] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundError, setSoundError] = useState('');
  const [audio] = useState(() => new SceneAudioOutput());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const silence = () => {
    audio.mute();
    setSoundEnabled(false);
  };
  const toggleSound = () => {
    if (soundEnabled) {
      silence();
      return;
    }
    setSoundError('');
    void audio.unlock().then(
      (enabled) => {
        if (enabled) setSoundEnabled(true);
      },
      () => {
        silence();
        setSoundError('声音未开启，请再次点击');
      },
    );
  };
  const playSound = (request: SceneAudioRequest) => {
    if (request.action === 'stop') audio.stop(request.layerId);
    else
      void audio.play(request).catch(() => {
        silence();
        setSoundError('声音已暂停，请再次点击开启');
      });
  };
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState !== 'visible') silence();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      audio.dispose();
    };
  }, [audio]);
  useEffect(() => {
    if (connection !== 'live') silence();
  }, [connection]);
  useEffect(() => {
    let offset: number | undefined;
    let disposed = false;
    const stream = new EventSource('events');
    stream.onopen = () => {
      offset = undefined;
    };
    stream.onmessage = (event) => {
      const snapshot = JSON.parse(event.data) as SceneSnapshot;
      offset ??= Date.now() - snapshot.generatedAt;
      setScene(phoneClock(snapshot, offset));
      setConnection('live');
    };
    const ended = () => {
      stream.close();
      setScene(null);
      setConnection('ended');
    };
    stream.addEventListener('ended', ended);
    stream.onerror = () => {
      setConnection('connecting');
      void fetch('snapshot', { cache: 'no-store' })
        .then((response) => {
          if (!disposed && response.status === 404) ended();
        })
        .catch(() => {});
    };
    const wake = () => {
      if (document.visibilityState === 'visible' && stream.readyState === EventSource.CLOSED)
        location.reload();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      disposed = true;
      stream.close();
      document.removeEventListener('visibilitychange', wake);
    };
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  const scale = scene
    ? Math.min(size.width / scene.document.width, size.height / scene.document.height)
    : 0;
  return (
    <div
      className={`phone-preview ${immersive ? 'immersive' : ''}`}
      data-connection={connection}
      data-sound={soundEnabled ? 'on' : 'off'}
    >
      <header className="phone-preview-header">
        <div>
          <strong>场景预览</strong>
          <span className="phone-connection">
            {connection === 'live'
              ? '实时同步'
              : connection === 'ended'
                ? '分享已结束'
                : '正在连接…'}
          </span>
        </div>
        <div className="phone-preview-actions">
          <button
            className="phone-sound-toggle"
            aria-pressed={soundEnabled}
            disabled={connection !== 'live'}
            onClick={toggleSound}
          >
            {soundEnabled ? '关闭声音' : '开启声音'}
          </button>
          <button id="phone-fullscreen" onClick={() => setImmersive(true)}>
            全屏预览
          </button>
        </div>
      </header>
      {soundError && (
        <div className="phone-sound-error" role="status">
          {soundError}
        </div>
      )}
      {immersive && (
        <div className="phone-preview-controls">
          <button
            className="phone-sound-toggle"
            aria-pressed={soundEnabled}
            disabled={connection !== 'live'}
            onClick={toggleSound}
          >
            {soundEnabled ? '关闭声音' : '开启声音'}
          </button>
          <button aria-label="退出全屏预览" onClick={() => setImmersive(false)}>
            退出全屏
          </button>
        </div>
      )}
      <main ref={viewport} className="phone-preview-viewport">
        {scene && (
          <div
            className="phone-scene-fit"
            style={{ width: scene.document.width * scale, height: scene.document.height * scale }}
          >
            <SceneStage
              scene={scene}
              scale={scale}
              sound={soundEnabled}
              onAudioRequest={playSound}
            />
          </div>
        )}
        {connection !== 'live' && (
          <div className="phone-preview-notice" role="status">
            <strong>
              {connection === 'ended'
                ? '预览已结束'
                : scene
                  ? '连接中断，正在重连…'
                  : '正在连接电脑…'}
            </strong>
            <p>
              {connection === 'ended'
                ? '请在电脑重新开启手机预览并扫码。'
                : '请保持电脑工作台开启，手机与电脑连接同一网络。'}
            </p>
          </div>
        )}
      </main>
      <footer className="phone-preview-footer">
        {scene ? `${scene.document.width} × ${scene.document.height} · ` : ''}只读预览
      </footer>
    </div>
  );
}
document.documentElement.classList.add('phone-preview-html');
createRoot(document.getElementById('root')!).render(<MobileScenePreview />);
