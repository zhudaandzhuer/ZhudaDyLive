import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { layerViewport } from './layer-sizing';
import { SceneCompletionEffect } from './SceneCompletionEffect';
import { sceneAudioUrl, type SceneAudioRequest } from './scene-audio';
import type { SceneSnapshot, SceneFrameState } from '@zhuda/contracts';

export function SceneStage({
  scene,
  scale = 1,
  editor = false,
  sound = false,
  onAudioRequest,
}: {
  scene: SceneSnapshot;
  scale?: number;
  editor?: boolean;
  sound?: boolean;
  onAudioRequest?: (request: SceneAudioRequest) => void;
}) {
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const sent = useRef(new Map<string, string>());
  const current = useRef(scene);
  current.current = scene;
  const audio = useRef(sound);
  audio.current = sound;
  const audioOutput = useRef(onAudioRequest);
  audioOutput.current = onAudioRequest;
  const presentationScale = useRef(scale);
  presentationScale.current = scale;
  const send = (id: string, force = false) => {
    const view = current.current.layers.find((v) => v.layer.id === id);
    const target = frames.current.get(id)?.contentWindow;
    if (!view || !view.available || !target) return;
    const content: Omit<SceneFrameState, 'playbackTime'> = {
      audio: {
        enabled:
          audio.current && !['instructions', 'status', 'view'].includes(view.source?.kind ?? ''),
        transport: audioOutput.current ? 'host' : undefined,
      },
      renderScale: presentationScale.current * layerViewport(view.layer).scale,
      viewport: {
        ...layerViewport(view.layer),
        scale: presentationScale.current * layerViewport(view.layer).scale,
      },
      visible: view.layer.visible,
      layerId: id,
      name: view.layer.name,
      settings: view.layer.settings,
      theme: view.layer.theme,
      status: view.runtime.status,
      mode: view.runtime.mode,
      playbackRevision: JSON.stringify([
        view.runtime.startedAt,
        view.runtime.elapsedMs ?? 0,
        view.runtime.status,
        view.runtime.mode,
      ]),
      game: view.runtime.game,
      events: view.runtime.events,
      instructions: view.instructions,
      variables: view.variables,
      battle: view.runtime.battle,
      completion:
        view.runtime.completedAt === undefined
          ? undefined
          : {
              id:
                view.runtime.completionId ??
                `${view.runtime.game.round?.id}:${view.runtime.completedAt}`,
              at: view.runtime.completedAt,
              durationMs: view.runtime.completionDurationMs,
            },
    };
    // Geometry drafts and unrelated scene updates must not seek or restart plugin media.
    const signature = JSON.stringify([
      current.current.document.id,
      view.url,
      content,
      view.runtime.startedAt,
      view.runtime.elapsedMs ?? 0,
    ]);
    if (!force && sent.current.get(id) === signature) return;
    const state: SceneFrameState = {
      ...content,
      // Ready/load can arrive long after the snapshot, so use the actual delivery time.
      playbackTime:
        ((view.runtime.elapsedMs ?? 0) +
          (view.runtime.status === 'running'
            ? Math.max(0, Date.now() - Date.parse(view.runtime.startedAt))
            : 0)) /
        1000,
    };
    target.postMessage({ channel: 'zhuda-scene-state', state }, '*');
    sent.current.set(id, signature);
  };
  useEffect(() => {
    const ready = (event: MessageEvent) => {
      if (event.data?.channel === 'zhuda-scene-error' && typeof event.data.message === 'string') {
        for (const [id, frame] of frames.current)
          if (event.source === frame.contentWindow) {
            const report =
              window.studio?.reportSourceError ?? window.sceneOutput?.reportSourceError;
            if (report) void report(id, event.data.message.slice(0, 500)).catch(() => {});
            break;
          }
        return;
      }
      if (event.data?.channel === 'zhuda-scene-audio' && audioOutput.current) {
        for (const [id, frame] of frames.current) {
          if (event.source !== frame.contentWindow) continue;
          if (event.data.action === 'stop') {
            audioOutput.current({ action: 'stop', layerId: id });
            return;
          }
          const view = current.current.layers.find((v) => v.layer.id === id);
          if (
            event.data.action !== 'play' ||
            !audio.current ||
            !view?.available ||
            ['instructions', 'status', 'view'].includes(view.source?.kind ?? '') ||
            !view.layer.visible ||
            view.runtime.status !== 'running' ||
            !view.url ||
            typeof event.data.volume !== 'number' ||
            !Number.isFinite(event.data.volume)
          )
            return;
          const url = sceneAudioUrl(view.url, event.data.file, location.href);
          if (url)
            audioOutput.current({
              action: 'play',
              layerId: id,
              url,
              volume: Math.max(0, Math.min(1, event.data.volume)),
            });
          return;
        }
      }
      if (event.data?.channel !== 'zhuda-scene-ready') return;
      for (const [id, frame] of frames.current)
        if (event.source === frame.contentWindow) {
          send(id, true);
          break;
        }
    };
    window.addEventListener('message', ready);
    return () => window.removeEventListener('message', ready);
  }, []);
  useLayoutEffect(() => {
    for (const id of sent.current.keys())
      if (!scene.layers.some((v) => v.layer.id === id)) {
        audioOutput.current?.({ action: 'stop', layerId: id });
        sent.current.delete(id);
      }
    for (const id of frames.current.keys()) send(id);
  }, [scene, sound, scale]);
  const doc = scene.document;
  return (
    <div
      className={`scene-stage ${editor ? 'editor-stage' : ''}`}
      data-background={doc.background}
      style={{
        width: doc.width,
        height: doc.height,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      }}
    >
      {/* Keep iframe DOM order stable: moving an iframe resets its browsing context. */}
      {scene.layers
        .map((view, zIndex) => ({ ...view, zIndex }))
        .sort((a, b) => a.layer.id.localeCompare(b.layer.id))
        .map((view) => {
          const { layer, available, url, error, zIndex } = view;
          const viewport = layerViewport(layer);
          return (
            <div
              key={layer.id}
              data-layer-id={layer.id}
              className="scene-render-layer"
              style={{
                left: layer.x,
                top: layer.y,
                width: layer.width,
                height: layer.height,
                transform: `rotate(${layer.rotation}deg)`,
                transformOrigin: 'top left',
                opacity: layer.opacity,
                visibility: layer.visible ? 'visible' : 'hidden',
                zIndex,
              }}
            >
              {available && url ? (
                <iframe
                  style={{
                    width: viewport.width,
                    height: viewport.height,
                    transform: `scale(${viewport.scale})`,
                    transformOrigin: 'top left',
                  }}
                  title={layer.name}
                  name={layer.id}
                  src={url}
                  sandbox="allow-scripts"
                  allow="autoplay"
                  ref={(frame) => {
                    if (frame) frames.current.set(layer.id, frame);
                    else frames.current.delete(layer.id);
                  }}
                  onLoad={() => send(layer.id, true)}
                />
              ) : editor ? (
                <div className="scene-unavailable">
                  <b>{layer.name}</b>
                  <span>{error}</span>
                </div>
              ) : null}
              {view.source?.completion && <SceneCompletionEffect view={view} />}
            </div>
          );
        })}
    </div>
  );
}
export function SceneOutput() {
  const [scene, setScene] = useState<SceneSnapshot | null>(null);
  useEffect(() => {
    document.body.classList.add('scene-output-body');
    document.documentElement.classList.add('scene-output-html');
    let received = false;
    const stop = window.sceneOutput.subscribe((state) => {
      received = true;
      setScene(state);
    });
    void window.sceneOutput.snapshot().then((state) => {
      if (!received) setScene(state);
    });
    return () => {
      stop();
      document.body.classList.remove('scene-output-body');
      document.documentElement.classList.remove('scene-output-html');
    };
  }, []);
  if (!scene) return null;
  return (
    <div
      className="scene-output-root"
      style={{
        background:
          scene.document.background === 'green'
            ? '#00ff00'
            : scene.document.background === 'dark'
              ? '#111714'
              : 'transparent',
      }}
    >
      <SceneStage scene={scene} sound />
    </div>
  );
}
