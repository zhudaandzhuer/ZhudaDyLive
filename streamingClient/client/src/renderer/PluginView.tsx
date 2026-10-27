import React, { useEffect, useRef, useState } from 'react';
import { pluginRequestSchema, systemText, type InstalledPlugin } from '@zhuda/contracts';

export function PluginView({ plugin, onBack }: { plugin: InstalledPlugin; onBack: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [timeout, setTimeoutState] = useState(false);
  const manifest = plugin.item.manifest;
  useEffect(() => {
    let alive = true,
      inFlight = 0,
      start = Date.now(),
      calls = 0;
    const pending = new Set<string>();
    const timer = setTimeout(() => setTimeoutState(true), 15_000);
    const receive = async (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== 'zhuda-plugin-request'
      )
        return;
      const message = event.data;
      if (typeof message.id !== 'string' || message.id.length > 100 || pending.has(message.id))
        return;
      if (Date.now() - start > 60_000) {
        start = Date.now();
        calls = 0;
      }
      if (++calls > 300 || inFlight >= 20) return;
      inFlight++;
      pending.add(message.id);
      const respond = (result: object) => {
        if (alive && event.source === frame.current?.contentWindow)
          frame.current?.contentWindow?.postMessage(
            { channel: 'zhuda-plugin-result', id: message.id, ...result },
            '*',
          );
      };
      try {
        if (JSON.stringify(message.request).length > 1_100_000) throw new Error('插件请求过大');
        const request = pluginRequestSchema.parse(message.request);
        respond({ value: await window.studio.pluginRequest(manifest.id, request) });
      } catch (error) {
        respond({ error: error instanceof Error ? error.message : '插件操作失败' });
      } finally {
        inFlight--;
        pending.delete(message.id);
      }
    };
    window.addEventListener('message', receive);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
    };
  }, [manifest.id, manifest.version]);
  return (
    <section className="plugin-runtime">
      <div className="plugin-runtime-bar">
        <button className="text-button" onClick={onBack}>
          ← 返回插件区
        </button>
        <span>
          {systemText(manifest.publisher)} · v{manifest.version}
        </span>
      </div>
      {!loaded && (
        <p className="plugin-loading" role="status">
          {timeout ? '插件未能加载，请返回商店重新安装或更新。' : '正在打开插件…'}
        </p>
      )}
      <iframe
        ref={frame}
        title={systemText(manifest.name)}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        src={`zhuda-plugin://${manifest.id}/${manifest.version}/assets/${manifest.entry}`}
        onLoad={() => setLoaded(true)}
      />
    </section>
  );
}
