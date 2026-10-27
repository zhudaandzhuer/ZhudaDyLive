import { mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { build } from 'esbuild';
import { root, authority, pluginsRoot } from './config';
import { dragonFiles } from './build-dragon';
import { dragonPlugin } from '../../plugins/dragon/definitions';
import { signPluginUpload } from '@zhuda/core';
import { writeLicenses } from './lib/licenses';
const destination = resolve(process.argv[2] ?? join(homedir(), 'Desktop/Zhuda-Dragon-Game'));
// Independent review exports do not change the official store listing.
const bytes = zipSync(
  { ...(await dragonFiles(root)), 'plugin.json': strToU8(JSON.stringify(dragonPlugin)) },
  { level: 9, mtime: new Date('2020-01-01T00:00:00Z') },
);
const item = signPluginUpload(bytes, authority().privateKey);
const name = `plugin.dragon-${item.manifest.version}.zip`;
mkdirSync(join(destination, 'plugin'), { recursive: true });
mkdirSync(join(destination, 'dist'), { recursive: true });
cpSync(join(root, 'LICENSE'), join(destination, 'LICENSE'));
cpSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(destination, 'THIRD_PARTY_NOTICES.md'));
writeLicenses(root, join(destination, 'licenses'));
for (const [name, contents] of Object.entries(unzipSync(bytes))) {
  const path = join(destination, 'plugin', name);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}
writeFileSync(join(destination, 'plugin/catalog-item.json'), JSON.stringify(item, null, 2));
writeFileSync(join(destination, 'dist', name), bytes);
cpSync(join(pluginsRoot, 'dragon'), join(destination, 'plugin-src'), { recursive: true });
mkdirSync(join(destination, 'src'), { recursive: true });
for (const file of ['index.html', 'style.css'])
  cpSync(
    join(pluginsRoot, 'dragon/review', file),
    join(destination, file === 'index.html' ? file : 'src/styles.css'),
  );
await build({
  entryPoints: [join(pluginsRoot, 'dragon/review/index.ts')],
  outfile: join(destination, 'src/demo.js'),
  bundle: true,
  format: 'iife',
  target: ['chrome110', 'safari16'],
});
for (const file of ['duel.ts', 'variables.ts']) {
  mkdirSync(join(destination, 'host-integration'), { recursive: true });
  cpSync(join(root, 'client/src/main/scenes', file), join(destination, 'host-integration', file));
}
cpSync(
  join(root, 'packages/contracts/src/duel.ts'),
  join(destination, 'host-integration/duel-contract.ts'),
);
await build({
  entryPoints: [join(root, 'scripts/dragon-preview.ts')],
  outfile: join(destination, 'tools/serve.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'bundle',
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  minify: false,
});
console.log(`已导出 ${name} 与可独立运行的插件试玩到 ${destination}`);
