import { APP_VERSION } from '@zhuda/contracts';
import { packager } from '@electron/packager';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from './config';
const args = process.argv.slice(2);
function option(name: string, fallback: string) {
  const i = args.indexOf('--' + name);
  return i < 0 ? fallback : args[i + 1] || '';
}
const platform = option('platform', process.platform),
  arch = option('arch', process.arch);
if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch))
  throw new Error('支持 --platform darwin|win32 --arch arm64|x64');
const info = JSON.parse(readFileSync(join(root, 'client/dist/build-info.json'), 'utf8'));
if (info.development && !args.includes('--development'))
  throw new Error('正式打包前须 NODE_ENV=production npm run build；本机测试包加 --development');
const staging = mkdtempSync(join(tmpdir(), 'zhuda-package-'));
try {
  cpSync(join(root, 'client/dist'), join(staging, 'dist'), { recursive: true });
  cpSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(staging, 'THIRD_PARTY_NOTICES.md'));
  cpSync(join(root, 'LICENSE'), join(staging, 'LICENSE'));
  writeFileSync(
    join(staging, 'package.json'),
    JSON.stringify({
      name: 'zhuda-live',
      productName: 'ZhudaLive',
      version: APP_VERSION,
      main: 'dist/main.cjs',
      private: true,
      license: 'MIT',
    }),
  );
  const outputs = await packager({
    dir: staging,
    out: join(root, 'client/release'),
    name: info.development ? 'ZhudaLive-Dev' : 'ZhudaLive',
    platform: platform as 'darwin' | 'win32',
    arch: arch as 'arm64' | 'x64',
    electronVersion: '44.9.0',
    asar: true,
    prune: false,
    overwrite: true,
    appBundleId: 'com.zhudaandzhuer.live',
    appCategoryType: 'public.app-category.entertainment',
  });
  console.log(outputs.join('\n'));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
