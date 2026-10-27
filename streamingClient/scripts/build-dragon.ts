import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { signPluginUpload } from '@zhuda/core';
import { dragonPlugin } from '../../plugins/dragon/definitions';
import { battleSkinAssets } from '../../plugins/dragon/presentation';
import { root, authority, paths, pluginsRoot } from './config';

export async function dragonFiles(sourceRoot: string) {
  const script = await build({
    entryPoints: [join(pluginsRoot, 'dragon/index.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['chrome110', 'safari16'],
    minify: true,
  });
  return {
    ...Object.fromEntries(
      ['index.html', 'instructions.html', 'style.css', ...battleSkinAssets].map((name) => [
        name,
        new Uint8Array(readFileSync(join(pluginsRoot, 'dragon', name))),
      ]),
    ),
    'plugin.js': script.outputFiles![0]!.contents,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = join(root, 'client/dist/bundled-plugins');
  const catalogPath = join(directory, 'catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const bytes = zipSync(
    { ...(await dragonFiles(root)), 'plugin.json': strToU8(JSON.stringify(dragonPlugin)) },
    { level: 9, mtime: new Date('2020-01-01T00:00:00Z') },
  );
  const item = signPluginUpload(bytes, authority().privateKey);
  const filename = `${item.manifest.id}-${item.manifest.version}.zip`;
  for (const target of [directory, join(paths().packageDir, 'plugin-examples')]) {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, filename), bytes);
  }
  writeFileSync(
    catalogPath,
    JSON.stringify(
      [...catalog.filter((entry: typeof item) => entry.manifest.id !== item.manifest.id), item],
      null,
      2,
    ),
  );
  console.log(`已构建 ${filename}，仅更新本机开发插件；未发布线上商店。`);
}
