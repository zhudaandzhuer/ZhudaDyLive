import type { StudioSnapshot } from '@zhuda/contracts';

/** Whitelist fields: never export cookies, messages, paths or user settings. */
export function diagnosticReport(snapshot: StudioSnapshot) {
  return {
    format: 'zhuda-diagnostics',
    version: 1,
    at: new Date().toISOString(),
    appVersion: snapshot.appVersion,
    platform: snapshot.platform,
    collector: { state: snapshot.collector.state, parseErrors: snapshot.collector.parseErrors },
    plugins: snapshot.plugins?.installed.map((p) => ({
      id: p.item.manifest.id,
      version: p.item.manifest.version,
      enabled: p.enabled,
    })),
    scene: snapshot.scene && {
      width: snapshot.scene.document.width,
      height: snapshot.scene.document.height,
      layers: snapshot.scene.layers.map((v) => ({
        id: v.layer.id,
        pluginId: v.layer.pluginId,
        pluginVersion: v.layer.pluginVersion,
        sourceId: v.layer.sourceId,
        status: v.runtime.status,
        available: v.available,
        failedAt: v.failure?.at,
      })),
    },
  };
}
