import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/** Preserve notices for runtime dependencies, including code bundled into JS files. */
export function writeLicenses(root: string, output: string) {
  root = realpathSync(root);
  mkdirSync(output, { recursive: true });
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
    cpSync(join(root, file), join(output, file));
  const visited = new Set<string>();
  const records: { name: string; version: string; license: string; notices: string[] }[] = [];
  const resolveDependency = (from: string, name: string) => {
    let directory = from;
    while (true) {
      const candidate = join(directory, 'node_modules', name);
      if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
      const parent = dirname(directory);
      if (parent === directory) throw new Error(`缺少运行依赖 ${name}，请先运行 npm ci`);
      directory = parent;
    }
  };
  const visit = (directory: string) => {
    if (visited.has(directory)) return;
    visited.add(directory);
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    if (!pkg.name.startsWith('@zhuda/') && directory !== root) {
      const noticeFiles = readdirSync(directory, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() &&
            /^(?:licen[sc]e|copying|notice|third[_-]?party)(?:[._-]|$)/i.test(entry.name),
        )
        .map((entry) => entry.name)
        .sort();
      const supplement =
        pkg.name === 'abstract-logging' && pkg.version === '2.0.1'
          ? join(root, 'licenses/abstract-logging-MIT.txt')
          : null;
      if (!noticeFiles.length && !supplement)
        throw new Error(`运行依赖 ${pkg.name} 没有可复制的许可证文件`);
      const folder = `${pkg.name.replaceAll('/', '__')}@${pkg.version}`;
      mkdirSync(join(output, folder), { recursive: true });
      for (const file of noticeFiles) cpSync(join(directory, file), join(output, folder, file));
      if (supplement) {
        cpSync(supplement, join(output, folder, 'LICENSE.txt'));
        noticeFiles.push('LICENSE.txt');
      }
      records.push({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license ?? 'SEE NOTICES',
        notices: noticeFiles.map((file) => `${folder}/${file}`),
      });
    }
    for (const name of Object.keys(pkg.dependencies ?? {}))
      visit(resolveDependency(directory, name));
  };
  visit(realpathSync(root));
  for (const workspace of ['client', 'packages/contracts', 'packages/core', 'packages/plugin-sdk'])
    visit(realpathSync(join(root, workspace)));
  records.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  writeFileSync(join(output, 'dependencies.json'), JSON.stringify(records, null, 2) + '\n');
}
