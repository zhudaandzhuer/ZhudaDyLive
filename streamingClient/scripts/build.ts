import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { zipSync, strToU8 } from 'fflate';
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { APP_VERSION, manifestSchema, type CatalogItem } from '@zhuda/contracts';
import { sha256, signValue, signPluginUpload } from '@zhuda/core';
import { root, authority, paths, pluginsRoot, production } from './config';
import { chainArtwork } from './chain-art';
import { gameHtml } from './game-html';
import { liveModePlugins } from '../../plugins/live-modes/definitions';
import { dragonFiles } from './build-dragon';
import { dragonPlugin } from '../../plugins/dragon/definitions';
import { writeLicenses } from './lib/licenses';

const archiveTime = new Date('2020-01-01T00:00:00Z');
const keys = authority(),
  output = join(root, 'client/dist'),
  packages = paths().packageDir;
// A production build must never inherit development previews or source maps.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
mkdirSync(packages, { recursive: true });
const catalog: CatalogItem[] = [];
const scenePlugins: { item: import('@zhuda/contracts').PluginCatalogItem; bytes: Uint8Array }[] =
  [];
const bundledPlugins = join(output, 'bundled-plugins');
writeLicenses(root, join(output, 'licenses'));
mkdirSync(join(output, 'licenses'), { recursive: true });
for (const [dependency, license] of [
  ['qrcode', 'license'],
  ['pngjs', 'LICENSE'],
  ['dijkstrajs', 'LICENSE.md'],
])
  cpSync(
    join(root, 'node_modules', dependency!, license!),
    join(output, 'licenses', `${dependency}-MIT.txt`),
  );
const licenseDirectory = join(output, 'licenses');
mkdirSync(licenseDirectory, { recursive: true });
cpSync(join(root, 'node_modules/opencc-js/LICENSE'), join(licenseDirectory, 'opencc-js-MIT.txt'));
cpSync(
  join(root, 'node_modules/opencc-js/THIRD_PARTY_LICENSES.md'),
  join(licenseDirectory, 'opencc-data-Apache-2.0.md'),
);
rmSync(bundledPlugins, { recursive: true, force: true });
mkdirSync(bundledPlugins, { recursive: true });
function sceneBundle(info: object, files: Record<string, Uint8Array>) {
  const bytes = zipSync(
    { ...files, 'plugin.json': strToU8(JSON.stringify(info)) },
    { level: 9, mtime: archiveTime },
  );
  const item = signPluginUpload(bytes, keys.privateKey);
  scenePlugins.push({ item, bytes });
  writeFileSync(join(bundledPlugins, `${item.manifest.id}-${item.manifest.version}.zip`), bytes);
}
const artwork = chainArtwork();
// Rasterize the geometry once, rather than tessellating thousands of SVG faces
// for every strand during live effects. Three-times resolution keeps Retina detail.
const textures = Object.fromEntries(
  Object.entries(artwork).map(([name, svg]) => [
    name.replace('.svg', '.png'),
    new Resvg(svg, { fitTo: { mode: 'zoom', value: 3 }, font: { loadSystemFonts: false } })
      .render()
      .asPng(),
  ]),
);
mkdirSync(join(root, 'client/public/generated'), { recursive: true });
for (const [name, svg] of Object.entries(artwork))
  writeFileSync(join(root, 'client/public/generated', name), svg);
for (const [name, png] of Object.entries(textures))
  writeFileSync(join(root, 'client/public/generated', name), png);
