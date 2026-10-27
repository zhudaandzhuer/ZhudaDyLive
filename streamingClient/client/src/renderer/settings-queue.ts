import type { SceneLayer } from '@zhuda/contracts';

// Coalesce picker input while keeping one request in flight. A late response must
// never overwrite the final color or settings belonging to a different scene.
export class SettingsQueue {
  private pending = new Map<
    string,
    { sceneId: string; id: string; values: SceneLayer['settings']; done: ((ok: boolean) => void)[] }
  >();
  private active = false;
  constructor(
    private send: (sceneId: string, id: string, values: SceneLayer['settings']) => Promise<boolean>,
  ) {}
  save(sceneId: string, id: string, values: SceneLayer['settings']): Promise<boolean> {
    return new Promise((resolve) => {
      const key = `${sceneId}:${id}`;
      const entry = this.pending.get(key) ?? { sceneId, id, values: {}, done: [] };
      Object.assign(entry.values, values);
      entry.done.push(resolve);
      this.pending.set(key, entry);
      void this.flush();
    });
  }
  private async flush() {
    if (this.active) return;
    this.active = true;
    try {
      while (this.pending.size) {
        const [key, entry] = this.pending.entries().next().value!;
        this.pending.delete(key);
        let ok = false;
        try {
          ok = await this.send(entry.sceneId, entry.id, entry.values);
        } catch {}
        entry.done.forEach((done) => done(ok));
      }
    } finally {
      this.active = false;
    }
  }
}
