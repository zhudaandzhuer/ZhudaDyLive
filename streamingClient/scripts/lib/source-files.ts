import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const pluginsRoot = resolve(repositoryRoot, '..', 'plugins');
const omitted = new Set(['.git', '.local', 'node_modules', 'dist', 'coverage']);
const omittedPaths = ['client/release/', 'client/public/generated/'];

/** Git includes untracked source files; extracted source archives work without Git as well. */
export function sourceFiles(root = repositoryRoot): string[] {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (realpathSync(top) === realpathSync(root)) {
      const cached = execFileSync('git', ['ls-files', '--cached', '-z'], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean);
      const untracked = execFileSync('git', ['ls-files', '--others', '-z'], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean);
      let ignored = new Set<string>();
      if (untracked.length) {
        try {
          ignored = new Set(
            execFileSync('git', ['check-ignore', '--stdin', '--no-index'], {
              cwd: root,
              input: untracked.join('\n') + '\n',
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'ignore'],
            })
              .split(/\r?\n/)
              .filter(Boolean),
          );
        } catch {
          /* Git exits 1 when no paths are ignored. */
        }
      }
      const files = [...new Set([...cached, ...untracked.filter((file) => !ignored.has(file))])];
      return files.filter((file) => existsSync(join(root, file))).sort();
    }
  } catch {
    /* A source ZIP intentionally has no .git directory. */
  }
  const walk = (directory: string, base = root): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = join(directory, entry.name);
      const file = relative(base, absolute).split('\\').join('/');
      if (omitted.has(entry.name) || omittedPaths.some((prefix) => (file + '/').startsWith(prefix)))
        return [];
      return entry.isDirectory() ? walk(absolute, base) : [file];
    });
  return walk(root).sort();
}

/** Files in the repository-level plugin tree, used by public checks and source archives. */
export function pluginSourceFiles(root = pluginsRoot): string[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = join(directory, entry.name);
      if (omitted.has(entry.name)) return [];
      return entry.isDirectory()
        ? walk(absolute)
        : [relative(root, absolute).split('\\').join('/')];
    });
  return walk(root).sort();
}

/** Detect common accidental disclosures; this is not a substitute for reviewing a public diff. */
export function repositoryProblems(files = sourceFiles(), root = repositoryRoot): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const parts = file.split('/');
    if (
      parts.some((part) => omitted.has(part)) ||
      omittedPaths.some((prefix) => file.startsWith(prefix))
    )
      problems.push(`${file}: 运行数据或构建产物进入了源码清单`);
    if (
      (parts.some((part) => /^\.env(?:\.|$)/.test(part)) && file !== '.env.example') ||
      /\.(?:pem|key|p12|pfx|sqlite(?:3)?(?:-wal|-shm)?|db|har|log|zip|exe|dmg)$/i.test(file)
    )
      problems.push(`${file}: 不应公开的配置、凭据、数据或二进制包`);
    const stat = lstatSync(join(root, file));
    if (!stat.isFile()) problems.push(`${file}: 源码归档不接受符号链接或特殊文件`);
    else if (stat.size > 10 * 1024 * 1024)
      problems.push(`${file}: 单文件超过 10 MiB，请使用发行附件或资源服务`);
  }
  return problems;
}
