import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Converter } from 'opencc-js/t2cn';
import { repositoryRoot } from './lib/source-files';
import { pluginsRoot } from './config';

const convert = Converter({ from: 't', to: 'cn' });
const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
const files = ['client/src', 'packages', 'games', 'scripts', 'tests', 'docs'].flatMap((directory) =>
  walk(join(repositoryRoot, directory)),
);
files.push(...walk(pluginsRoot));
files.push(
  ...['client/index.html', 'README.md', 'package.json'].map((file) => join(repositoryRoot, file)),
);
const failures: string[] = [];
for (const path of files) {
  if (!/\.(tsx?|html|css|json|md)$/.test(path)) continue;
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (convert(line) !== line || /zh-(?:TW|Hant)/.test(line))
        failures.push(`${relative(repositoryRoot, path)}:${index + 1}`);
    });
}
if (failures.length) {
  console.error('以下位置仍有非简体系统文案：\n' + failures.join('\n'));
  process.exitCode = 1;
} else console.log('客户端、内置插件与系统文案的简体中文检查通过。');
