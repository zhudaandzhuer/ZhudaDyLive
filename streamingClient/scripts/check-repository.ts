import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
const textFiles = [
  ...files.map((file) => ({ file, root: repositoryRoot })),
  ...pluginFiles.map((file) => ({ file: `plugins/${file}`, root: pluginsRoot })),
].filter(({ file }) => /\.(?:[cm]?tsx?|jsx?|json|md|ya?ml|html|css|txt|example)$/.test(file));
for (const { file, root } of textFiles) {
  const relativeFile = file.startsWith('plugins/') ? file.slice('plugins/'.length) : file;
  const text = readFileSync(join(root, relativeFile), 'utf8');
  const rules = [
    [/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/, '包含私钥'],
    [/(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16})/, '包含访问凭据'],
    [/(?:\/Users\/|C:\\Users\\)[A-Za-z0-9._-]+/, '包含本机用户绝对路径'],
  ] as const;
  for (const [pattern, reason] of rules)
    if (pattern.test(text)) problems.push(`${file}: ${reason}`);
  if (file.endsWith('.md')) {
    for (const match of text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1]!;
      if (/^(?:[a-z]+:|#|\/)/i.test(target)) continue;
      let path: string;
      try {
        path = decodeURIComponent(target.split('#')[0]!);
      } catch {
        continue;
      }
      if (path && !existsSync(resolve(root, dirname(relativeFile), path)))
        problems.push(`${file}: 文档链接不存在：${path}`);
    }
  }
}
for (const file of ['LICENSE', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', '.env.example'])
  if (!files.includes(file)) problems.push(`${file}: 缺少开源入口文件`);
if (!existsSync(resolve(repositoryRoot, '../.github/workflows/ci.yml')))
  problems.push('../.github/workflows/ci.yml: 缺少开源入口文件');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `源码公开检查通过：${files.length} 个文件；文档链接、常见敏感文件和凭据模式均已检查。`,
  );
