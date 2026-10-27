/** Local review harness. Uses the actual SceneManager reducer; never connects to a live room. */
import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { LocalStore } from '@zhuda/core';
import { pluginDescriptorSchema, type SceneFrameState } from '@zhuda/contracts';
import { SceneManager, type ScenePlugins } from '../client/src/main/scenes/manager';
import { elapsedSeconds } from '../client/src/main/scenes/variables';

const rootArg = process.argv.find((a) => a.startsWith('--root='));
const root = rootArg ? rootArg.slice(7) : fileURLToPath(new URL('../', import.meta.url));
const catalogItem = JSON.parse(readFileSync(join(root, 'plugin/catalog-item.json'), 'utf8'));
const descriptor = pluginDescriptorSchema.parse({
  manifest: catalogItem.manifest,
  sha256: catalogItem.sha256,
  bytes: catalogItem.bytes,
});
const item = {
  ...descriptor,
  signature: catalogItem.signature,
  downloadPath: catalogItem.downloadPath,
};
const store = new LocalStore(':memory:');
const plugins: ScenePlugins = {
  sceneVersionAllowed: () => true,
  installedItem: () => item as never,
  validateInstalled: () => item as never,
  snapshot: () => ({ installed: [{ item: item as never, enabled: true }] }),
};
const engine = new SceneManager(store, plugins, () => ({ state: 'disconnected', webId: '' }));
engine.command({ action: 'add', pluginId: 'plugin.dragon', sourceId: 'duel' });
const id = engine.snapshot().document.layers[0]!.id;
engine.command({ action: 'control', id, state: 'start', mode: 'demo' });
const clients = new Set<http.ServerResponse>();
function frame(): SceneFrameState {
  const view = engine.snapshot().layers[0]!;
  return {
    layerId: id,
    name: view.layer.name,
    settings: view.layer.settings,
    theme: view.layer.theme,
    status: view.runtime.status,
    mode: 'demo',
    playbackTime: elapsedSeconds(view.runtime),
    game: view.runtime.game,
    events: view.runtime.events,
    variables: view.variables,
    battle: view.runtime.battle,
  };
}
function publish() {
  const s = `data: ${JSON.stringify(frame())}\n\n`;
  for (const res of clients) res.write(s);
}
const mime: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript',
  css: 'text/css',
  png: 'image/png',
  mp4: 'video/mp4',
  json: 'application/json',
  zip: 'application/zip',
};
const files = new Map<string, string>([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/src/demo.js', 'src/demo.js'],
  ['/src/styles.css', 'src/styles.css'],
  ['/review', 'verification/v4/index.html'],
  ['/review/report.json', 'verification/v4/report.json'],
  [
    `/dist/plugin.dragon-${item.manifest.version}.zip`,
    `dist/plugin.dragon-${item.manifest.version}.zip`,
  ],
]);
for (const clip of [
  'idle',
  'hit',
  'hit-counter',
  'block-counter',
  'dodge-counter',
  'hero-win',
  'dragon-win',
])
  files.set(`/review/original/${clip}.mp4`, `agent/byteplus-v4/original-packaged/${clip}.mp4`);
for (const name of Object.keys(item.manifest.files)) files.set('/plugin/' + name, 'plugin/' + name);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const json = (status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  if (url.pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    clients.add(res);
    res.write(`data: ${JSON.stringify(frame())}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state' && req.method === 'GET') {
    json(200, frame());
    return;
  }
  if (req.method === 'POST' && ['/api/control', '/api/gift'].includes(url.pathname)) {
    // The demo only accepts same-origin browser requests and binds to loopback.
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      json(403, { error: '来源无效' });
      return;
    }
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) throw new Error('请求过大');
      }
      const data = JSON.parse(body);
      if (url.pathname === '/api/control') {
        if (data.prepSeconds !== undefined) {
          const snapshot = engine.snapshot();
          const layer = snapshot.document.layers[0]!;
          engine.command({
            action: 'patch',
            id,
            revision: snapshot.document.revision,
            patch: { settings: { ...layer.settings, prepSeconds: data.prepSeconds } },
          });
        }
        engine.command({ action: 'control', id, state: data.action, mode: 'demo' });
      } else {
        const event = item.manifest.sceneSources![0]!.events.find((e) => e.id === data.eventId);
        if (!event || !Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 1000)
          throw new Error('模拟份数须为 1–1000');
        engine.command({
          action: 'trigger',
          id,
          eventId: event.id,
          amount: event.default * data.quantity,
          requestId: randomUUID(),
        });
      }
      publish();
      json(200, frame());
    } catch (e) {
      json(400, { error: (e as Error).message });
    }
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method ?? '')) {
    res.writeHead(405);
    res.end();
    return;
  }
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  const name = files.get(url.pathname);
  if (!name) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const path = join(root, name),
      size = statSync(path).size;
    let start = 0,
      end = size - 1,
      status = 200;
    const headers: Record<string, string | number> = {
      'Content-Type': mime[name.split('.').pop()!] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    };
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        res.end();
        return;
      }
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= size
      ) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        res.end();
        return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') res.end();
    else res.end(readFileSync(path).subarray(start, end + 1));
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
const portArg = process.argv.find((a) => a.startsWith('--port='));
let port = portArg ? Number(portArg.slice(7)) : 18888;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('无效端口');
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE' && !portArg && port < 18910) {
    port++;
    server.listen(port, '127.0.0.1');
  } else {
    console.error(e);
    process.exitCode = 1;
  }
});
server.on('listening', () => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(`猪大 VS 恶龙 · 插件试玩\n${url}`);
  if (process.argv.includes('--open'))
    execFile(
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open',
      process.platform === 'win32' ? ['/c', 'start', '', url] : [url],
    );
});
const timer = setInterval(() => {
  engine.reconcile();
  publish();
}, 500);
server.listen(port, '127.0.0.1');
process.on('SIGINT', () => {
  clearInterval(timer);
  for (const res of clients) res.end();
  server.close(() => {
    store.close();
    process.exit();
  });
});
