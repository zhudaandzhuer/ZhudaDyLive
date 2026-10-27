import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root, local } from './config';
const children: ChildProcess[] = [];
const require = createRequire(import.meta.url);
const env: NodeJS.ProcessEnv = { ...process.env, LIVE_CLIENT_DATA_DIR: join(local, 'client') };
delete env.ELECTRON_RUN_AS_NODE;
let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  children.reverse().forEach((p) => p.kill('SIGTERM'));
  process.exitCode = code;
}
function run(binary: string, args: string[], extra = {}) {
  const child = spawn(binary, args, { cwd: root, env: { ...env, ...extra }, stdio: 'inherit' });
  children.push(child);
  child.on('error', (e) => {
    console.error(e.message);
    shutdown(1);
  });
  return child;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => shutdown());
const build = run(process.execPath, ['--import', 'tsx', 'scripts/build.ts']);
await new Promise<void>((resolve, reject) => {
  build.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('建置失败'))));
});
const vite = run(process.execPath, [
  join(root, 'node_modules/vite/bin/vite.js'),
  'client',
  '--config',
  'client/vite.config.ts',
]);
vite.once('exit', (code) => {
  if (!closing) shutdown(code || 1);
});
async function ready(url: string) {
  for (let i = 0; i < 100; i++) {
    if (closing) throw new Error('启动已中止');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`无法启动 ${url}`);
}
try {
  await ready('http://127.0.0.1:5174');
  const electron = run(require('electron') as string, ['client'], {
    ELECTRON_RENDERER_URL: 'http://127.0.0.1:5174',
  });
  electron.once('exit', (code) => shutdown(code ?? 0));
} catch (e) {
  console.error(e);
  shutdown(1);
}
