import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from './config';

const temporary = mkdtempSync(join(tmpdir(), 'zhuda-controls-'));
const artifacts = join(root, '.local/controls-smoke');
mkdirSync(artifacts, { recursive: true });
try {
  const runner = join(temporary, 'runner.cjs');
  await build({
    entryPoints: [join(root, 'tests/electron/scenes/controls-smoke.ts')],
    outfile: runner,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LIVE_CLIENT_DATA_DIR: join(temporary, 'profile'),
    LIVE_CONTROLS_MAIN: join(root, 'client/dist/main.cjs'),
    LIVE_CONTROLS_ARTIFACTS: artifacts,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const child = spawn(createRequire(import.meta.url)('electron') as string, [runner], {
    env,
    cwd: root,
    stdio: 'inherit',
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    if (code !== 0) throw new Error(`操作面板验收失败：${code}`);
  } finally {
    clearTimeout(timer);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
