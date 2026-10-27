import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { zipSync } from 'fflate';
import {
  pluginSourceFiles,
  pluginsRoot,
  repositoryProblems,
  repositoryRoot,
  sourceFiles,
} from './lib/source-files';

const files = sourceFiles();
const pluginFiles = pluginSourceFiles();
const problems = [
  ...repositoryProblems(files),
  ...repositoryProblems(pluginFiles, pluginsRoot).map((problem) => `plugins/${problem}`),
];
if (problems.length) throw new Error(problems.join('\n'));
const { version } = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
const index = process.argv.indexOf('--output');
if (index >= 0 && (!process.argv[index + 1] || process.argv[index + 1]!.startsWith('--')))
  throw new Error('--output 后须提供 ZIP 路径');
const output = resolve(
  index >= 0
    ? process.argv[index + 1]!
    : join(repositoryRoot, '.local/open-source', `zhuda-live-${version}-source.zip`),
);
if (!output.endsWith('.zip')) throw new Error('--output 须为 ZIP 路径');
const prefix = `zhuda-live-${version}`;
const contents = Object.fromEntries([
  ...files.map((file) => [
    `${prefix}/${file}`,
    new Uint8Array(readFileSync(join(repositoryRoot, file))),
  ]),
  ...pluginFiles.map((file) => [
    `${prefix}/plugins/${file}`,
    new Uint8Array(readFileSync(join(pluginsRoot, file))),
  ]),
]);
const bytes = zipSync(contents, { level: 6, mtime: new Date('2020-01-01T00:00:00Z') });
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, bytes);
const sha256 = createHash('sha256').update(bytes).digest('hex');
writeFileSync(output + '.sha256', `${sha256}  ${output.split(/[\\/]/).at(-1)}\n`);
console.log(
  JSON.stringify(
    { output, files: files.length + pluginFiles.length, bytes: bytes.length, sha256 },
    null,
    2,
  ),
);
