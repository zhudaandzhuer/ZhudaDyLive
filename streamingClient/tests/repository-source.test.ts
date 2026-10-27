import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { repositoryProblems, sourceFiles } from '../scripts/lib/source-files';

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'zhuda-source-'));
  directories.push(root);
  const write = (file: string, content = 'fixture') => {
    const path = join(root, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  };
  return { root, write };
}
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

it('解压源码在没有 Git 时仍能检查，依赖和运行产物不会再次归档', () => {
  const { root, write } = fixture();
  for (const file of [
    'README.md',
    '.env.example',
    'client/src/index.ts',
    '.local/client/data.sqlite',
    'node_modules/lib/index.js',
    'client/dist/main.cjs',
    'client/release/app.exe',
    'client/public/generated/art.png',
  ])
    write(file);
  expect(sourceFiles(root)).toEqual(['.env.example', 'README.md', 'client/src/index.ts']);
  expect(repositoryProblems(sourceFiles(root), root)).toEqual([]);
  write('.env', 'PRIVATE_SETTING=fixture');
  expect(repositoryProblems(sourceFiles(root), root)).toContain(
    '.env: 不应公开的配置、凭据、数据或二进制包',
  );
});

it('Git 清单包含新增源码，并拒绝被强制加入版本控制的私密数据', () => {
  const { root, write } = fixture();
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  write('.gitignore', '.env\n.local/\n');
  write('new-source.ts');
  write('.env');
  write('.local/private.pem');
  expect(sourceFiles(root)).toEqual(expect.arrayContaining(['.gitignore', 'new-source.ts']));
  execFileSync('git', ['add', '--force', '.env', '.local/private.pem'], { cwd: root });
  const problems = repositoryProblems([...sourceFiles(root), '.env', '.local/private.pem'], root);
  expect(problems.some((problem) => problem.startsWith('.env:'))).toBe(true);
  expect(problems.some((problem) => problem.startsWith('.local/private.pem:'))).toBe(true);
});

it('归档不跟随符号链接读取仓库外文件', () => {
  const { root, write } = fixture();
  write('outside/secret.txt');
  mkdirSync(join(root, 'source'));
  symlinkSync(join(root, 'outside'), join(root, 'source', 'escape'), 'junction');
  expect(sourceFiles(join(root, 'source'))).toEqual(['escape']);
  expect(repositoryProblems(['escape'], join(root, 'source'))).toEqual([
    'escape: 源码归档不接受符号链接或特殊文件',
  ]);
});
