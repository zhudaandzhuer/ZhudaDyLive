import { createServer, type Server, type ServerResponse, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import type { MobilePreviewStatus, SceneSnapshot } from '@zhuda/contracts';

export function lanAddresses() {
  return Object.entries(networkInterfaces())
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter(
          (entry) =>
            entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'),
        )
        .map((entry) => ({ name, address: entry.address })),
    )
    .sort(
      (a, b) =>
        Number(/^(utun|tun|tap|docker|veth|bridge)/i.test(a.name)) -
        Number(/^(utun|tun|tap|docker|veth|bridge)/i.test(b.name)),
    )
    .filter(
      (entry, index, entries) =>
        entries.findIndex((other) => other.address === entry.address) === index,
    );
}

/** Only the current scene's render data crosses the LAN boundary. */
export function previewScene(scene: SceneSnapshot, base: string) {
  const projected: SceneSnapshot = {
    document: { ...scene.document, layers: [] },
    library: [],
    outputOpen: false,
    generatedAt: scene.generatedAt,
    layers: scene.layers
      .filter((view) => view.available && view.layer.visible)
      .map((view) => ({
        ...view,
        error: null,
        layer: { ...view.layer, rules: [], hotkeys: [] },
        source: view.source ? { ...view.source, parameters: [], rules: [], events: [] } : null,
        runtime: {
          ...view.runtime,
          webId: '',
          startSeq: '',
          game: {
            ...view.runtime.game,
            round: view.runtime.game.round
              ? { ...view.runtime.game.round, webId: '', startSeq: '', rules: [] }
              : null,
          },
          events: view.runtime.events.map((event) => ({ ...event, webId: '' })),
        },
      })),
  };
  projected.document.layers = projected.layers.map((view) => view.layer);
  return JSON.parse(
    JSON.stringify(projected, (_key, value) => {
      if (typeof value !== 'string') return value;
      if (value.startsWith('zhuda-plugin://'))
        return value.replace('zhuda-plugin://', `${base}plugin/`);
      if (value.startsWith('zhuda-scene://media/'))
        return value.replace('zhuda-scene://media/', `${base}media/`);
      return value;
    }),
  ) as SceneSnapshot;
}

interface PreviewOptions {
  assets: string;
  snapshot: () => SceneSnapshot;
  plugin: (request: Request) => Response;
  media: (request: Request) => Response;
  addresses?: typeof lanAddresses;
}

