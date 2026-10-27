export type SceneAudioRequest =
  | { action: 'play'; layerId: string; url: string; volume: number }
  | { action: 'stop'; layerId: string };

/** Audio stays inside the requesting plugin's asset directory. */
export function sceneAudioUrl(entry: string, file: unknown, base?: string): string | null {
  if (
    typeof file !== 'string' ||
    !/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*\.(wav|mp3|ogg|m4a|aac|webm)$/.test(file) ||
    file.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return null;
  try {
    return new URL(file, new URL('.', new URL(entry, base))).href;
  } catch {
    return null;
  }
}

/** One unlocked parent context also works with sandboxed plugin frames on mobile browsers. */
export class SceneAudioOutput {
  private context: AudioContext | null = null;
  private enabled = false;
  private generation = 0;
  private stopped = new Map<string, number>();
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private voices = new Map<AudioBufferSourceNode, string>();

  async unlock() {
    const generation = this.generation;
    const context = (this.context ??= new AudioContext());
    // Both calls happen in the tap handler, before yielding user activation.
    const resumed = context.resume();
    const silent = context.createBufferSource();
    silent.buffer = context.createBuffer(1, 1, context.sampleRate);
    silent.connect(context.destination);
    silent.onended = () => silent.disconnect();
    silent.start();
    await resumed;
    if (generation !== this.generation) return false;
    if (context.state !== 'running') throw new Error('声音未开启，请再次点击');
    this.enabled = true;
    return true;
  }

  async play(request: Extract<SceneAudioRequest, { action: 'play' }>) {
    const context = this.context;
    if (!this.enabled || !context) return;
    if (context.state !== 'running') throw new Error('请再次点击开启声音');
    const generation = this.generation;
    const stopped = this.stopped.get(request.layerId);
    const requestedAt = Date.now();
    let buffer = this.buffers.get(request.url);
    if (!buffer) {
      buffer = fetch(request.url, { credentials: 'omit' }).then(async (response) => {
        if (!response.ok) throw new Error('音效加载失败，请再次点击开启声音');
        return context.decodeAudioData(await response.arrayBuffer());
      });
      this.buffers.set(request.url, buffer);
      if (this.buffers.size > 32) this.buffers.delete(this.buffers.keys().next().value!);
    }
    let decoded: AudioBuffer;
    try {
      decoded = await buffer;
    } catch (error) {
      this.buffers.delete(request.url);
      if (generation === this.generation) throw error;
      return;
    }
    if (
      !this.enabled ||
      generation !== this.generation ||
      stopped !== this.stopped.get(request.layerId) ||
      Date.now() - requestedAt > 1000
    )
      return;
    for (const [voice, layerId] of this.voices) {
      const sameLayer = [...this.voices.values()].filter((id) => id === request.layerId).length;
      if (this.voices.size < 8 && (layerId !== request.layerId || sameLayer < 2)) continue;
      voice.stop();
      voice.disconnect();
      this.voices.delete(voice);
    }
    const voice = context.createBufferSource();
    const gain = context.createGain();
    voice.buffer = decoded;
    gain.gain.value = Math.max(0, Math.min(1, request.volume));
    voice.connect(gain).connect(context.destination);
    voice.onended = () => {
      this.voices.delete(voice);
      voice.disconnect();
      gain.disconnect();
    };
    this.voices.set(voice, request.layerId);
    voice.start();
  }

  stop(layerId?: string) {
    if (layerId === undefined) {
      this.generation++;
      this.stopped.clear();
    } else this.stopped.set(layerId, (this.stopped.get(layerId) ?? 0) + 1);
    for (const [voice, id] of this.voices) {
      if (layerId !== undefined && id !== layerId) continue;
      voice.stop();
      voice.disconnect();
      this.voices.delete(voice);
    }
  }

  mute() {
    this.enabled = false;
    this.stop();
  }

  dispose() {
    this.mute();
    this.buffers.clear();
    void this.context?.close();
    this.context = null;
  }
}