for (const game of ['chain', 'prank']) {
  const info = JSON.parse(readFileSync(join(root, `games/${game}/manifest.json`), 'utf8'));
  const script = await build({
    entryPoints: [join(root, 'games/shared/game.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'chrome140',
    minify: true,
  });
  const files: Record<string, Uint8Array> = {
    'game.js': script.outputFiles![0]!.contents,
    'style.css': strToU8(readFileSync(join(root, 'games/shared/style.css'), 'utf8')),
    ...Object.fromEntries(Object.entries(artwork).map(([name, svg]) => [name, strToU8(svg)])),
    ...textures,
    ...(game === 'chain'
      ? Object.fromEntries(
          ['chain-bind.wav', 'chain-fracture.wav', 'sound-notices.json'].map((name) => [
            name,
            new Uint8Array(readFileSync(join(root, 'games/chain/audio', name))),
          ]),
        )
      : {}),
    'index.html': strToU8(gameHtml(game, info.name)),
  };
  const manifest = manifestSchema.parse({
    ...info,
    files: Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [
        name,
        { sha256: sha256(bytes), bytes: bytes.length },
      ]),
    ),
  });
  const zip = zipSync(files, { level: 9, mtime: archiveTime }),
    descriptor = { manifest, sha256: sha256(zip), bytes: zip.length };
  const item: CatalogItem = {
    ...descriptor,
    signature: signValue(descriptor, keys.privateKey),
    downloadPath: `/api/v1/packages/${manifest.id}/${manifest.version}`,
  };
  if (game !== 'prank')
    sceneBundle(
      {
        kind: 'plugin',
        apiVersion: 1,
        id: `plugin.${game}`,
        version: '1.3.3',
        workspace: false,
        minAppVersion: '0.3.0',
        name: manifest.name,
        description: manifest.description,
        publisher: '猪大官方',
        category: 'stream',
        entry: 'index.html',
        permissions: ['scene-events'],
        sceneSources: [
          {
            id: game,
            name: manifest.name,
            description: manifest.description,
            entry: 'index.html',
            width: 1080,
            height: 1920,
            parameters: [
              {
                key: 'bindDuration',
                label: '绑合时长（秒）',
                type: 'number',
                default: 1.1,
                min: 0.6,
                max: 3,
                live: true,
                group: '锁链特效',
              },
              {
                key: 'dissolveDuration',
                label: '消融时长（秒）',
                type: 'number',
                default: 2.4,
                min: 1.2,
                max: 5,
                live: true,
                group: '锁链特效',
              },
              {
                key: 'soundEnabled',
                label: '播放锁链音效',
                type: 'boolean',
                default: true,
                live: true,
                group: '音效',
              },
              {
                key: 'soundVolume',
                label: '音效音量',
                type: 'number',
                default: 60,
                min: 0,
                max: 100,
                live: true,
                group: '音效',
              },
            ],
            completion: { text: '解锁成功！', color: manifest.accent },
            events: manifest.events,
            rules: manifest.rules,
            themes: manifest.themes,
            defaultTheme: manifest.defaultTheme,
            statusSourceId: 'chain-status',
            counter: {
              initial: manifest.initial,
              label: game === 'chain' ? '锁链根数' : '挑战进度',
            },
          },
          {
            id: 'chain-status',
            kind: 'status',
            targetSourceId: 'chain',
            name: '解锁挑战状态面板',
            description: '独立摆放和缩放，实时显示绑定玩法的数量、模式与礼物提示。',
            entry: 'status.html',
            width: 720,
            height: 240,
            runtime: 'static',
            sizing: 'scale',
            parameters: [
              { key: 'title', label: '标题', type: 'text', default: '解锁挑战', live: true },
              {
                key: 'counterLabel',
                label: '计数名称',
                type: 'text',
                default: '剩余锁链',
                live: true,
              },
              {
                key: 'idleText',
                label: '默认提示',
                type: 'text',
                default: '每一份礼物，都有戏。',
                live: true,
              },
              {
                key: 'textColor',
                label: '文字颜色',
                type: 'color',
                default: '#ffffff',
                live: true,
              },
              {
                key: 'backgroundOpacity',
                label: '底板不透明度（%）',
                type: 'number',
                default: 90,
                min: 0,
                max: 100,
                live: true,
              },
              {
                key: 'showProgress',
                label: '显示进度条',
                type: 'boolean',
                default: true,
                live: true,
              },
              {
                key: 'showNotice',
                label: '显示礼物提示',
                type: 'boolean',
                default: true,
                live: true,
              },
            ],
            events: [],
            rules: [],
            themes: [],
          },
        ],
      },
      {
        ...files,
        // The legacy output retains its HUD. Scene sources present it in a separate bound layer.
        'index.html': strToU8(gameHtml(game, info.name, true)),
        'status.html': new Uint8Array(readFileSync(join(root, 'games/chain/status.html'))),
        'status.css': new Uint8Array(readFileSync(join(root, 'games/chain/status.css'))),
        'status.js': (
          await build({
            entryPoints: [join(root, 'games/chain/status.ts')],
            bundle: true,
            write: false,
            format: 'iife',
            target: 'chrome140',
            minify: true,
          })
        ).outputFiles![0]!.contents,
      },
    );
  catalog.push(item);
  writeFileSync(join(packages, `${manifest.id}-${manifest.version}.zip`), zip);
}
const modesScript = await build({
  entryPoints: [join(pluginsRoot, 'live-modes/index.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'chrome140',
  minify: true,
});
const tasksScript = await build({
  entryPoints: [join(pluginsRoot, 'live-modes/tasks.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'chrome140',
  minify: true,
});
for (const info of liveModePlugins) {
  const isTasks = info.id === 'plugin.tasks';
  const files = Object.fromEntries(
    info.sceneSources!.map((source) => [
      source.entry,
      strToU8(
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${source.name}</title><link rel="stylesheet" href="style.css"></head><body data-source="${source.id}"><div id="mode"></div><script src="mode.js"></script></body></html>`,
      ),
    ]),
  );
  if (!isTasks)
    files[info.sceneSources![0]!.entry] = strToU8(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${info.name}</title><link rel="stylesheet" href="style.css"></head><body data-source="${info.sceneSources![0]!.id}"><div id="mode"></div><script src="mode.js"></script></body></html>`,
    );
  sceneBundle(info, {
    ...(!isTasks ? { 'index.html': files[info.sceneSources![0]!.entry]! } : {}),
    ...files,
    'index.html': files[info.sceneSources![0]!.entry]!,
    'style.css': new Uint8Array(
      readFileSync(join(pluginsRoot, `live-modes/${isTasks ? 'tasks' : 'style'}.css`)),
    ),
    'mode.js': (isTasks ? tasksScript : modesScript).outputFiles![0]!.contents,
    ...(!isTasks
      ? Object.fromEntries(
          [
            'sewing-supply.wav',
            'sewing-machine.wav',
            'sewing-finish.wav',
            'sound-notices.json',
          ].map((name) => [
            `audio/${name}`,
            new Uint8Array(readFileSync(join(pluginsRoot, 'live-modes/audio', name))),
          ]),
        )
      : {}),
  });
}
sceneBundle(dragonPlugin, await dragonFiles(root));
writeFileSync(join(packages, 'catalog.json'), JSON.stringify(catalog, null, 2));
rmSync(join(output, 'bundled'), { recursive: true, force: true });
mkdirSync(join(output, 'bundled'), { recursive: true });
for (const item of catalog)
  cpSync(
    join(packages, `${item.manifest.id}-${item.manifest.version}.zip`),
    join(output, 'bundled', `${item.manifest.id}-${item.manifest.version}.zip`),
  );
cpSync(join(packages, 'catalog.json'), join(output, 'bundled/catalog.json'));
const pluginExamples = join(packages, 'plugin-examples');
mkdirSync(pluginExamples, { recursive: true });
for (const plugin of ['notes']) {
  const directory = join(pluginsRoot, plugin);
  const info = JSON.parse(readFileSync(join(directory, 'plugin.json'), 'utf8'));
  const script = await build({
    entryPoints: [join(directory, 'index.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'chrome140',
    minify: true,
  });
  writeFileSync(
    join(pluginExamples, `${info.id}-${info.version}.zip`),
    zipSync(
      {
        'plugin.json': strToU8(JSON.stringify(info)),
        'index.html': new Uint8Array(readFileSync(join(directory, 'index.html'))),
        'style.css': new Uint8Array(readFileSync(join(directory, 'style.css'))),
        'plugin.js': script.outputFiles![0]!.contents,
      },
      { level: 9, mtime: archiveTime },
    ),
  );
}

const basicsScript = await build({
  entryPoints: [join(pluginsRoot, 'scene-basics/index.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'chrome140',
  minify: true,
});
const basicDefinitions = [
  {
    id: 'instructions',
    kind: 'instructions',
    name: '玩法说明',
    description: '自动展示绑定玩法的礼物与触发效果',
    width: 900,
    height: 640,
    parameters: [
      { key: 'title', label: '说明标题', type: 'text', default: '礼物玩法' },
      {
        key: 'layout',
        label: '排列',
        type: 'select',
        default: 'horizontal',
        options: [
          { value: 'horizontal', label: '横向排列' },
          { value: 'vertical', label: '纵向排列' },
        ],
      },
      { key: 'color', label: '文字颜色', type: 'color', default: '#ffffff' },
      { key: 'accent', label: '强调颜色', type: 'color', default: '#d8f68b' },
      { key: 'fontSize', label: '字级', type: 'number', default: 28, min: 12, max: 120 },
      { key: 'panel', label: '显示底板', type: 'boolean', default: true },
    ],
  },
  {
    id: 'text',
    name: '文字',
    description: '直播标题、公告与字幕',
    width: 800,
    height: 160,
    parameters: [
      { key: 'text', label: '文字内容', type: 'text', default: '欢迎来到我的直播间' },
      { key: 'color', label: '文字颜色', type: 'color', default: '#ffffff' },
      { key: 'fontSize', label: '字级', type: 'number', default: 64, min: 12, max: 400 },
      { key: 'bold', label: '粗体', type: 'boolean', default: true },
      {
        key: 'align',
        label: '对齐',
        type: 'select',
        default: 'center',
        options: [
          { value: 'left', label: '靠左' },
          { value: 'center', label: '置中' },
          { value: 'right', label: '靠右' },
        ],
      },
    ],
  },
  {
    id: 'image',
    name: '图片',
    description: '从本机导入图片或 GIF',
    width: 600,
    height: 600,
    parameters: [
      { key: 'file', label: '图片素材', type: 'image', default: '' },
      {
        key: 'fit',
        label: '填满方式',
        type: 'select',
        default: 'contain',
        options: [
          { value: 'contain', label: '完整显示' },
          { value: 'cover', label: '填满裁切' },
          { value: 'fill', label: '拉伸' },
        ],
      },
    ],
  },
  {
    id: 'video',
    runtime: 'media',
    name: '视频',
    description: '从本机导入 MP4 或 WebM，支持循环播放',
    width: 1080,
    height: 608,
    parameters: [
      { key: 'file', label: '视频素材', type: 'video', default: '' },
      { key: 'loop', label: '循环播放', type: 'boolean', default: true },
      {
        key: 'fit',
        label: '填满方式',
        type: 'select',
        default: 'contain',
        options: [
          { value: 'contain', label: '完整显示' },
          { value: 'cover', label: '填满裁切' },
        ],
      },
    ],
  },
  {
    id: 'color',
    name: '色块',
    description: '自订纯色底板或装饰',
    width: 600,
    height: 160,
    parameters: [{ key: 'color', label: '颜色', type: 'color', default: '#d8f68b' }],
  },
];
const basicFiles: Record<string, Uint8Array> = {
  'plugin.js': basicsScript.outputFiles![0]!.contents,
  'style.css': new Uint8Array(readFileSync(join(pluginsRoot, 'scene-basics/style.css'))),
};
for (const source of basicDefinitions)
  basicFiles[`${source.id}.html`] = strToU8(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body data-source="${source.id}"><div id="source"></div><script src="plugin.js"></script></body></html>`,
  );
basicFiles['index.html'] = basicFiles['text.html']!;
sceneBundle(
  {
    kind: 'plugin',
    apiVersion: 1,
    id: 'plugin.scene-basics',
    version: '1.2.3',
    workspace: false,
    minAppVersion: '0.3.0',
    name: '场景基本素材',
    description: '文字、图片、视频与色块，组合你的直播画面。',
    publisher: '猪大官方',
    category: 'assets',
    entry: 'index.html',
    permissions: [],
    sceneSources: basicDefinitions.map((s) => ({
      ...s,
      entry: `${s.id}.html`,
      events: [],
      rules: [],
      themes: [],
    })),
  },
  basicFiles,
);
writeFileSync(
  join(bundledPlugins, 'catalog.json'),
  JSON.stringify(
    scenePlugins.map((p) => p.item),
    null,
    2,
  ),
);
for (const { item, bytes } of scenePlugins)
  writeFileSync(join(pluginExamples, `${item.manifest.id}-${item.manifest.version}.zip`), bytes);

await build({
  entryPoints: [join(root, 'client/src/main/index.ts')],
  outfile: join(output, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  define: {
    __PUBLIC_KEY__: JSON.stringify(keys.publicKey),
    __DEVELOPMENT__: String(!production),
  },
  sourcemap: !production,
  minifySyntax: production,
});
for (const name of ['studio', 'game', 'scene'])
  await build({
    entryPoints: [join(root, `client/src/preload/${name}.ts`)],
    outfile: join(output, `${name}-preload.cjs`),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
  });
await viteBuild({ configFile: join(root, 'client/vite.config.ts'), root: join(root, 'client') });
await build({
  entryPoints: [join(root, 'client/src/renderer/mobile-preview.tsx')],
  outfile: join(output, 'mobile-preview/preview.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome110', 'safari16'],
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
writeFileSync(
  join(output, 'build-info.json'),
  JSON.stringify(
    {
      version: APP_VERSION,
      development: !production,
      publicKeyHash: sha256(keys.publicKey),
    },
    null,
    2,
  ),
);
console.log(`已创建 ${production ? '正式' : '开发'}桌面程序与 ${catalog.length} 个内置游戏包。`);