const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><title>猪大直播 · 手机预览</title><link rel="stylesheet" href="preview.css"></head><body><div id="root"></div><script src="preview.js" defer></script></body></html>`;

export class MobilePreview {
  private server: Server | null = null;
  private token = '';
  private port = 0;
  private starting: Promise<MobilePreviewStatus> | null = null;
  private clients = new Set<ServerResponse>();
  private heartbeat: NodeJS.Timeout | null = null;
  private qr = new Map<string, string>();
  constructor(private options: PreviewOptions) {}
  private get addresses() {
    return (this.options.addresses ?? lanAddresses)();
  }
  private get base() {
    return `/p/${this.token}/`;
  }

  async status(): Promise<MobilePreviewStatus> {
    if (!this.server) return { active: false, addresses: [] };
    const addresses = await Promise.all(
      this.addresses.map(async ({ name, address }) => {
        const url = `http://${address}:${this.port}${this.base}`;
        if (!this.qr.has(url))
          this.qr.set(
            url,
            await QRCode.toDataURL(url, { width: 320, margin: 2, errorCorrectionLevel: 'M' }),
          );
        return { name, address, url, qr: this.qr.get(url)! };
      }),
    );
    return { active: true, addresses };
  }

  start(): Promise<MobilePreviewStatus> {
    if (this.starting) return this.starting;
    if (this.server) return this.status();
    this.starting = this.listen().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async listen() {
    if (!this.addresses.length) throw new Error('没有可用的局域网地址，请连接 Wi-Fi 或网线后重试');
    const server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.maxHeadersCount = 30;
    this.token = randomBytes(24).toString('hex');
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '0.0.0.0', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.port = (server.address() as { port: number }).port;
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) client.write(': heartbeat\n\n');
    }, 15_000);
    this.heartbeat.unref();
    return this.status();
  }

  publish() {
    if (!this.server || !this.clients.size) return;
    const data = this.message();
    for (const client of this.clients) {
      // A suspended phone must not accumulate an unbounded event queue.
      if (client.writableLength > 2_000_000) client.destroy();
      else client.write(data);
    }
  }

  private message() {
    return `data: ${JSON.stringify(previewScene(this.options.snapshot(), this.base))}\n\n`;
  }

  stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const client of this.clients) client.end('event: ended\ndata: {}\n\n');
    this.clients.clear();
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = null;
    this.token = '';
    this.qr.clear();
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    );
    const host = request.headers.host ?? '';
    const allowedHosts = ['127.0.0.1', ...this.addresses.map((entry) => entry.address)].map(
      (address) => `${address}:${this.port}`,
    );
    const origin = request.headers.origin;
    const raw = request.url ?? '';
    if (
      !this.server ||
      !allowedHosts.includes(host) ||
      !raw.startsWith(this.base) ||
      raw.includes('?') ||
      raw.includes('%') ||
      raw.includes('..') ||
      (origin && origin !== 'null' && origin !== `http://${host}`)
    ) {
      response.writeHead(404).end('预览不存在或已结束');
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const path = raw.slice(this.base.length);
    if (path === 'events' && request.method === 'GET') {
      if (this.clients.size >= 12) {
        response.writeHead(503).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
      response.write('retry: 2000\n' + this.message());
      this.clients.add(response);
      response.once('close', () => this.clients.delete(response));
      return;
    }
    if (path === '' || path === 'preview.js' || path === 'preview.css' || path === 'snapshot') {
      const content =
        path === ''
          ? page
          : path === 'snapshot'
            ? JSON.stringify(previewScene(this.options.snapshot(), this.base))
            : readFileSync(join(this.options.assets, path));
      const mime =
        path === ''
          ? 'text/html'
          : path === 'snapshot'
            ? 'application/json'
            : path.endsWith('.js')
              ? 'text/javascript'
              : 'text/css';
      response.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` });
      response.end(request.method === 'HEAD' ? undefined : content);
      return;
    }
    const scene = this.options.snapshot();
    let result: Response | undefined;
    if (path.startsWith('plugin/')) {
      const match =
        /^plugin\/(plugin\.[a-z0-9-]+)\/(\d+\.\d+\.\d+)\/assets\/([a-zA-Z0-9_.\/-]+)$/.exec(path);
      if (
        match &&
        scene.layers.some(
          (view) =>
            view.available &&
            view.layer.visible &&
            view.layer.pluginId === match[1] &&
            view.layer.pluginVersion === match[2],
        )
      )
        result = this.options.plugin(new Request(`zhuda-plugin://${path.slice(7)}`));
    } else if (path.startsWith('media/')) {
      const url = `zhuda-scene://${path}`;
      // Only exact media URLs referenced by the current visible scene are reachable.
      const values = scene.layers
        .filter((view) => view.available && view.layer.visible)
        .flatMap((view) => [view.layer.settings, view.instructions]);
      const referenced = new Set<string>();
      JSON.stringify(values, (_key, value) => {
        if (typeof value === 'string') referenced.add(value);
        return value;
      });
      if (referenced.has(url))
        result = this.options.media(
          new Request(url, {
            headers: request.headers.range ? { Range: request.headers.range } : {},
          }),
        );
    }
    if (!result) {
      response.writeHead(404).end('资源不可用');
      return;
    }
    // Preserve content/range headers; replace custom-protocol CSP with the LAN policy above.
    for (const name of [
      'Content-Type',
      'Content-Length',
      'Content-Range',
      'Accept-Ranges',
      'Access-Control-Allow-Origin',
    ]) {
      const value = result.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    response.writeHead(result.status);
    response.end(request.method === 'HEAD' ? undefined : Buffer.from(await result.arrayBuffer()));
  }
}
